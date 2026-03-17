const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}

// Middleware: require admin session
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ error: 'Admin login required' });
  }
  next();
}

router.post('/upload', requireAdmin, (req, res) => {
  try {
    const { filename, data } = req.body || {};
    if (!filename || !data || !String(data).startsWith('data:')) return res.status(400).json({ error: 'Invalid payload' });
    const m = String(data).match(/^data:([^;]+);base64,/);
    if (!m) return res.status(400).json({ error: 'Invalid payload' });
    const mime = m[1] || '';
    if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Only images are allowed' });
    const base64 = String(data).split(',')[1];
    if (!base64) return res.status(400).json({ error: 'Invalid payload' });
    const buf = Buffer.from(base64, 'base64');
    if (!buf || buf.length === 0) return res.status(400).json({ error: 'Invalid image data' });
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 5MB)' });
    const ext = mime === 'image/jpeg' ? '.jpg'
      : mime === 'image/png' ? '.png'
      : mime === 'image/webp' ? '.webp'
      : mime === 'image/gif' ? '.gif'
      : '.img';
    const base = String(filename).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '') || 'qr';
    const safeName = Date.now() + '_' + base + ext;
    const filePath = path.join(uploadsDir, safeName);
    fs.writeFileSync(filePath, buf);
    res.json({ success: true, url: '/uploads/' + safeName });
  } catch (e) {
    console.error('Admin upload error:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Seed default admin if none exists
async function ensureDefaultAdmin() {
  const admin = await db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('✅ Default admin created (username: admin, password: admin123)');
  }
}

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    await ensureDefaultAdmin();
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;

    // Refresh last active
    await db.prepare('UPDATE admins SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);

    res.json({ success: true, message: 'Admin login successful' });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.adminId = null;
  req.session.adminUsername = null;
  res.json({ success: true });
});

// GET /api/admin/check
router.get('/check', (req, res) => {
  res.json({ authenticated: !!req.session?.adminId });
});

router.post('/password/change', requireAdmin, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Current and new password are required' });
    if (String(new_password).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const admin = await db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    if (!bcrypt.compareSync(current_password, admin.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = bcrypt.hashSync(new_password, 10);
    await db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, admin.id);
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('Admin change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset/finance', requireAdmin, async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'CLEAR') return res.status(400).json({ error: 'Confirmation required' });

    const result = await db.transaction(async (client) => {
      const pendingWithdrawalsRes = await client.query("SELECT id, user_id, amount FROM withdrawals WHERE status = 'pending'");
      const pendingWithdrawals = pendingWithdrawalsRes.rows;
      for (const w of pendingWithdrawals) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [w.amount, w.user_id]);
      }

      const wCountRes = await client.query('SELECT COUNT(*) as c FROM withdrawals');
      const pCountRes = await client.query('SELECT COUNT(*) as c FROM payments');
      const tCountRes = await client.query("SELECT COUNT(*) as c FROM transactions WHERE type IN ('deposit','withdrawal','refund')");

      await client.query("DELETE FROM transactions WHERE type IN ('deposit','withdrawal','refund')");
      await client.query('DELETE FROM withdrawals');
      await client.query('DELETE FROM payments');

      return { 
        wCount: Number(wCountRes.rows[0].c), 
        pCount: Number(pCountRes.rows[0].c), 
        tCount: Number(tCountRes.rows[0].c), 
        pendingRefunded: pendingWithdrawals.length 
      };
    });

    res.json({ success: true, message: `Cleared payments (${result.pCount}), withdrawals (${result.wCount}), transactions (${result.tCount}). Refunded pending withdrawals: ${result.pendingRefunded}.` });
  } catch (err) {
    console.error('Admin reset finance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset/all', requireAdmin, async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'RESET') return res.status(400).json({ error: 'Confirmation required' });

    const counts = await db.transaction(async (client) => {
      const pendingWithdrawalsRes = await client.query("SELECT id, user_id, amount FROM withdrawals WHERE status = 'pending'");
      const pendingWithdrawals = pendingWithdrawalsRes.rows;
      for (const w of pendingWithdrawals) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [w.amount, w.user_id]);
      }
      
      const countsMap = {};
      const tables = ['support_messages','support_threads','notification_acks','notification_targets','notifications','user_boosters','spin_history','withdrawals','payments','transactions','user_profiles','user_machines','contact_messages','users'];
      for (const t of tables) {
        try { 
          const r = await client.query(`SELECT COUNT(*) as c FROM ${t}`);
          countsMap[t] = Number(r.rows[0].c); 
        } catch { countsMap[t] = 0; }
      }
      for (const t of tables) {
        try { await client.query(`DELETE FROM ${t}`); } catch {}
      }
      
      await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['seed_demo_disabled', '1']);
      
      return countsMap;
    });

    res.json({ success: true, message: 'All users and related data deleted. Stats reset to zero.' });
  } catch (err) {
    console.error('Admin reset all error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/assigned-sites
router.get('/assigned-sites', requireAdmin, async (req, res) => {
  try {
    const adminUsername = req.session.adminUsername;
    const sites = await db.prepare(`
      SELECT b.id, b.name, a.is_running 
      FROM business_sites b
      JOIN admin_business_access a ON b.id = a.business_id
      WHERE a.admin_username = ?
    `).all(adminUsername);
    res.json({ success: true, sites });
  } catch (err) {
    console.error('Assigned sites error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/switch-site
router.post('/switch-site', requireAdmin, async (req, res) => {
  try {
    const adminUsername = req.session.adminUsername;
    const { business_id } = req.body;
    
    await db.transaction(async (client) => {
      // Reset all for this admin
      await client.query('UPDATE admin_business_access SET is_running = 0 WHERE admin_username = $1', [adminUsername]);
      // Set new running
      await client.query('UPDATE admin_business_access SET is_running = 1 WHERE admin_username = $1 AND business_id = $2', [adminUsername, business_id]);
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Switch site error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/dashboard - Overview stats
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const totalUsers = (await db.prepare('SELECT COUNT(*) as count FROM users').get()).count;
    const totalBalance = (await db.prepare('SELECT COALESCE(SUM(balance), 0) as total FROM users').get()).total;
    const totalMachines = (await db.prepare('SELECT COUNT(*) as count FROM user_machines').get()).count;
    const totalWithdrawals = (await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals').get()).total;
    const pendingWithdrawals = (await db.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'").get()).count;
    const pendingPayments = (await db.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'pending'").get()).count;
    const totalDeposits = (await db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'approved'").get()).total;
    const unreadMessages = (await db.prepare("SELECT COUNT(*) as count FROM contact_messages WHERE status = 'unread'").get()).count;

    res.json({
      totalUsers: Number(totalUsers), 
      totalBalance: Math.floor(Number(totalBalance) * 100) / 100,
      totalMachines: Number(totalMachines), 
      totalWithdrawals: Math.floor(Number(totalWithdrawals) * 100) / 100,
      pendingWithdrawals: Number(pendingWithdrawals), 
      pendingPayments: Number(pendingPayments), 
      totalDeposits: Math.floor(Number(totalDeposits) * 100) / 100,
      unreadMessages: Number(unreadMessages)
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users - All users with pagination, search, sorting
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search.trim()}%` : '%';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    // Allowed sort columns to prevent injection
    const allowedSorts = ['created_at', 'balance', 'total_deposited', 'total_won', 'referral_count'];
    const sortCol = allowedSorts.includes(sortBy) ? sortBy : 'created_at';

    const sql = `
      SELECT 
        u.id, u.username, u.email, u.balance, u.referral_code, u.free_spins, u.created_at, u.plain_password,
        u.withdraw_blocked, u.withdraw_limit, u.withdraw_limit_until, u.frozen,
        (SELECT COUNT(*) FROM user_machines WHERE user_id = u.id) as machine_count,
        (SELECT COUNT(*) FROM users WHERE referred_by_user_id = u.id) as referral_count,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE user_id = u.id AND status = 'approved') as total_deposited,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE user_id = u.id AND type IN ('game_win', 'spin_win')) as total_won
      FROM users u
      WHERE (u.username LIKE ? OR u.email LIKE ?)
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const users = await db.prepare(sql).all(search, search, limit, offset);
    
    // Get total count for pagination
    const countSql = `SELECT COUNT(*) as count FROM users u WHERE (u.username LIKE ? OR u.email LIKE ?)`;
    const totalUsers = (await db.prepare(countSql).get(search, search)).count;

    res.json({
      users,
      page,
      totalPages: Math.ceil(Number(totalUsers) / limit),
      totalUsers: Number(totalUsers)
    });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/controls - Update user restrictions
router.post('/users/controls', requireAdmin, async (req, res) => {
  try {
    const { user_id, withdraw_blocked, withdraw_limit, withdraw_limit_until, frozen } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });

    await db.prepare(`
      UPDATE users SET 
        withdraw_blocked = ?, 
        withdraw_limit = ?, 
        withdraw_limit_until = ?, 
        frozen = ? 
      WHERE id = ?
    `).run(
      withdraw_blocked ? 1 : 0, 
      withdraw_limit || null, 
      withdraw_limit_until || null, 
      frozen ? 1 : 0, 
      user_id
    );

    res.json({ success: true, message: 'Controls updated' });
  } catch (err) {
    console.error('Admin user controls error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/password - Reset user password
router.post('/users/password', requireAdmin, async (req, res) => {
  try {
    const { user_id, new_password } = req.body;
    if (!user_id || !new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'User ID and password (min 6 chars) required' });
    }
    const hash = bcrypt.hashSync(new_password, 10);
    await db.prepare('UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?').run(hash, new_password, user_id);
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('Admin password reset error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/machines - All machines with edit capability
router.get('/machines', requireAdmin, async (req, res) => {
  try {
    const machines = await db.prepare('SELECT * FROM machines ORDER BY price ASC').all();
    res.json({ machines });
  } catch (err) {
    console.error('Admin machines error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/machines/update - Update machine price/earning
router.post('/machines/update', requireAdmin, async (req, res) => {
  try {
    const { id, name, price, earning_per_hour, description, icon } = req.body;

    if (!id) return res.status(400).json({ error: 'Machine ID required' });

    await db.prepare(`
      UPDATE machines SET name = ?, price = ?, earning_per_hour = ?, description = ?, icon = ? WHERE id = ?
    `).run(name, price, earning_per_hour, description, icon, id);

    res.json({ success: true, message: 'Machine updated' });
  } catch (err) {
    console.error('Admin machine update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/withdrawals - All withdrawals
router.get('/withdrawals', requireAdmin, async (req, res) => {
  try {
    const withdrawals = await db.prepare(`
      SELECT w.*, u.username, u.email,
        up.bank_account_name, up.bank_account_number, up.bank_ifsc, up.bank_name, up.upi_id
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN user_profiles up ON w.user_id = up.user_id
      ORDER BY w.created_at DESC LIMIT 100
    `).all();
    res.json({ withdrawals });
  } catch (err) {
    console.error('Admin withdrawals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/withdrawals/update - Approve/reject withdrawal
router.post('/withdrawals/update', requireAdmin, async (req, res) => {
  try {
    const { id, status, admin_note } = req.body;

    if (!id || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const withdrawal = await db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'Withdrawal already processed' });
    }

    await db.prepare('UPDATE withdrawals SET status = ?, admin_note = ? WHERE id = ?').run(status, admin_note || '', id);

    // If rejected, refund balance
    if (status === 'rejected') {
      await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(withdrawal.amount, withdrawal.user_id);
      await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'refund', ?, 'Withdrawal rejected - refunded')`)
        .run(withdrawal.user_id, withdrawal.amount);
    }

    res.json({ success: true, message: `Withdrawal ${status}` });
  } catch (err) {
    console.error('Admin withdrawal update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/payments - All payments
router.get('/payments', requireAdmin, async (req, res) => {
  try {
    const payments = await db.prepare(`
      SELECT p.*, u.username, u.email
      FROM payments p JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC LIMIT 100
    `).all();
    res.json({ payments });
  } catch (err) {
    console.error('Admin payments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/payments/update - Approve/reject payment
router.post('/payments/update', requireAdmin, async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const payment = await db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Payment already processed' });
    }

    await db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, id);

    // If approved, credit balance + bonus
    if (status === 'approved') {
      const amt = Number(payment.amount);
      let bonus = 0;
      let desc = `Deposit via ${payment.method.toUpperCase()} - ₹${amt}`;

      if (payment.method.startsWith('token:')) {
        // Fetch current rate to estimate USD value
        const rateRow = await db.prepare("SELECT value FROM settings WHERE key = 'usdt_inr_rate'").get();
        const rate = parseFloat(rateRow?.value || '101');
        const usdVal = amt / rate;

        if (usdVal >= 500) bonus = amt * 0.05;
        else if (usdVal >= 200) bonus = amt * 0.02;
        else if (usdVal >= 100) bonus = amt * 0.01;
      } else {
        // UPI or Bank (INR)
        if (amt >= 50000) bonus = amt * 0.05;
        else if (amt >= 20000) bonus = amt * 0.02;
        else if (amt >= 10000) bonus = amt * 0.01;
      }

      bonus = Math.floor(bonus * 100) / 100;

      await db.transaction(async (client) => {
        // Credit Deposit
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amt, payment.user_id]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'deposit', $2, $3)`, [payment.user_id, amt, desc]);

        // Credit Bonus if any
        if (bonus > 0) {
          await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bonus, payment.user_id]);
          await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)`, [payment.user_id, bonus, `Deposit Bonus (${(bonus/amt*100).toFixed(0)}%)`]);
        }
      });
    }

    res.json({ success: true, message: `Payment ${status}` });
  } catch (err) {
    console.error('Admin payment update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/contacts - All contact messages
router.get('/contacts', requireAdmin, async (req, res) => {
  try {
    const messages = await db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100').all();
    res.json({ messages });
  } catch (err) {
    console.error('Admin contacts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/create - Create a new user from admin
router.post('/users/create', requireAdmin, async (req, res) => {
  try {
    const { username, email, password, balance, free_spins } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.prepare('SELECT id FROM users WHERE email = ? OR LOWER(username) = ?').get(email, String(username).toLowerCase());
    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const crypto = require('crypto');
    const passwordHash = bcrypt.hashSync(password, 10);
    const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const initialBalance = parseFloat(balance) || 0;
    const initialSpins = parseInt(free_spins) || 1;

    const userId = await db.transaction(async (client) => {
      const res = await client.query(`
        INSERT INTO users (username, email, password_hash, plain_password, balance, referral_code, free_spins)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [username, email, passwordHash, password, initialBalance, referralCode, initialSpins]);

      const uid = res.rows[0].id;

      // Give free Mini Miner
      await client.query('INSERT INTO user_machines (user_id, machine_id) VALUES ($1, 1)', [uid]);
      await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', 0, 'Received free Mini Miner (admin created)')`, [uid]);

      if (initialBalance > 0) {
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'deposit', $2, 'Initial balance set by admin')`, [uid, initialBalance]);
      }

      return uid;
    });

    res.json({ success: true, message: `User "${username}" created (ID: ${userId}) with ₹${initialBalance} balance and ${initialSpins} free spins` });
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/edit - Edit user balance and spins
router.post('/users/edit', requireAdmin, async (req, res) => {
  try {
    const { user_id, balance, free_spins } = req.body;

    if (!user_id) return res.status(400).json({ error: 'User ID required' });

    const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (balance !== undefined) {
      await db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(parseFloat(balance), user_id);
    }
    if (free_spins !== undefined) {
      await db.prepare('UPDATE users SET free_spins = ? WHERE id = ?').run(parseInt(free_spins), user_id);
    }

    res.json({ success: true, message: 'User updated' });
  } catch (err) {
    console.error('Admin edit user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/export/users - Export users as CSV
router.get('/export/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.prepare(`
      SELECT u.id, u.username, u.email, u.balance, u.referral_code, u.free_spins, u.created_at,
        up.full_name, up.phone, up.address, up.city, up.state, up.pincode,
        up.bank_account_name, up.bank_account_number, up.bank_ifsc, up.bank_name, up.upi_id
      FROM users u LEFT JOIN user_profiles up ON u.id = up.user_id
      ORDER BY u.id
    `).all();

    const headers = 'ID,Username,Email,Balance,Referral Code,Free Spins,Created At,Full Name,Phone,Address,City,State,Pincode,Bank Account Name,Bank Account Number,IFSC,Bank Name,UPI ID';
    const rows = users.map(u =>
      [u.id, u.username, u.email, u.balance, u.referral_code, u.free_spins, u.created_at,
       u.full_name || '', u.phone || '', u.address || '', u.city || '', u.state || '', u.pincode || '',
       u.bank_account_name || '', u.bank_account_number || '', u.bank_ifsc || '', u.bank_name || '', u.upi_id || ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );

    const csv = headers + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mineprofit_users.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/users/delete - Completely remove a user
router.post('/users/delete', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });

    const user = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await db.transaction(async (client) => {
      await client.query('DELETE FROM spin_history WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM transactions WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM withdrawals WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM payments WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM user_machines WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM user_profiles WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM contact_messages WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM users WHERE id = $1', [user_id]);
    });

    res.json({ success: true, message: `User "${user.username}" (ID: ${user_id}) has been permanently deleted` });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/machines/clear', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });
    const user = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const result = await db.prepare('DELETE FROM user_machines WHERE user_id = ?').run(user_id);
    res.json({ success: true, message: `Removed ${result.changes || 0} machines from ${user.username}` });
  } catch (err) {
    console.error('Admin clear machines error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users/history?username=xxx - Full user history by username
router.get('/users/history', requireAdmin, async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const user = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(String(username).trim().toLowerCase());
    if (!user) return res.status(404).json({ error: `User "${username}" not found` });

    const profile = await db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(user.id);

    const machines = await db.prepare(`
      SELECT um.id, um.purchased_at, m.name, m.earning_per_hour, m.icon, m.price
      FROM user_machines um JOIN machines m ON um.machine_id = m.id
      WHERE um.user_id = ? ORDER BY um.purchased_at DESC
    `).all(user.id);

    const transactions = await db.prepare(`
      SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200
    `).all(user.id);

    const withdrawals = await db.prepare(`
      SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC
    `).all(user.id);

    const payments = await db.prepare(`
      SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC
    `).all(user.id);

    const spins = await db.prepare(`
      SELECT * FROM spin_history WHERE user_id = ? ORDER BY created_at DESC
    `).all(user.id);

    const totalPerHour = machines.reduce((sum, m) => sum + Number(m.earning_per_hour), 0);

    const totalDeposited = payments.filter(p => p.status === 'approved').reduce((s, p) => s + Number(p.amount), 0);
    const totalWithdrawn = withdrawals.filter(w => w.status === 'approved').reduce((s, w) => s + Number(w.amount), 0);
    const totalMiningEarnings = transactions.filter(t => t.type === 'mining').reduce((s, t) => s + Number(t.amount), 0);
    const totalReferralEarnings = transactions.filter(t => t.type === 'referral').reduce((s, t) => s + Number(t.amount), 0);
    const totalSpinWinnings = transactions.filter(t => t.type === 'bonus').reduce((s, t) => s + Number(t.amount), 0);
    const totalPurchases = transactions.filter(t => t.type === 'purchase').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        balance: Number(user.balance),
        referral_code: user.referral_code,
        free_spins: user.free_spins,
        created_at: user.created_at,
        last_collected_at: user.last_collected_at,
      },
      profile: profile || null,
      summary: {
        totalPerHour,
        totalDeposited: Math.floor(totalDeposited * 100) / 100,
        totalWithdrawn: Math.floor(totalWithdrawn * 100) / 100,
        totalMiningEarnings: Math.floor(totalMiningEarnings * 100) / 100,
        totalReferralEarnings: Math.floor(totalReferralEarnings * 100) / 100,
        totalSpinWinnings: Math.floor(totalSpinWinnings * 100) / 100,
        totalPurchases: Math.floor(totalPurchases * 100) / 100,
        machineCount: machines.length,
      },
      machines,
      transactions,
      withdrawals,
      payments,
      spins,
    });
  } catch (err) {
    console.error('Admin user history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/settings - Get all settings
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    console.error('Admin get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/settings/update - Update payment settings
router.post('/settings/update', requireAdmin, async (req, res) => {
  try {
    const allowed = ['upi_id', 'upi_name', 'upi_qr_url', 'crypto_btc', 'crypto_eth', 'crypto_usdt',
      'spin_difficulty', 'game_lucky_difficulty', 'game_dice_difficulty', 'spin_reward_multiplier',
      'withdraw_cap_bank', 'withdraw_cap_upi', 'withdraw_daily_cap',
      'withdraw_frequency_limit', 'withdraw_frequency_hours', 'usdt_inr_rate', 'space_traveler_settings', 'plinko_settings'];
    const updates = req.body;

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(key, String(updates[key]));
      }
    }

    res.json({ success: true, message: 'Payment settings updated' });
  } catch (err) {
    console.error('Admin update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/games/rules/status - Enable/Disable a game
router.post('/games/rules/status', requireAdmin, async (req, res) => {
  try {
    const { game_type, is_active } = req.body;
    if (!game_type) return res.status(400).json({ error: 'game_type required' });
    
    await db.prepare('UPDATE game_rules SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE game_type = ?').run(is_active, game_type);
    res.json({ success: true, message: `Game ${game_type} status updated to ${is_active}` });
  } catch (err) {
    console.error('Admin update status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/games/rules/update - Update Rule Book for a game
router.post('/games/rules/update', requireAdmin, async (req, res) => {
  try {
    const { game_type, rules } = req.body;
    if (!game_type || !rules) return res.status(400).json({ error: 'game_type and rules required' });
    
    await db.prepare('INSERT INTO game_rules (game_type, rules, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (game_type) DO UPDATE SET rules = EXCLUDED.rules, updated_at = EXCLUDED.updated_at').run(game_type, JSON.stringify(rules));
    
    res.json({ success: true, message: `Rule book for ${game_type} updated` });
  } catch (err) {
    console.error('Admin update rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/games/history - Global game history
router.get('/games/history', requireAdmin, async (req, res) => {
  try {
    const history = await db.prepare(`
      SELECT h.*, u.username 
      FROM game_history h 
      JOIN users u ON h.user_id = u.id 
      ORDER BY h.created_at DESC 
      LIMIT 200
    `).all();
    res.json({ success: true, history });
  } catch (err) {
    console.error('Admin game history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Payment gateways
router.get('/gateways', requireAdmin, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM payment_gateways ORDER BY created_at DESC').all();
    res.json({ gateways: rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});
router.post('/gateways/add', requireAdmin, async (req, res) => {
  try {
    const { method, label, upi_id, upi_name, qr_url, bank_account_name, bank_account_number, bank_ifsc, bank_name, enabled } = req.body;
    if (!method || !label) return res.status(400).json({ error: 'method and label required' });
    const r = await db.prepare(`
      INSERT INTO payment_gateways (method, label, upi_id, upi_name, qr_url, bank_account_name, bank_account_number, bank_ifsc, bank_name, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(method, label, upi_id||null, upi_name||null, qr_url||null, bank_account_name||null, bank_account_number||null, bank_ifsc||null, bank_name||null, enabled?1:1);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/gateways/update', requireAdmin, async (req, res) => {
  try {
    const { id, method, label, upi_id, upi_name, qr_url, bank_account_name, bank_account_number, bank_ifsc, bank_name, enabled } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const existing = await db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Gateway not found' });
    const next = {
      method: method !== undefined ? method : existing.method,
      label: label !== undefined ? label : existing.label,
      upi_id: upi_id !== undefined ? (upi_id || null) : existing.upi_id,
      upi_name: upi_name !== undefined ? (upi_name || null) : existing.upi_name,
      qr_url: qr_url !== undefined ? (qr_url || null) : existing.qr_url,
      bank_account_name: bank_account_name !== undefined ? (bank_account_name || null) : existing.bank_account_name,
      bank_account_number: bank_account_number !== undefined ? (bank_account_number || null) : existing.bank_account_number,
      bank_ifsc: bank_ifsc !== undefined ? (bank_ifsc || null) : existing.bank_ifsc,
      bank_name: bank_name !== undefined ? (bank_name || null) : existing.bank_name,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled
    };
    await db.prepare(`
      UPDATE payment_gateways 
      SET method=?, label=?, upi_id=?, upi_name=?, qr_url=?, bank_account_name=?, bank_account_number=?, bank_ifsc=?, bank_name=?, enabled=?
      WHERE id=?
    `).run(next.method, next.label, next.upi_id, next.upi_name, next.qr_url, next.bank_account_name, next.bank_account_number, next.bank_ifsc, next.bank_name, next.enabled, id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/gateways/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.prepare('DELETE FROM payment_gateways WHERE id = ?').run(id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Crypto tokens
router.get('/crypto/tokens', requireAdmin, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM crypto_tokens ORDER BY created_at DESC').all();
    res.json({ tokens: rows });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/crypto/tokens/add', requireAdmin, async (req, res) => {
  try {
    const { symbol, name, network, address, qr_url, enabled } = req.body;
    if (!symbol || !address) return res.status(400).json({ error: 'symbol and address required' });
    const r = await db.prepare(`
      INSERT INTO crypto_tokens (symbol, name, network, address, qr_url, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(symbol.toUpperCase(), name||null, network||null, address, qr_url||null, enabled?1:1);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/crypto/tokens/update', requireAdmin, async (req, res) => {
  try {
    const { id, symbol, name, network, address, qr_url, enabled } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const existing = await db.prepare('SELECT * FROM crypto_tokens WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Token not found' });
    const next = {
      symbol: symbol !== undefined ? symbol.toUpperCase() : existing.symbol,
      name: name !== undefined ? (name || null) : existing.name,
      network: network !== undefined ? (network || null) : existing.network,
      address: address !== undefined ? (address || null) : existing.address,
      qr_url: qr_url !== undefined ? (qr_url || null) : existing.qr_url,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled
    };
    await db.prepare(`
      UPDATE crypto_tokens SET symbol=?, name=?, network=?, address=?, qr_url=?, enabled=? WHERE id=?
    `).run(next.symbol, next.name, next.network, next.address, next.qr_url, next.enabled, id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/crypto/tokens/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.prepare('DELETE FROM crypto_tokens WHERE id = ?').run(id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
// GET /api/admin/export/report-users - Advanced users report CSV
router.get('/export/report-users', requireAdmin, async (req, res) => {
  try {
    const users = await db.prepare(`
      SELECT u.id, u.username, u.email, u.balance, u.referral_code, u.free_spins, u.created_at, u.last_collected_at,
        up.full_name, up.phone, up.address, up.city, up.state, up.pincode,
        up.bank_account_name, up.bank_account_number, up.bank_ifsc, up.bank_name, up.upi_id,
        (SELECT COUNT(*) FROM user_machines WHERE user_id = u.id) as machine_count,
        (SELECT COALESCE(SUM(m2.earning_per_hour),0) FROM user_machines um2 JOIN machines m2 ON um2.machine_id=m2.id WHERE um2.user_id=u.id) as earning_per_hour,
        (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='mining') as total_mining,
        (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='referral') as total_referral,
        (SELECT COALESCE(SUM(amount),0) FROM withdrawals WHERE user_id=u.id AND status='approved') as total_withdrawn,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE user_id=u.id AND status='approved') as total_deposited,
        (SELECT COUNT(*) FROM users WHERE referred_by_user_id=u.id) as direct_referrals
      FROM users u LEFT JOIN user_profiles up ON u.id = up.user_id ORDER BY u.id
    `).all();

    const headers = 'ID,Username,Email,Balance,Earning/Hr,Machines,Free Spins,Referral Code,Direct Referrals,Total Mining,Total Referral,Total Deposited,Total Withdrawn,Full Name,Phone,City,State,Bank Name,Account Number,IFSC,UPI ID,Joined,Last Collected';
    const rows = users.map(u =>
      [u.id, u.username, u.email, u.balance, u.earning_per_hour, u.machine_count, u.free_spins, u.referral_code, u.direct_referrals,
       u.total_mining, u.total_referral, u.total_deposited, u.total_withdrawn,
       u.full_name||'', u.phone||'', u.city||'', u.state||'', u.bank_name||'', u.bank_account_number||'', u.bank_ifsc||'', u.upi_id||'',
       u.created_at, u.last_collected_at||''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const csv = headers + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mineprofit_user_report.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export user report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
