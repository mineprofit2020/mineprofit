const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    // Get all user machines with details
    const userMachines = db.prepare(`
      SELECT um.id, um.purchased_at, m.name, m.earning_per_hour, m.icon
      FROM user_machines um
      JOIN machines m ON um.machine_id = m.id
      WHERE um.user_id = ?
      ORDER BY m.earning_per_hour DESC
    `).all(userId);

    // Calculate total earning per hour
    const basePerHour = userMachines.reduce((sum, m) => sum + m.earning_per_hour, 0);

    // Active speed boosters multiplier
    const boosters = db.prepare(`
      SELECT value FROM user_boosters
      WHERE user_id = ? AND type = 'speed' AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all(userId);
    const boostMul = 1 + boosters.reduce((s, b) => s + (b.value || 0), 0);
    const totalPerHour = Math.floor(basePerHour * boostMul * 100) / 100;

    // Calculate uncollected earnings
    const lastCollected = new Date(user.last_collected_at + 'Z');
    const now = new Date();
    const hoursElapsed = (now - lastCollected) / (1000 * 60 * 60);
    const uncollectedEarnings = Math.floor(totalPerHour * hoursElapsed * 100) / 100;

    // Count machines by type
    const machineCounts = {};
    userMachines.forEach(m => {
      if (!machineCounts[m.name]) {
        machineCounts[m.name] = { count: 0, icon: m.icon, earning_per_hour: m.earning_per_hour };
      }
      machineCounts[m.name].count++;
    });

    res.json({
      username: user.username,
      balance: Math.floor(user.balance * 100) / 100,
      totalPerHour,
      uncollectedEarnings,
      totalMachines: userMachines.length,
      machineCounts,
      referralCode: user.referral_code,
      memberSince: user.created_at,
      boostMultiplier: Math.floor(boostMul * 100) / 100
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/dashboard/collect
router.post('/collect', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    const userMachines = db.prepare(`
      SELECT m.earning_per_hour
      FROM user_machines um
      JOIN machines m ON um.machine_id = m.id
      WHERE um.user_id = ?
    `).all(userId);

    const basePerHour = userMachines.reduce((sum, m) => sum + m.earning_per_hour, 0);

    // Active speed boosters multiplier
    const boosters = db.prepare(`
      SELECT value FROM user_boosters
      WHERE user_id = ? AND type = 'speed' AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all(userId);
    const boostMul = 1 + boosters.reduce((s, b) => s + (b.value || 0), 0);
    const totalPerHour = Math.floor(basePerHour * boostMul * 100) / 100;

    const lastCollected = new Date(user.last_collected_at + 'Z');
    const now = new Date();
    const hoursElapsed = (now - lastCollected) / (1000 * 60 * 60);
    const earnings = Math.floor(totalPerHour * hoursElapsed * 100) / 100;

    if (earnings < 0.01) {
      return res.json({ success: false, message: 'Nothing to collect yet. Wait a bit!' });
    }

    // Update balance and last_collected_at
    db.prepare(`
      UPDATE users SET balance = balance + ?, last_collected_at = datetime('now') WHERE id = ?
    `).run(earnings, userId);

    // Log transaction
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, description)
      VALUES (?, 'mining', ?, 'Collected mining earnings')
    `).run(userId, earnings);

    res.json({
      success: true,
      collected: earnings,
      newBalance: Math.floor((user.balance + earnings) * 100) / 100
    });
  } catch (err) {
    console.error('Collect error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/referrals
router.get('/referrals', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;

    // Level 1: Direct referrals
    const level1 = db.prepare(`
      SELECT id, username, created_at FROM users WHERE referred_by_user_id = ?
    `).all(userId);

    // Level 2: Referrals of Level 1
    const level1Ids = level1.map(u => u.id);
    let level2 = [];
    if (level1Ids.length > 0) {
      const placeholders = level1Ids.map(() => '?').join(',');
      level2 = db.prepare(`
        SELECT id, username, created_at FROM users WHERE referred_by_user_id IN (${placeholders})
      `).all(...level1Ids);
    }

    // Level 3: Referrals of Level 2
    const level2Ids = level2.map(u => u.id);
    let level3 = [];
    if (level2Ids.length > 0) {
      const placeholders = level2Ids.map(() => '?').join(',');
      level3 = db.prepare(`
        SELECT id, username, created_at FROM users WHERE referred_by_user_id IN (${placeholders})
      `).all(...level2Ids);
    }

    // Calculate referral earnings from transactions
    const refEarnings = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE user_id = ? AND type = 'referral'
    `).get(userId);

    res.json({
      level1: { count: level1.length, users: level1 },
      level2: { count: level2.length, users: level2 },
      level3: { count: level3.length, users: level3 },
      totalReferrals: level1.length + level2.length + level3.length,
      totalReferralEarnings: Math.floor(refEarnings.total * 100) / 100
    });
  } catch (err) {
    console.error('Referrals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/transactions
router.get('/transactions', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const transactions = db.prepare(`
      SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(userId);

    res.json({ transactions });
  } catch (err) {
    console.error('Transactions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/promotions - Notifications + active boosters
router.get('/promotions', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const notifications = db.prepare(`
      SELECT n.*,
        CASE WHEN na.user_id IS NULL THEN 0 ELSE 1 END as acked
      FROM notifications n
      LEFT JOIN notification_targets nt ON nt.notification_id = n.id AND nt.user_id = ?
      LEFT JOIN notification_acks na ON na.notification_id = n.id AND na.user_id = ?
      WHERE (n.audience = 'all' OR nt.user_id IS NOT NULL)
        AND (n.expires_at IS NULL OR datetime(n.expires_at) > datetime('now','localtime'))
      GROUP BY n.id
      ORDER BY n.created_at DESC
      LIMIT 20
    `).all(userId, userId);
    const boosters = db.prepare(`
      SELECT id, type, value, expires_at, created_at
      FROM user_boosters
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY created_at DESC
    `).all(userId);
    res.json({ notifications, boosters });
  } catch (err) {
    console.error('Promotions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
