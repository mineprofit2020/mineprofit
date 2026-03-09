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
function ensureDefaultAdmin() {
  const admin = db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('✅ Default admin created (username: admin, password: admin123)');
  }
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  try {
    ensureDefaultAdmin();
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;

    // Refresh last active
    db.prepare('UPDATE admins SET last_active = datetime("now") WHERE id = ?').run(admin.id);

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

router.post('/password/change', requireAdmin, (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Current and new password are required' });
    if (String(new_password).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    if (!bcrypt.compareSync(current_password, admin.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, admin.id);
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('Admin change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset/finance', requireAdmin, (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'CLEAR') return res.status(400).json({ error: 'Confirmation required' });

    const resetTx = db.transaction(() => {
      const pendingWithdrawals = db.prepare("SELECT id, user_id, amount FROM withdrawals WHERE status = 'pending'").all();
      for (const w of pendingWithdrawals) {
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, w.user_id);
      }

      const wCount = db.prepare('SELECT COUNT(*) as c FROM withdrawals').get().c;
      const pCount = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
      const tCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type IN ('deposit','withdrawal','refund')").get().c;

      db.prepare("DELETE FROM transactions WHERE type IN ('deposit','withdrawal','refund')").run();
      db.prepare('DELETE FROM withdrawals').run();
      db.prepare('DELETE FROM payments').run();

      return { wCount, pCount, tCount, pendingRefunded: pendingWithdrawals.length };
    });

    const r = resetTx();
    res.json({ success: true, message: `Cleared payments (${r.pCount}), withdrawals (${r.wCount}), transactions (${r.tCount}). Refunded pending withdrawals: ${r.pendingRefunded}.` });
  } catch (err) {
    console.error('Admin reset finance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset/all', requireAdmin, (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'RESET') return res.status(400).json({ error: 'Confirmation required' });

    const resetAllTx = db.transaction(() => {
      const pendingWithdrawals = db.prepare("SELECT id, user_id, amount FROM withdrawals WHERE status = 'pending'").all();
      for (const w of pendingWithdrawals) {
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, w.user_id);
      }
      const counts = {};
      const tables = ['support_messages','support_threads','notification_acks','notification_targets','notifications','user_boosters','spin_history','withdrawals','payments','transactions','user_profiles','user_machines','contact_messages','users'];
      for (const t of tables) {
        try { counts[t] = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c; } catch { counts[t] = 0; }
      }
      for (const t of tables) {
        try { db.prepare(`DELETE FROM ${t}`).run(); } catch {}
      }
      const exists = db.prepare('SELECT key FROM settings WHERE key = ?').get('seed_demo_disabled');
      if (exists) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('1', 'seed_demo_disabled');
      else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('seed_demo_disabled', '1');
      return counts;
    });

    const c = resetAllTx();
    res.json({ success: true, message: 'All users and related data deleted. Stats reset to zero.' });
  } catch (err) {
    console.error('Admin reset all error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/assigned-sites
router.get('/assigned-sites', requireAdmin, (req, res) => {
  try {
    const adminUsername = req.session.adminUsername;
    const sites = db.prepare(`
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
router.post('/switch-site', requireAdmin, (req, res) => {
  try {
    const adminUsername = req.session.adminUsername;
    const { business_id } = req.body;
    
    db.transaction(() => {
      // Reset all for this admin
      db.prepare('UPDATE admin_business_access SET is_running = 0 WHERE admin_username = ?').run(adminUsername);
      // Set new running
      db.prepare('UPDATE admin_business_access SET is_running = 1 WHERE admin_username = ? AND business_id = ?')
        .run(adminUsername, business_id);
    })();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Switch site error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/dashboard - Overview stats
router.get('/dashboard', requireAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalBalance = db.prepare('SELECT COALESCE(SUM(balance), 0) as total FROM users').get().total;
    const totalMachines = db.prepare('SELECT COUNT(*) as count FROM user_machines').get().count;
    const totalWithdrawals = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals').get().total;
    const pendingWithdrawals = db.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'").get().count;
    const pendingPayments = db.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'pending'").get().count;
    const totalDeposits = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'approved'").get().total;
    const unreadMessages = db.prepare("SELECT COUNT(*) as count FROM contact_messages WHERE status = 'unread'").get().count;

    res.json({
      totalUsers, totalBalance: Math.floor(totalBalance * 100) / 100,
      totalMachines, totalWithdrawals: Math.floor(totalWithdrawals * 100) / 100,
      pendingWithdrawals, pendingPayments, totalDeposits: Math.floor(totalDeposits * 100) / 100,
      unreadMessages
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users - All users with pagination, search, sorting
router.get('/users', requireAdmin, (req, res) => {
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

    // Base query with subselects for stats
    // Note: SQLite might be slow with subqueries on large datasets, but for <10k users it's fine.
    // Optimization: If slow, these stats should be cached or stored in users table.
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

    const users = db.prepare(sql).all(search, search, limit, offset);
    
    // Get total count for pagination
    const countSql = `SELECT COUNT(*) as count FROM users u WHERE (u.username LIKE ? OR u.email LIKE ?)`;
    const totalUsers = db.prepare(countSql).get(search, search).count;

    res.json({
      users,
      page,
      totalPages: Math.ceil(totalUsers / limit),
      totalUsers
    });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/controls - Update user restrictions
router.post('/users/controls', requireAdmin, (req, res) => {
  try {
    const { user_id, withdraw_blocked, withdraw_limit, withdraw_limit_until, frozen } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });

    // Check if columns exist, if not create them (migration on the fly)
    // In a real app, use proper migrations. Here we check via PRAGMA or just try/catch the update
    // Assuming columns exist or were added in db.js init. 
    // If not, we might need to alter table.
    
    // Let's assume columns are added. If not, we should catch error.
    try {
      db.prepare(`
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
    } catch (e) {
      if (e.message.includes('no such column')) {
        // Auto-migration
        db.exec(`ALTER TABLE users ADD COLUMN withdraw_blocked INTEGER DEFAULT 0`);
        db.exec(`ALTER TABLE users ADD COLUMN withdraw_limit REAL DEFAULT NULL`);
        db.exec(`ALTER TABLE users ADD COLUMN withdraw_limit_until TEXT DEFAULT NULL`);
        db.exec(`ALTER TABLE users ADD COLUMN frozen INTEGER DEFAULT 0`);
        // Retry
        db.prepare(`
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
      } else {
        throw e;
      }
    }

    res.json({ success: true, message: 'Controls updated' });
  } catch (err) {
    console.error('Admin user controls error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/password - Reset user password
router.post('/users/password', requireAdmin, (req, res) => {
  try {
    const { user_id, new_password } = req.body;
    if (!user_id || !new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'User ID and password (min 6 chars) required' });
    }
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?').run(hash, new_password, user_id);
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('Admin password reset error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/machines - All machines with edit capability
router.get('/machines', requireAdmin, (req, res) => {
  try {
    const machines = db.prepare('SELECT * FROM machines ORDER BY price ASC').all();
    res.json({ machines });
  } catch (err) {
    console.error('Admin machines error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/machines/update - Update machine price/earning
router.post('/machines/update', requireAdmin, (req, res) => {
  try {
    const { id, name, price, earning_per_hour, description, icon } = req.body;

    if (!id) return res.status(400).json({ error: 'Machine ID required' });

    db.prepare(`
      UPDATE machines SET name = ?, price = ?, earning_per_hour = ?, description = ?, icon = ? WHERE id = ?
    `).run(name, price, earning_per_hour, description, icon, id);

    res.json({ success: true, message: 'Machine updated' });
  } catch (err) {
    console.error('Admin machine update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/withdrawals - All withdrawals
router.get('/withdrawals', requireAdmin, (req, res) => {
  try {
    const withdrawals = db.prepare(`
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
router.post('/withdrawals/update', requireAdmin, (req, res) => {
  try {
    const { id, status, admin_note } = req.body;

    if (!id || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'Withdrawal already processed' });
    }

    db.prepare('UPDATE withdrawals SET status = ?, admin_note = ? WHERE id = ?').run(status, admin_note || '', id);

    // If rejected, refund balance
    if (status === 'rejected') {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(withdrawal.amount, withdrawal.user_id);
      db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'refund', ?, 'Withdrawal rejected - refunded')`)
        .run(withdrawal.user_id, withdrawal.amount);
    }

    res.json({ success: true, message: `Withdrawal ${status}` });
  } catch (err) {
    console.error('Admin withdrawal update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/payments - All payments
router.get('/payments', requireAdmin, (req, res) => {
  try {
    const payments = db.prepare(`
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
router.post('/payments/update', requireAdmin, (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Payment already processed' });
    }

    db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, id);

    // If approved, credit balance + bonus
    if (status === 'approved') {
      const amt = payment.amount;
      let bonus = 0;
      let desc = `Deposit via ${payment.method.toUpperCase()} - ₹${amt}`;

      if (payment.method.startsWith('token:')) {
        // Fetch current rate to estimate USD value
        const rateRow = db.prepare("SELECT value FROM settings WHERE key = 'usdt_inr_rate'").get();
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

      const approveTx = db.transaction(() => {
        // Credit Deposit
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, payment.user_id);
        db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'deposit', ?, ?)`)
          .run(payment.user_id, amt, desc);

        // Credit Bonus if any
        if (bonus > 0) {
          db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(bonus, payment.user_id);
          db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)`)
            .run(payment.user_id, bonus, `Deposit Bonus (${(bonus/amt*100).toFixed(0)}%)`);
        }
      });

      approveTx();
    }

    res.json({ success: true, message: `Payment ${status}` });
  } catch (err) {
    console.error('Admin payment update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/contacts - All contact messages
router.get('/contacts', requireAdmin, (req, res) => {
  try {
    const messages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100').all();
    res.json({ messages });
  } catch (err) {
    console.error('Admin contacts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/create - Create a new user from admin
router.post('/users/create', requireAdmin, (req, res) => {
  try {
    const { username, email, password, balance, free_spins } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR LOWER(username) = ?').get(email, String(username).toLowerCase());
    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    const passwordHash = bcrypt.hashSync(password, 10);
    const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const initialBalance = parseFloat(balance) || 0;
    const initialSpins = parseInt(free_spins) || 1;

    const createTx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (username, email, password_hash, plain_password, balance, referral_code, free_spins)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(username, email, passwordHash, password, initialBalance, referralCode, initialSpins);

      const userId = result.lastInsertRowid;

      // Give free Mini Miner
      db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 1)').run(userId);

      db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', 0, 'Received free Mini Miner (admin created)')`).
        run(userId);

      if (initialBalance > 0) {
        db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'deposit', ?, 'Initial balance set by admin')`).
          run(userId, initialBalance);
      }

      return userId;
    });

    const userId = createTx();

    res.json({ success: true, message: `User "${username}" created (ID: ${userId}) with ₹${initialBalance} balance and ${initialSpins} free spins` });
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/edit - Edit user balance and spins
router.post('/users/edit', requireAdmin, (req, res) => {
  try {
    const { user_id, balance, free_spins } = req.body;

    if (!user_id) return res.status(400).json({ error: 'User ID required' });

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (balance !== undefined) {
      db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(parseFloat(balance), user_id);
    }
    if (free_spins !== undefined) {
      db.prepare('UPDATE users SET free_spins = ? WHERE id = ?').run(parseInt(free_spins), user_id);
    }

    res.json({ success: true, message: 'User updated' });
  } catch (err) {
    console.error('Admin edit user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/export/users - Export users as CSV
router.get('/export/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
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
router.post('/users/delete', requireAdmin, (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM spin_history WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM transactions WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM withdrawals WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM payments WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM user_machines WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM contact_messages WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user_id);
    });
    deleteTx();

    res.json({ success: true, message: `User "${user.username}" (ID: ${user_id}) has been permanently deleted` });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/machines/clear', requireAdmin, (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const result = db.prepare('DELETE FROM user_machines WHERE user_id = ?').run(user_id);
    res.json({ success: true, message: `Removed ${result.changes || 0} machines from ${user.username}` });
  } catch (err) {
    console.error('Admin clear machines error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users/history?username=xxx - Full user history by username
router.get('/users/history', requireAdmin, (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(String(username).trim().toLowerCase());
    if (!user) return res.status(404).json({ error: `User "${username}" not found` });

    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(user.id);

    const machines = db.prepare(`
      SELECT um.id, um.purchased_at, m.name, m.earning_per_hour, m.icon, m.price
      FROM user_machines um JOIN machines m ON um.machine_id = m.id
      WHERE um.user_id = ? ORDER BY um.purchased_at DESC
    `).all(user.id);

    const transactions = db.prepare(`
      SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200
    `).all(user.id);

    const withdrawals = db.prepare(`
      SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC
    `).all(user.id);

    const payments = db.prepare(`
      SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC
    `).all(user.id);

    const spins = db.prepare(`
      SELECT * FROM spin_history WHERE user_id = ? ORDER BY created_at DESC
    `).all(user.id);

    const totalPerHour = machines.reduce((sum, m) => sum + m.earning_per_hour, 0);

    const totalDeposited = payments.filter(p => p.status === 'approved').reduce((s, p) => s + p.amount, 0);
    const totalWithdrawn = withdrawals.filter(w => w.status === 'approved').reduce((s, w) => s + w.amount, 0);
    const totalMiningEarnings = transactions.filter(t => t.type === 'mining').reduce((s, t) => s + t.amount, 0);
    const totalReferralEarnings = transactions.filter(t => t.type === 'referral').reduce((s, t) => s + t.amount, 0);
    const totalSpinWinnings = transactions.filter(t => t.type === 'bonus').reduce((s, t) => s + t.amount, 0);
    const totalPurchases = transactions.filter(t => t.type === 'purchase').reduce((s, t) => s + Math.abs(t.amount), 0);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        balance: user.balance,
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
router.get('/settings', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    console.error('Admin get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/settings/update - Update payment settings
router.post('/settings/update', requireAdmin, (req, res) => {
  try {
    const allowed = ['upi_id', 'upi_name', 'upi_qr_url', 'crypto_btc', 'crypto_eth', 'crypto_usdt',
      'spin_difficulty', 'game_lucky_difficulty', 'game_dice_difficulty', 'spin_reward_multiplier',
      'withdraw_cap_bank', 'withdraw_cap_upi', 'withdraw_daily_cap',
      'withdraw_frequency_limit', 'withdraw_frequency_hours', 'usdt_inr_rate', 'space_traveler_settings', 'plinko_settings'];
    const updates = req.body;

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
        if (existing) {
          db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(updates[key], key);
        } else {
          db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, updates[key]);
        }
      }
    }

    res.json({ success: true, message: 'Payment settings updated' });
  } catch (err) {
    console.error('Admin update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/games/rules/status - Enable/Disable a game
router.post('/games/rules/status', requireAdmin, (req, res) => {
  try {
    const { game_type, is_active } = req.body;
    if (!game_type) return res.status(400).json({ error: 'game_type required' });
    
    db.prepare('UPDATE game_rules SET is_active = ?, updated_at = datetime(\'now\') WHERE game_type = ?').run(is_active, game_type);
    res.json({ success: true, message: `Game ${game_type} status updated to ${is_active}` });
  } catch (err) {
    console.error('Admin update status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/games/rules/update - Update Rule Book for a game
router.post('/games/rules/update', requireAdmin, (req, res) => {
  try {
    const { game_type, rules } = req.body;
    if (!game_type || !rules) return res.status(400).json({ error: 'game_type and rules required' });
    
    const existing = db.prepare('SELECT id FROM game_rules WHERE game_type = ?').get(game_type);
    if (existing) {
      db.prepare('UPDATE game_rules SET rules = ?, updated_at = datetime(\'now\') WHERE game_type = ?').run(JSON.stringify(rules), game_type);
    } else {
      db.prepare('INSERT INTO game_rules (game_type, rules) VALUES (?, ?)').run(game_type, JSON.stringify(rules));
    }
    
    res.json({ success: true, message: `Rule book for ${game_type} updated` });
  } catch (err) {
    console.error('Admin update rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/games/history - Global game history
router.get('/games/history', requireAdmin, (req, res) => {
  try {
    const history = db.prepare(`
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
router.get('/gateways', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM payment_gateways ORDER BY created_at DESC').all();
    res.json({ gateways: rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});
router.post('/gateways/add', requireAdmin, (req, res) => {
  try {
    const { method, label, upi_id, upi_name, qr_url, bank_account_name, bank_account_number, bank_ifsc, bank_name, enabled } = req.body;
    if (!method || !label) return res.status(400).json({ error: 'method and label required' });
    const r = db.prepare(`
      INSERT INTO payment_gateways (method, label, upi_id, upi_name, qr_url, bank_account_name, bank_account_number, bank_ifsc, bank_name, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(method, label, upi_id||null, upi_name||null, qr_url||null, bank_account_name||null, bank_account_number||null, bank_ifsc||null, bank_name||null, enabled?1:1);
    let id = r.lastInsertRowid;
    if (!id) {
      const row = db.prepare(`SELECT id FROM payment_gateways WHERE method = ? AND label = ? ORDER BY id DESC LIMIT 1`).get(method, label);
      id = row?.id || 0;
    }
    res.json({ success: true, id });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/gateways/update', requireAdmin, (req, res) => {
  try {
    const { id, method, label, upi_id, upi_name, qr_url, bank_account_name, bank_account_number, bank_ifsc, bank_name, enabled } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const existing = db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(id);
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
    db.prepare(`
      UPDATE payment_gateways 
      SET method=?, label=?, upi_id=?, upi_name=?, qr_url=?, bank_account_name=?, bank_account_number=?, bank_ifsc=?, bank_name=?, enabled=?
      WHERE id=?
    `).run(next.method, next.label, next.upi_id, next.upi_name, next.qr_url, next.bank_account_name, next.bank_account_number, next.bank_ifsc, next.bank_name, next.enabled, id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/gateways/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    db.prepare('DELETE FROM payment_gateways WHERE id = ?').run(id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Crypto tokens
router.get('/crypto/tokens', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM crypto_tokens ORDER BY created_at DESC').all();
    res.json({ tokens: rows });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/crypto/tokens/add', requireAdmin, (req, res) => {
  try {
    const { symbol, name, network, address, qr_url, enabled } = req.body;
    if (!symbol || !address) return res.status(400).json({ error: 'symbol and address required' });
    const r = db.prepare(`
      INSERT INTO crypto_tokens (symbol, name, network, address, qr_url, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(symbol.toUpperCase(), name||null, network||null, address, qr_url||null, enabled?1:1);
    let id = r.lastInsertRowid;
    if (!id) {
      const row = db.prepare(`SELECT id FROM crypto_tokens WHERE symbol = ? AND address = ? ORDER BY id DESC LIMIT 1`).get(symbol.toUpperCase(), address);
      id = row?.id || 0;
    }
    res.json({ success: true, id });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/crypto/tokens/update', requireAdmin, (req, res) => {
  try {
    const { id, symbol, name, network, address, qr_url, enabled } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const existing = db.prepare('SELECT * FROM crypto_tokens WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Token not found' });
    const next = {
      symbol: symbol !== undefined ? symbol.toUpperCase() : existing.symbol,
      name: name !== undefined ? (name || null) : existing.name,
      network: network !== undefined ? (network || null) : existing.network,
      address: address !== undefined ? (address || null) : existing.address,
      qr_url: qr_url !== undefined ? (qr_url || null) : existing.qr_url,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled
    };
    db.prepare(`
      UPDATE crypto_tokens SET symbol=?, name=?, network=?, address=?, qr_url=?, enabled=? WHERE id=?
    `).run(next.symbol, next.name, next.network, next.address, next.qr_url, next.enabled, id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/crypto/tokens/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    db.prepare('DELETE FROM crypto_tokens WHERE id = ?').run(id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
// GET /api/admin/export/report-users - Advanced users report CSV
router.get('/export/report-users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
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

// GET /api/admin/export/report-transactions - All transactions report CSV
router.get('/export/report-transactions', requireAdmin, (req, res) => {
  try {
    const { from, to } = req.query;
    let where = '';
    const params = [];
    if (from && to) { where = 'WHERE t.created_at BETWEEN ? AND ?'; params.push(from, to); }
    else if (from) { where = 'WHERE t.created_at >= ?'; params.push(from); }
    else if (to) { where = 'WHERE t.created_at <= ?'; params.push(to); }
    const stmt = `
      SELECT t.id, t.user_id, u.username, u.email, t.type, t.amount, t.description, t.created_at
      FROM transactions t JOIN users u ON t.user_id = u.id
      ${where}
      ORDER BY t.created_at DESC
    `;
    const txns = db.prepare(stmt).all(...params);

    const headers = 'Txn ID,User ID,Username,Email,Type,Amount,Description,Date';
    const rows = txns.map(t =>
      [t.id, t.user_id, t.username, t.email, t.type, t.amount, t.description||'', t.created_at
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const csv = headers + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mineprofit_transactions.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export transactions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/export/report-activity - Detailed activity log
router.get('/export/report-activity', requireAdmin, (req, res) => {
  try {
    const { from, to } = req.query;
    let where = '';
    const params = [];
    if (from && to) { where = 'AND t.created_at BETWEEN ? AND ?'; params.push(from, to); }
    else if (from) { where = 'AND t.created_at >= ?'; params.push(from); }
    else if (to) { where = 'AND t.created_at <= ?'; params.push(to); }
    const rows = db.prepare(`
      SELECT t.user_id, u.username, u.email, up.full_name, up.phone, t.type, t.amount, t.description, t.created_at
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE 1=1 ${where}
      ORDER BY t.created_at DESC
    `).all(...params);
    const headers = 'User ID,Username,Email,Full Name,Phone,Type,Amount,Description,Date';
    const csv = headers + '\n' + rows.map(r => [r.user_id, r.username, r.email, r.full_name||'', r.phone||'', r.type, r.amount, r.description||'', r.created_at].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mineprofit_activity_log.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export activity error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export/report-deposits', requireAdmin, (req, res) => {
  try {
    const { from, to } = req.query;
    let where = '';
    const params = [];
    if (from && to) { where = 'WHERE p.created_at BETWEEN ? AND ?'; params.push(from, to); }
    else if (from) { where = 'WHERE p.created_at >= ?'; params.push(from); }
    else if (to) { where = 'WHERE p.created_at <= ?'; params.push(to); }

    const rows = db.prepare(`
      SELECT 
        p.id, p.user_id, u.username, u.email, p.amount, p.status, p.method, p.transaction_ref, p.created_at,
        up.full_name, up.phone,
        gw.method AS gw_method, gw.label AS gw_label, gw.upi_id, gw.upi_name, gw.bank_name, gw.bank_account_name, gw.bank_account_number, gw.bank_ifsc,
        ct.symbol AS token_symbol, ct.name AS token_name, ct.network AS token_network
      FROM payments p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN payment_gateways gw ON gw.label = CASE 
         WHEN instr(p.method, ':') > 0 THEN substr(p.method, instr(p.method, ':') + 1)
         ELSE NULL
      END
      LEFT JOIN crypto_tokens ct ON ct.symbol = CASE 
         WHEN instr(p.method, ':') > 0 THEN substr(p.method, instr(p.method, ':') + 1)
         ELSE NULL
      END
      ${where}
      ORDER BY p.created_at DESC
    `).all(...params);

    const headers = [
      'Deposit ID','User ID','Username','Email',
      'Full Name','Phone',
      'Amount (INR)','Status',
      'Method Type','Method Detail',
      'UPI ID','UPI Name',
      'Bank Name','Bank Account Name','Bank Account Number','IFSC',
      'Token Symbol','Token Name','Token Network',
      'Transaction Ref','Date'
    ].join(',');
    const csvRows = rows.map(r => {
      const parts = String(r.method || '').split(':');
      const methodType = parts[0] || '';
      const methodDetail = parts.slice(1).join(':') || '';
      return [
        r.id, r.user_id, r.username, r.email,
        r.full_name || '', r.phone || '',
        r.amount, r.status,
        methodType, methodDetail,
        r.upi_id || '', r.upi_name || '',
        r.bank_name || '', r.bank_account_name || '', r.bank_account_number || '', r.bank_ifsc || '',
        r.token_symbol || '', r.token_name || '', r.token_network || '',
        r.transaction_ref || '', r.created_at
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });

    const csv = headers + '\n' + csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mineprofit_deposits.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export deposits error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export/report-withdrawals', requireAdmin, (req, res) => {
  try {
    const { from, to } = req.query;
    let where = '';
    const params = [];
    if (from && to) { where = 'WHERE w.created_at BETWEEN ? AND ?'; params.push(from, to); }
    else if (from) { where = 'WHERE w.created_at >= ?'; params.push(from); }
    else if (to) { where = 'WHERE w.created_at <= ?'; params.push(to); }

    const rows = db.prepare(`
      SELECT 
        w.id, w.user_id, u.username, u.email, w.amount, w.method, w.status, w.admin_note, w.created_at,
        up.full_name, up.phone, up.bank_name, up.bank_account_name, up.bank_account_number, up.bank_ifsc, up.upi_id
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      ${where}
      ORDER BY w.created_at DESC
    `).all(...params);

    const headers = [
      'Withdrawal ID','User ID','Username','Email',
      'Full Name','Phone',
      'Amount (INR)','Status','Method','Admin Note',
      'Bank Name','Bank Account Name','Bank Account Number','IFSC','UPI ID',
      'Date'
    ].join(',');
    const csvRows = rows.map(r =>
      [r.id, r.user_id, r.username, r.email,
       r.full_name || '', r.phone || '',
       r.amount, r.status, r.method, r.admin_note || '',
       r.bank_name || '', r.bank_account_name || '', r.bank_account_number || '', r.bank_ifsc || '', r.upi_id || '',
       r.created_at
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );

    const csv = headers + '\n' + csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mineprofit_withdrawals.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export withdrawals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/export/report-pnl - Profit & Loss report CSV
router.get('/export/report-pnl', requireAdmin, (req, res) => {
  try {
    const totalDeposits = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status='approved'").get().total;
    const totalWithdrawals = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE status='approved'").get().total;
    const totalMiningPaid = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='mining'").get().total;
    const totalReferralPaid = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='referral'").get().total;
    const totalBonusPaid = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='bonus'").get().total;
    const totalUserBalance = db.prepare("SELECT COALESCE(SUM(balance),0) as total FROM users").get().total;
    const totalPurchases = db.prepare("SELECT COALESCE(SUM(ABS(amount)),0) as total FROM transactions WHERE type='purchase'").get().total;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalMachinesSold = db.prepare('SELECT COUNT(*) as count FROM user_machines').get().count;
    const pendingWithdrawals = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE status='pending'").get().total;
    const pendingDeposits = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status='pending'").get().total;

    const netPnL = totalDeposits - totalWithdrawals;

    const headers = 'Metric,Value';
    const rows = [
      ['Total Deposits (Approved)', totalDeposits],
      ['Total Withdrawals (Approved)', totalWithdrawals],
      ['Net P&L (Deposits - Withdrawals)', netPnL],
      ['Total Mining Earnings Paid', totalMiningPaid],
      ['Total Referral Commissions Paid', totalReferralPaid],
      ['Total Bonus/Spin Winnings Paid', totalBonusPaid],
      ['Total Machine Purchases (Revenue)', totalPurchases],
      ['Outstanding User Balances', totalUserBalance],
      ['Pending Withdrawals', pendingWithdrawals],
      ['Pending Deposits', pendingDeposits],
      ['Total Users', totalUsers],
      ['Total Machines Sold', totalMachinesSold],
    ].map(([k, v]) => `"${k}","${Math.floor(v * 100) / 100}"`);

    const csv = headers + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mineprofit_pnl_report.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export P&L error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/notify/send - Broadcast or targeted message
router.post('/notify/send', requireAdmin, (req, res) => {
  try {
    const { title, message, type, target, usernames, expires_at, require_ack } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });

    const normalizeExpires = (v) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      if (!s) return null;
      if (s.includes('T')) return s.replace('T', ' ') + (s.length === 16 ? ':00' : '');
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(s)) return s + ':00';
      return s;
    };
    
    const audience = target === 'all' ? 'all' : 'targeted';
    const result = db.prepare(`
      INSERT INTO notifications (title, message, type, audience, expires_at, require_ack) 
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, message, type || 'promo', audience, normalizeExpires(expires_at), require_ack ? 1 : 0);
    
    let notifId = result.lastInsertRowid;
    if (!notifId) {
      const row = db.prepare(`SELECT id FROM notifications ORDER BY id DESC LIMIT 1`).get();
      notifId = row?.id || 0;
    }
    let targetCount = 0;

    if (audience === 'targeted' && usernames && usernames.length > 0) {
      // Find user IDs from usernames
      const placeholders = usernames.map(() => '?').join(',');
      const users = db.prepare(`SELECT id FROM users WHERE username IN (${placeholders})`).all(...usernames);
      
      const insertTarget = db.prepare('INSERT OR IGNORE INTO notification_targets (notification_id, user_id) VALUES (?, ?)');
      const insertTx = db.transaction((userList) => {
        for (const user of userList) {
          insertTarget.run(notifId, user.id);
        }
      });
      
      insertTx(users);
      targetCount = users.length;
    } else if (audience === 'all') {
      // For 'all', we don't insert into targets table, handled by logic
      targetCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    }

    res.json({ success: true, id: notifId, targets: targetCount });
  } catch (err) {
    console.error('Notify send error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users/search - Search users for targeting
router.get('/users/search', requireAdmin, (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.length < 2) return res.json({ users: [] });
    
    const users = db.prepare(`
      SELECT id, username FROM users 
      WHERE username LIKE ? OR email LIKE ? 
      LIMIT 10
    `).all(`%${q}%`, `%${q}%`);
    
    res.json({ users });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/admin/notify/list - Recent notifications with stats
router.get('/notify/list', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT n.*, 
        (SELECT COUNT(*) FROM notification_targets nt WHERE nt.notification_id = n.id) as target_count,
        (SELECT COUNT(*) FROM notification_acks na WHERE na.notification_id = n.id) as view_count
      FROM notifications n ORDER BY n.created_at DESC LIMIT 50
    `).all();
    res.json({ notifications: rows });
  } catch (err) {
    console.error('Notify list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/spin/config - List prizes and cost
router.get('/spin/config', requireAdmin, (req, res) => {
  try {
    const prizes = db.prepare(`SELECT * FROM spin_prizes ORDER BY id`).all();
    const costRow = db.prepare(`SELECT value FROM settings WHERE key = 'spin_cost'`).get();
    res.json({ prizes, spin_cost: parseFloat(costRow?.value || '200') });
  } catch (err) {
    console.error('Spin config error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/spin/update - Update a prize
router.post('/spin/update', requireAdmin, (req, res) => {
  try {
    const { id, label, type, amount, machine_id, weight, enabled } = req.body;
    if (!id) return res.status(400).json({ error: 'Prize ID is required' });
    db.prepare(`
      UPDATE spin_prizes SET
        label = ?, type = ?, amount = ?, machine_id = ?, weight = ?, enabled = ?
      WHERE id = ?
    `).run(label, type, amount !== undefined ? amount : null, machine_id || null, parseFloat(weight || 0), enabled ? 1 : 0, id);
    res.json({ success: true });
  } catch (err) {
    console.error('Spin update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/spin/add - Add a new prize
router.post('/spin/add', requireAdmin, (req, res) => {
  try {
    const { label, type, amount, machine_id, weight, enabled } = req.body;
    if (!label || !type) return res.status(400).json({ error: 'Label and type are required' });
    const r = db.prepare(`
      INSERT INTO spin_prizes (label, type, amount, machine_id, weight, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(label, type, amount || null, machine_id || null, parseFloat(weight || 1), enabled ? 1 : 1);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (err) {
    console.error('Spin add error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/spin/cost - Update spin cost
router.post('/spin/cost', requireAdmin, (req, res) => {
  try {
    const { spin_cost } = req.body;
    if (!spin_cost) return res.status(400).json({ error: 'spin_cost required' });
    const existing = db.prepare(`SELECT key FROM settings WHERE key = 'spin_cost'`).get();
    if (existing) db.prepare(`UPDATE settings SET value = ? WHERE key = 'spin_cost'`).run(String(spin_cost));
    else db.prepare(`INSERT INTO settings (key, value) VALUES ('spin_cost', ?)`).run(String(spin_cost));
    res.json({ success: true });
  } catch (err) {
    console.error('Spin cost error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/controls - Update withdraw block/limit for a user
router.post('/users/controls', requireAdmin, (req, res) => {
  try {
    const { user_id, withdraw_blocked, withdraw_limit, withdraw_limit_until, frozen } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });
    db.prepare(`
      UPDATE users SET
        withdraw_blocked = COALESCE(?, withdraw_blocked),
        withdraw_limit = ?,
        withdraw_limit_until = ?,
        frozen = COALESCE(?, frozen)
      WHERE id = ?
    `).run(
      withdraw_blocked !== undefined ? (withdraw_blocked ? 1 : 0) : null,
      withdraw_limit !== undefined && withdraw_limit !== null ? parseFloat(withdraw_limit) : null,
      withdraw_limit_until || null,
      frozen !== undefined ? (frozen ? 1 : 0) : null,
      user_id
    );
    res.json({ success: true });
  } catch (err) {
    console.error('User controls error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/boosters/add - Add a booster to a user
router.post('/users/boosters/add', requireAdmin, (req, res) => {
  try {
    const { user_id, type, value, days } = req.body;
    if (!user_id || !type || value === undefined) return res.status(400).json({ error: 'user_id, type and value are required' });
    let expires = null;
    if (days && parseInt(days) > 0) {
      // sqlite: datetime('now', '+N days')
      const d = parseInt(days);
      expires = db.prepare(`SELECT datetime('now', '+' || ? || ' days') as exp`).get(String(d)).exp;
    }
    const r = db.prepare(`
      INSERT INTO user_boosters (user_id, type, value, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(user_id, type, parseFloat(value), expires);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (err) {
    console.error('Add booster error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users/boosters - List boosters for a user
router.get('/users/boosters', requireAdmin, (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });
    const rows = db.prepare(`
      SELECT * FROM user_boosters WHERE user_id = ? ORDER BY created_at DESC
    `).all(user_id);
    res.json({ boosters: rows });
  } catch (err) {
    console.error('List boosters error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/boosters/remove - Remove booster
router.post('/users/boosters/remove', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Booster ID required' });
    db.prepare(`DELETE FROM user_boosters WHERE id = ?`).run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Remove booster error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PARTNERS
router.get('/partners', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM partners ORDER BY id DESC').all();
    res.json({ partners: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/partners/create', requireAdmin, (req, res) => {
  try {
    const { username, password, active, can_deposits, can_withdrawals, can_messages, can_users, can_profiles, can_dashboard, can_settings, can_machines, can_spin, can_gateways, can_history, can_reports, can_security, can_controls, can_passwords, deposit_limit, withdraw_limit } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const ex = db.prepare('SELECT id FROM partners WHERE username = ?').get(username);
    if (ex) return res.status(400).json({ error: 'Username exists' });
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      INSERT INTO partners (
        username, password_hash, active, 
        can_deposits, can_withdrawals, can_messages, can_users, can_profiles,
        can_dashboard, can_settings, can_machines, can_spin, can_gateways, 
        can_history, can_reports, can_security, can_controls, can_passwords,
        deposit_limit, withdraw_limit
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      username, hash, active ? 1 : 0, 
      can_deposits ? 1 : 0, can_withdrawals ? 1 : 0, can_messages ? 1 : 0, can_users ? 1 : 0, can_profiles ? 1 : 0,
      can_dashboard ? 1 : 0, can_settings ? 1 : 0, can_machines ? 1 : 0, can_spin ? 1 : 0, can_gateways ? 1 : 0,
      can_history ? 1 : 0, can_reports ? 1 : 0, can_security ? 1 : 0, can_controls ? 1 : 0, can_passwords ? 1 : 0,
      deposit_limit || null, withdraw_limit || null
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/partners/update', requireAdmin, (req, res) => {
  try {
    const { id, active, can_deposits, can_withdrawals, can_messages, can_users, can_profiles, can_dashboard, can_settings, can_machines, can_spin, can_gateways, can_history, can_reports, can_security, can_controls, can_passwords, deposit_limit, withdraw_limit } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    db.prepare(`
      UPDATE partners SET
        active = ?, can_deposits = ?, can_withdrawals = ?, can_messages = ?, can_users = ?, can_profiles = ?,
        can_dashboard = ?, can_settings = ?, can_machines = ?, can_spin = ?, can_gateways = ?, 
        can_history = ?, can_reports = ?, can_security = ?, can_controls = ?, can_passwords = ?,
        deposit_limit = ?, withdraw_limit = ?
      WHERE id = ?
    `).run(
      active ? 1 : 0, can_deposits ? 1 : 0, can_withdrawals ? 1 : 0, can_messages ? 1 : 0, can_users ? 1 : 0, can_profiles ? 1 : 0,
      can_dashboard ? 1 : 0, can_settings ? 1 : 0, can_machines ? 1 : 0, can_spin ? 1 : 0, can_gateways ? 1 : 0,
      can_history ? 1 : 0, can_reports ? 1 : 0, can_security ? 1 : 0, can_controls ? 1 : 0, can_passwords ? 1 : 0,
      deposit_limit || null, withdraw_limit || null, id
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/partners/reset-password', requireAdmin, (req, res) => {
  try {
    const { id, new_password } = req.body;
    if (!id || !new_password || new_password.length < 6) return res.status(400).json({ error: 'ID and password (min 6) required' });
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE partners SET password_hash = ? WHERE id = ?').run(hash, id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/partners/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    db.prepare('DELETE FROM partners WHERE id = ?').run(id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Impersonate user
router.post('/users/impersonate', requireAdmin, (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    req.session.userId = user.id;
    req.session.impersonatedBy = req.session.adminId || null;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
