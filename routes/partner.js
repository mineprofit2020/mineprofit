const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { requirePartner, requirePartnerPermission } = require('../middleware/partner');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// Auth routes
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const p = await db.prepare('SELECT * FROM partners WHERE username = ?').get(username);
    if (!p || !p.active || !bcrypt.compareSync(password, p.password_hash)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    req.session.partnerId = p.id;
    req.session.partnerUsername = p.username;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  req.session.partnerId = null;
  req.session.partnerUsername = null;
  res.json({ success: true });
});

router.get('/check', (req, res) => {
  res.json({ authenticated: !!req.session?.partnerId });
});

router.get('/me', requirePartner, async (req, res) => {
  try {
    const p = await db.prepare('SELECT * FROM partners WHERE id = ?').get(req.session.partnerId);
    if (!p) return res.status(404).json({ error: 'Partner not found' });
    delete p.password_hash;
    res.json({ partner: p });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/password/change', requirePartner, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Current and new password are required' });
    if (String(new_password).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const p = await db.prepare('SELECT * FROM partners WHERE id = ?').get(req.session.partnerId);
    if (!p) return res.status(404).json({ error: 'Partner not found' });
    if (!bcrypt.compareSync(current_password, p.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = bcrypt.hashSync(new_password, 10);
    await db.prepare('UPDATE partners SET password_hash = ? WHERE id = ?').run(hash, p.id);
    res.json({ success: true, message: 'Password updated' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- TOOLS ---

// Dashboard Overview
router.get('/dashboard', requirePartnerPermission('can_dashboard'), async (req, res) => {
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
      totalUsers: Number(totalUsers), totalBalance: Math.floor(Number(totalBalance) * 100) / 100,
      totalMachines: Number(totalMachines), totalWithdrawals: Math.floor(Number(totalWithdrawals) * 100) / 100,
      pendingWithdrawals: Number(pendingWithdrawals), pendingPayments: Number(pendingPayments), totalDeposits: Math.floor(Number(totalDeposits) * 100) / 100,
      unreadMessages: Number(unreadMessages)
    });
  } catch (err) {
    console.error('Partner dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Users Management
router.get('/users', requirePartnerPermission('can_users'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search.trim()}%` : '%';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder === 'ASC' ? 'ASC' : 'DESC';

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
    const totalUsers = (await db.prepare(`SELECT COUNT(*) as count FROM users WHERE (username LIKE ? OR email LIKE ?)`).get(search, search)).count;

    res.json({ users, page, totalPages: Math.ceil(Number(totalUsers) / limit), totalUsers: Number(totalUsers) });
  } catch (err) {
    console.error('Partner users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/create', requirePartnerPermission('can_users'), async (req, res) => {
  try {
    const { username, email, password, balance, free_spins } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const unameLC = String(username).toLowerCase();
    const ex = await db.prepare('SELECT id FROM users WHERE email = ? OR LOWER(username) = ?').get(email, unameLC);
    if (ex) return res.status(400).json({ error: 'Username or email exists' });
    
    const hash = bcrypt.hashSync(password, 10);
    const crypto = require('crypto');
    const ref = crypto.randomBytes(4).toString('hex').toUpperCase();
    const initialBalance = parseFloat(balance) || 0;
    const initialSpins = parseInt(free_spins) || 1;

    const result = await db.prepare(`
      INSERT INTO users (username, email, password_hash, plain_password, balance, referral_code, free_spins)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(String(username).trim(), email, hash, password, initialBalance, ref, initialSpins);
    
    const userId = result.lastInsertRowid;
    await db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 1)').run(userId);
    await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', 0, 'Received free Mini Miner (partner created)')`).run(userId);
    if (initialBalance > 0) {
      await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'deposit', ?, 'Initial balance set by partner')`).run(userId, initialBalance);
    }
    res.json({ success: true, user_id: userId });
  } catch (err) {
    console.error('Partner user create error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/controls', requirePartnerPermission('can_controls'), async (req, res) => {
  try {
    const { user_id, withdraw_blocked, withdraw_limit, withdraw_limit_until, frozen } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });
    await db.prepare(`
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
    console.error('Partner controls error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/password', requirePartnerPermission('can_passwords'), async (req, res) => {
  try {
    const { user_id, new_password } = req.body;
    if (!user_id || !new_password || new_password.length < 6) return res.status(400).json({ error: 'Invalid input' });
    const hash = bcrypt.hashSync(new_password, 10);
    await db.prepare('UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?').run(hash, new_password, user_id);
    res.json({ success: true });
  } catch (err) {
    console.error('Partner password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users/history', requirePartnerPermission('can_history'), async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username required' });
    const user = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(String(username).trim().toLowerCase());
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const profile = await db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(user.id);
    const machines = await db.prepare(`
      SELECT um.id, um.purchased_at, m.name, m.earning_per_hour, m.icon, m.price
      FROM user_machines um JOIN machines m ON um.machine_id = m.id
      WHERE um.user_id = ? ORDER BY um.purchased_at DESC
    `).all(user.id);
    const transactions = await db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`).all(user.id);
    const withdrawals = await db.prepare(`SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`).all(user.id);
    const payments = await db.prepare(`SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC`).all(user.id);
    const spins = await db.prepare(`SELECT * FROM spin_history WHERE user_id = ? ORDER BY created_at DESC`).all(user.id);

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
    console.error('Partner history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Payments
router.get('/payments', requirePartnerPermission('can_deposits'), async (req, res) => {
  try {
    const payments = await db.prepare(`
      SELECT p.*, u.username, u.email
      FROM payments p JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC LIMIT 100
    `).all();
    res.json({ payments, limit: req.partner.deposit_limit });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/payments/update', requirePartnerPermission('can_deposits'), async (req, res) => {
  try {
    const { id, status } = req.body;
    if (!id || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid request' });
    const pay = await db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!pay || pay.status !== 'pending') return res.status(400).json({ error: 'Payment not processable' });
    if (req.partner.deposit_limit && status === 'approved' && Number(pay.amount) > Number(req.partner.deposit_limit)) return res.status(403).json({ error: 'Exceeds your deposit approval limit' });
    
    await db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, id);
    if (status === 'approved') {
      const amt = Number(pay.amount);
      await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, pay.user_id);
      await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'deposit', ?, ?)`)
        .run(pay.user_id, amt, `Deposit via ${pay.method.toUpperCase()} - ₹${amt} (partner approved)`);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Withdrawals
router.get('/withdrawals', requirePartnerPermission('can_withdrawals'), async (req, res) => {
  try {
    const withdrawals = await db.prepare(`
      SELECT w.*, u.username, u.email, up.bank_account_name, up.bank_account_number, up.bank_ifsc, up.bank_name, up.upi_id
      FROM withdrawals w 
      JOIN users u ON w.user_id = u.id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      ORDER BY w.created_at DESC LIMIT 100
    `).all();
    res.json({ withdrawals, limit: req.partner.withdraw_limit });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/withdrawals/update', requirePartnerPermission('can_withdrawals'), async (req, res) => {
  try {
    const { id, status, admin_note } = req.body;
    if (!id || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid request' });
    const w = await db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
    if (!w || w.status !== 'pending') return res.status(400).json({ error: 'Withdrawal not processable' });
    if (req.partner.withdraw_limit && status === 'approved' && Number(w.amount) > Number(req.partner.withdraw_limit)) return res.status(403).json({ error: 'Exceeds your withdrawal approval limit' });
    
    await db.prepare('UPDATE withdrawals SET status = ?, admin_note = ? WHERE id = ?').run(status, admin_note || '', id);
    if (status === 'rejected') {
      const amt = Number(w.amount);
      await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, w.user_id);
      await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'refund', ?, 'Withdrawal rejected (partner)')`)
        .run(w.user_id, amt);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Settings
router.get('/settings', requirePartnerPermission('can_settings'), async (req, res) => {
  try {
    const rows = await db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/settings/update', requirePartnerPermission('can_settings'), async (req, res) => {
  try {
    const allowed = [
      'spin_difficulty', 'game_lucky_difficulty', 'game_dice_difficulty', 
      'spin_reward_multiplier', 'usdt_inr_rate', 'spin_cost',
      'min_withdrawal', 'max_withdrawal', 'withdrawal_fee_percent'
    ];
    const updates = req.body;
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(key, String(updates[key]));
      }
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Machines
router.get('/machines', requirePartnerPermission('can_machines'), async (req, res) => {
  try {
    const machines = await db.prepare('SELECT * FROM machines ORDER BY price ASC').all();
    res.json({ machines });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/machines/update', requirePartnerPermission('can_machines'), async (req, res) => {
  try {
    const { id, name, price, earning_per_hour, description, icon } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    
    const existing = await db.prepare('SELECT * FROM machines WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Machine not found' });

    await db.prepare(`
      UPDATE machines SET 
        name = COALESCE(?, name),
        price = COALESCE(?, price),
        earning_per_hour = COALESCE(?, earning_per_hour),
        description = COALESCE(?, description),
        icon = COALESCE(?, icon)
      WHERE id = ?
    `).run(name || null, price || null, earning_per_hour || null, description || null, icon || null, id);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Partner machine update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Gateways
router.get('/gateways', requirePartnerPermission('can_gateways'), async (req, res) => {
  try {
    const gateways = await db.prepare('SELECT * FROM payment_gateways ORDER BY created_at DESC').all();
    const tokens = await db.prepare('SELECT * FROM crypto_tokens ORDER BY created_at DESC').all();
    res.json({ gateways, tokens });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Spin
router.get('/spin/config', requirePartnerPermission('can_spin'), async (req, res) => {
  try {
    const prizes = await db.prepare(`SELECT * FROM spin_prizes ORDER BY id`).all();
    res.json({ prizes });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Reports
router.get('/export/users', requirePartnerPermission('can_reports'), async (req, res) => {
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
    console.error('Partner export user report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Messages & Notifications
router.get('/notify/list', requirePartnerPermission('can_messages'), async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT n.*, 
        (SELECT COUNT(*) FROM notification_targets nt WHERE nt.notification_id = n.id) as target_count,
        (SELECT COUNT(*) FROM notification_acks na WHERE na.notification_id = n.id) as view_count
      FROM notifications n ORDER BY n.created_at DESC LIMIT 50
    `).all();
    res.json({ notifications: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/contacts', requirePartnerPermission('can_messages'), async (req, res) => {
  try {
    const messages = await db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100').all();
    res.json({ messages });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/notify/send', requirePartnerPermission('can_messages'), async (req, res) => {
  try {
    const { title, message, target, usernames, expires_at, require_ack } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });
    
    const audience = target === 'all' ? 'all' : 'targeted';
    const result = await db.prepare(`INSERT INTO notifications (title, message, type, audience, expires_at, require_ack) VALUES (?, ?, 'promo', ?, ?, ?)`)
      .run(title, message, audience, expires_at || null, require_ack ? 1 : 0);
    
    const notifId = result.lastInsertRowid;
    if (audience === 'targeted' && usernames && usernames.length > 0) {
      const placeholders = usernames.map(() => '?').join(',');
      const users = await db.prepare(`SELECT id FROM users WHERE username IN (${placeholders})`).all(...usernames);
      for (const u of users) await db.prepare(`INSERT INTO notification_targets (notification_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`).run(notifId, u.id);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
