const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

async function getSpinCost() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'spin_cost'`).get();
  const v = parseFloat(row?.value || '200');
  return isNaN(v) ? 200 : v;
}

async function getPrizes() {
  const rows = await db.prepare(`
    SELECT id, label, type, amount, machine_id, weight, enabled
    FROM spin_prizes WHERE enabled = 1
  `).all();
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    value: r.type === 'balance' ? (Number(r.amount) || 0) : r.type === 'machine' ? r.machine_id : null,
    machineId: r.machine_id || null,
    amount: Number(r.amount) || 0,
    label: r.label,
    weight: Number(r.weight)
  }));
}

async function getSpinTunables() {
  const d = await db.prepare(`SELECT key, value FROM settings WHERE key IN ('spin_difficulty','spin_reward_multiplier')`).all();
  const map = {};
  d.forEach(r => { map[r.key] = r.value; });
  const difficulty = Math.max(0, Math.min(100, parseFloat(map['spin_difficulty'] || '0')));
  const rewardMul = Math.max(0.1, parseFloat(map['spin_reward_multiplier'] || '1'));
  return { difficulty, rewardMul };
}

async function pickPrizeDynamic() {
  const prizes = await getPrizes();
  if (prizes.length === 0) return null;
  const { difficulty } = await getSpinTunables();
  const weights = prizes.map(p => {
    let w = p.weight || 0;
    if (p.type === 'lose') {
      w = w * (1 + difficulty / 50);
    } else {
      w = w * Math.max(0.1, 1 - difficulty / 150);
    }
    return { p, w };
  });
  const total = weights.reduce((s, x) => s + x.w, 0);
  let rand = Math.random() * total;
  for (const x of weights) {
    rand -= x.w;
    if (rand <= 0) return x.p;
  }
  return weights[0].p;
}

// GET /api/spin/status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await db.prepare('SELECT balance, free_spins FROM users WHERE id = ?').get(userId);
    const history = await db.prepare('SELECT * FROM spin_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId);

    // Get real recent wins
    let realWins = await db.prepare(`
      SELECT sh.prize_type, sh.prize_value, sh.created_at, u.username
      FROM spin_history sh JOIN users u ON sh.user_id = u.id
      WHERE sh.prize_type = 'machine'
      ORDER BY sh.created_at DESC LIMIT 10
    `).all();

    // Generate fake "Big Wins" to create social proof
    const fakeWins = [];
    const bigPrizes = ['Mega Machine', 'Ultra Excavator', 'Diamond Drill', 'Quantum Miner', 'Turbo Miner'];
    const names = ['Rahul', 'Anjali', 'Amit', 'Sneha', 'Vikram', 'Pooja', 'Arjun', 'Neha', 'Karan', 'Divya', 'Raj', 'Riya', 'Varun', 'Tanvi', 'Vishal', 'Aisha', 'Rohit', 'Meera'];
    
    // Generate 5-8 fake wins
    const numFakes = Math.floor(Math.random() * 4) + 5;
    const now = Date.now();
    
    for (let i = 0; i < numFakes; i++) {
      const uname = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 90 + 10);
      const prize = bigPrizes[Math.floor(Math.random() * bigPrizes.length)];
      // Random time within last 4 hours
      const timeOffset = Math.floor(Math.random() * 4 * 60 * 60 * 1000); 
      fakeWins.push({
        prize_type: 'machine',
        prize_value: prize,
        created_at: new Date(now - timeOffset).toISOString(),
        username: uname,
        is_fake: true
      });
    }

    // Merge and sort
    let recentWins = [...realWins, ...fakeWins];
    recentWins.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    recentWins = recentWins.slice(0, 15); // Keep top 15

    const dbPrizes = await getPrizes();
    res.json({
      freeSpins: user.free_spins || 0,
      balance: Math.floor(Number(user.balance) * 100) / 100,
      spinCost: await getSpinCost(),
      prizes: dbPrizes.map(p => ({ label: p.label, type: p.type })),
      history,
      recentWins
    });
  } catch (err) {
    console.error('Spin status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/spin/play - Use a free spin
router.post('/play', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await db.prepare('SELECT balance, free_spins FROM users WHERE id = ?').get(userId);

    if ((user.free_spins || 0) < 1) {
      const spinCost = await getSpinCost();
      return res.status(400).json({ error: 'No free spins available. Buy a spin for ₹' + spinCost + '!' });
    }

    const prize = await pickPrizeDynamic();
    if (!prize) return res.status(500).json({ error: 'Spin is temporarily unavailable' });

    await db.transaction(async (client) => {
      // Deduct free spin
      await client.query('UPDATE users SET free_spins = free_spins - 1 WHERE id = $1', [userId]);

      // Award prize
      if (prize.type === 'machine') {
        await client.query('INSERT INTO user_machines (user_id, machine_id) VALUES ($1, $2)', [userId, prize.machineId]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', 0, $2)`, [userId, `Won machine from Spin Wheel!`]);
      } else if (prize.type === 'balance') {
        const { rewardMul } = await getSpinTunables();
        const amt = Math.floor(((Number(prize.amount) || Number(prize.value) || 0) * rewardMul) * 100) / 100;
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amt, userId]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)`, [userId, amt, `Won ₹${amt} from Spin Wheel!`]);
      } else if (prize.type === 'lose') {
        // No reward
      }

      // Log spin
      const prizeValue = prize.type === 'machine'
        ? (prize.machineId || '').toString()
        : prize.type === 'balance'
          ? (Number(prize.amount) || Number(prize.value) || 0).toString()
          : 'lose';
      await client.query('INSERT INTO spin_history (user_id, prize_type, prize_value) VALUES ($1, $2, $3)', [userId, prize.type, prizeValue]);
    });

    const updatedUser = await db.prepare('SELECT balance, free_spins FROM users WHERE id = ?').get(userId);

    res.json({
      success: true,
      prize: {
        type: prize.type,
        value: prize.type === 'machine' ? prize.machineId : prize.type === 'balance' ? (Number(prize.amount) || Number(prize.value) || 0) : 'lose',
        label: prize.label
      },
      freeSpins: updatedUser.free_spins || 0,
      balance: Math.floor(Number(updatedUser.balance) * 100) / 100
    });
  } catch (err) {
    console.error('Spin play error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/spin/bundle - Buy a bundle of spins (5, 10, 20) with discount
router.post('/bundle', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { count } = req.body;
    
    if (![5, 10, 20].includes(count)) {
      return res.status(400).json({ error: 'Invalid bundle size. Choose 5, 10, or 20.' });
    }

    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    const SPIN_COST = await getSpinCost();
    
    let discount = 0;
    if (count === 5) discount = 0.05; // 5% off
    else if (count === 10) discount = 0.10; // 10% off
    else if (count === 20) discount = 0.15; // 15% off
    
    const totalCost = Math.floor(SPIN_COST * count * (1 - discount));

    if (Number(user.balance) < totalCost) {
      return res.status(400).json({ error: `Insufficient balance. Need ₹${totalCost}, have ₹${Math.floor(Number(user.balance) * 100) / 100}` });
    }

    const results = [];
    let totalWonBalance = 0;

    await db.transaction(async (client) => {
      // Deduct cost
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [totalCost, userId]);
      await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'purchase', $2, $3)`, [userId, -totalCost, `Purchased ${count} Spins Bundle`]);

      const { rewardMul } = await getSpinTunables();

      for (let i = 0; i < count; i++) {
        const prize = await pickPrizeDynamic();
        if (!prize) continue; // Should not happen

        let prizeValue = 'lose';
        let prizeDesc = 'Better luck next time';

        if (prize.type === 'machine') {
          await client.query('INSERT INTO user_machines (user_id, machine_id) VALUES ($1, $2)', [userId, prize.machineId]);
          await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', 0, $2)`, [userId, `Won machine from Spin Bundle`]);
          prizeValue = (prize.machineId || '').toString();
          prizeDesc = prize.label;
        } else if (prize.type === 'balance') {
          const amt = Math.floor(((Number(prize.amount) || Number(prize.value) || 0) * rewardMul) * 100) / 100;
          await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amt, userId]);
          await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)`, [userId, amt, `Won ₹${amt} from Spin Bundle`]);
          prizeValue = amt.toString();
          totalWonBalance += amt;
          prizeDesc = `₹${amt}`;
        }

        await client.query('INSERT INTO spin_history (user_id, prize_type, prize_value) VALUES ($1, $2, $3)', [userId, prize.type, prizeValue]);
        
        results.push({
          type: prize.type,
          label: prize.label,
          value: prizeValue,
          desc: prizeDesc
        });
      }
    });

    const updatedUser = await db.prepare('SELECT balance, free_spins FROM users WHERE id = ?').get(userId);

    res.json({
      success: true,
      results,
      totalCost,
      balance: Math.floor(Number(updatedUser.balance) * 100) / 100
    });
  } catch (err) {
    console.error('Spin bundle error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/spin/buy - Buy a spin with balance
router.post('/buy', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    const SPIN_COST = await getSpinCost();

    if (Number(user.balance) < SPIN_COST) {
      return res.status(400).json({ error: `Insufficient balance. Need ₹${SPIN_COST}, have ₹${Math.floor(Number(user.balance) * 100) / 100}` });
    }

    const prize = await pickPrizeDynamic();
    if (!prize) return res.status(500).json({ error: 'Spin is temporarily unavailable' });

    await db.transaction(async (client) => {
      // Deduct cost
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [SPIN_COST, userId]);
      await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'purchase', $2, 'Purchased Spin Wheel chance')`, [userId, -SPIN_COST]);

      // Award prize
      if (prize.type === 'machine') {
        await client.query('INSERT INTO user_machines (user_id, machine_id) VALUES ($1, $2)', [userId, prize.machineId]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', 0, $2)`, [userId, `Won machine from Spin Wheel!`]);
      } else if (prize.type === 'balance') {
        const { rewardMul } = await getSpinTunables();
        const amt = Math.floor(((Number(prize.amount) || Number(prize.value) || 0) * rewardMul) * 100) / 100;
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amt, userId]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)`, [userId, amt, `Won ₹${amt} from Spin Wheel!`]);
      } else if (prize.type === 'lose') {
        // No reward
      }

      const prizeValue = prize.type === 'machine'
        ? (prize.machineId || '').toString()
        : prize.type === 'balance'
          ? (Number(prize.amount) || Number(prize.value) || 0).toString()
          : 'lose';
      await client.query('INSERT INTO spin_history (user_id, prize_type, prize_value) VALUES ($1, $2, $3)', [userId, prize.type, prizeValue]);
    });

    const updatedUser = await db.prepare('SELECT balance, free_spins FROM users WHERE id = ?').get(userId);

    res.json({
      success: true,
      prize: {
        type: prize.type,
        value: prize.type === 'machine' ? prize.machineId : prize.type === 'balance' ? (Number(prize.amount) || Number(prize.value) || 0) : 'lose',
        label: prize.label
      },
      freeSpins: updatedUser.free_spins || 0,
      balance: Math.floor(Number(updatedUser.balance) * 100) / 100
    });
  } catch (err) {
    console.error('Spin buy error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
