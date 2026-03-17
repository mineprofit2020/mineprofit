const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// GET /api/shop/machines
router.get('/machines', requireAuth, async (req, res) => {
  try {
    const machines = await db.prepare('SELECT * FROM machines ORDER BY price ASC').all();
    const userId = req.session.userId;

    // Get count of each machine the user owns
    const owned = await db.prepare(`
      SELECT machine_id, COUNT(*) as count
      FROM user_machines WHERE user_id = ?
      GROUP BY machine_id
    `).all(userId);

    const ownedMap = {};
    owned.forEach(o => { ownedMap[o.machine_id] = o.count; });

    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    const discRows = await db.prepare(`
      SELECT value FROM user_boosters
      WHERE user_id = ? AND type = 'discount' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).all(userId);
    let discount = discRows.reduce((s, b) => s + (Number(b.value) || 0), 0);
    if (discount < 0) discount = 0;
    if (discount > 0.9) discount = 0.9;

    res.json({
      machines: machines.map(m => ({
        ...m,
        owned: ownedMap[m.id] || 0,
        effective_price: Math.ceil(Number(m.price) * (1 - discount)),
        discount
      })),
      balance: Math.floor(Number(user.balance) * 100) / 100
    });
  } catch (err) {
    console.error('Shop error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/shop/buy
router.post('/buy', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { machineId } = req.body;

    if (!machineId) {
      return res.status(400).json({ error: 'Machine ID required' });
    }

    const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(machineId);
    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    if (Number(machine.price) === 0) {
      return res.status(400).json({ error: 'This machine is only available as a signup bonus' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const discRows = await db.prepare(`
      SELECT value FROM user_boosters
      WHERE user_id = ? AND type = 'discount' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).all(userId);
    let discount = discRows.reduce((s, b) => s + (Number(b.value) || 0), 0);
    if (discount < 0) discount = 0;
    if (discount > 0.9) discount = 0.9;
    const effectivePrice = Math.ceil(Number(machine.price) * (1 - discount));

    if (Number(user.balance) < effectivePrice) {
      return res.status(400).json({ error: `Insufficient balance. Need ₹${effectivePrice}, have ₹${Math.floor(Number(user.balance) * 100) / 100}` });
    }

    // Transaction: deduct balance, add machine, pay referral commissions
    await db.transaction(async (client) => {
      // Deduct balance
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [effectivePrice, userId]);

      // Add machine
      await client.query('INSERT INTO user_machines (user_id, machine_id) VALUES ($1, $2)', [userId, machineId]);

      // Log purchase transaction
      await client.query(`
        INSERT INTO transactions (user_id, type, amount, description)
        VALUES ($1, 'purchase', $2, $3)
      `, [userId, -effectivePrice, `Purchased ${machine.name}${discount ? ` (discount applied)` : ''}`]);

      // Pay referral commissions
      await payReferralCommission(client, userId, effectivePrice, machine.name);
    });

    const updatedUser = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);

    res.json({
      success: true,
      message: `Successfully purchased ${machine.name}!`,
      newBalance: Math.floor(Number(updatedUser.balance) * 100) / 100
    });
  } catch (err) {
    console.error('Buy error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

async function payReferralCommission(client, userId, purchaseAmount, machineName) {
  const commissionRates = [0.05, 0.03, 0.015]; // L1: 5%, L2: 3%, L3: 1.5%
  let currentUserId = userId;

  for (let level = 0; level < 3; level++) {
    const res = await client.query('SELECT referred_by_user_id FROM users WHERE id = $1', [currentUserId]);
    const user = res.rows[0];
    if (!user || !user.referred_by_user_id) break;

    const referrerId = user.referred_by_user_id;
    const commission = Math.floor(purchaseAmount * commissionRates[level] * 100) / 100;

    if (commission > 0) {
      // Add commission to referrer's balance
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [commission, referrerId]);

      // Log referral transaction
      await client.query(`
        INSERT INTO transactions (user_id, type, amount, description)
        VALUES ($1, 'referral', $2, $3)
      `, [referrerId, commission, `Level ${level + 1} commission from ${machineName} purchase (${commissionRates[level] * 100}%)`]);
    }

    currentUserId = referrerId;
  }
}

module.exports = router;
