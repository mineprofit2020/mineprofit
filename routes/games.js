const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

async function getUserBalance(userId) {
  const row = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  return Number(row?.balance || 0);
}

function safeNumber(x, d = 0) {
  const n = parseFloat(x);
  if (isNaN(n) || !isFinite(n)) return d;
  return n;
}

async function getGameRules(gameType) {
  try {
    const row = await db.prepare('SELECT rules, is_active FROM game_rules WHERE game_type = ?').get(gameType);
    if (!row || Number(row.is_active) === 0) return { disabled: true };
    return typeof row.rules === 'string' ? JSON.parse(row.rules) : row.rules;
  } catch { return null; }
}

router.post('/lucky/play', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const bet = Math.floor(safeNumber(req.body.bet, 0));
    const pick = Math.floor(safeNumber(req.body.pick, 0));
    
    // Load rules from Rule Book
    const rules = await getGameRules('lucky');
    if (rules?.disabled) return res.status(403).json({ error: 'This game is currently disabled by admin.' });
    
    const activeRules = rules || { min_bet: 10, max_bet: 5000, base_multiplier: 9, house_edge: 0.05 };
    
    if (bet < activeRules.min_bet) return res.status(400).json({ error: `Minimum bet is ₹${activeRules.min_bet}` });
    if (bet > activeRules.max_bet) return res.status(400).json({ error: `Maximum bet is ₹${activeRules.max_bet}` });
    if (pick < 1 || pick > 10) return res.status(400).json({ error: 'Pick a number between 1 and 10' });
    
    const bal = await getUserBalance(userId);
    if (bal < bet) return res.status(400).json({ error: 'Insufficient balance' });
    
    const result = 1 + Math.floor(Math.random() * 10);
    const win = result === pick;
    
    // Apply house edge factor from Rule Book
    const factor = 1 - (Number(activeRules.house_edge) || 0.05);
    const payout = win ? Math.floor(bet * Number(activeRules.base_multiplier) * factor) : 0;
    
    await db.transaction(async (client) => {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [bet, userId]);
      await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'game', $2, $3)`, [userId, -bet, 'Lucky Number bet']);
      if (payout > 0) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, userId]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)`, [userId, payout, 'Lucky Number win']);
      }
    });
    
    // Record game history
    await db.prepare(`
      INSERT INTO game_history (user_id, game_type, bet_amount, multiplier, payout, details)
      VALUES (?, 'lucky', ?, ?, ?, ?)
    `).run(userId, bet, Number(activeRules.base_multiplier), payout, JSON.stringify({ result }));

    const newBal = await getUserBalance(userId);
    res.json({ success: true, result, drawn: result, win, payout, newBalance: Math.floor(newBal * 100) / 100 });
  } catch (err) {
    console.error('Lucky Play Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/dice/play', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const bet = Math.floor(safeNumber(req.body.bet, 0));
    const pick = Math.floor(safeNumber(req.body.pick, 0));
    
    // Load rules from Rule Book
    const rules = await getGameRules('dice');
    if (rules?.disabled) return res.status(403).json({ error: 'This game is currently disabled by admin.' });
    
    const activeRules = rules || { min_bet: 10, max_bet: 5000, base_multiplier: 5, house_edge: 0.05 };
    
    if (bet < activeRules.min_bet) return res.status(400).json({ error: `Minimum bet is ₹${activeRules.min_bet}` });
    if (bet > activeRules.max_bet) return res.status(400).json({ error: `Maximum bet is ₹${activeRules.max_bet}` });
    if (pick < 1 || pick > 6) return res.status(400).json({ error: 'Pick a number between 1 and 6' });
    
    const bal = await getUserBalance(userId);
    if (bal < bet) return res.status(400).json({ error: 'Insufficient balance' });
    
    const roll = 1 + Math.floor(Math.random() * 6);
    const win = roll === pick;
    
    // Apply house edge factor from Rule Book
    const factor = 1 - (Number(activeRules.house_edge) || 0.05);
    const payout = win ? Math.floor(bet * Number(activeRules.base_multiplier) * factor) : 0;
    
    await db.transaction(async (client) => {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [bet, userId]);
      await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'game', $2, $3)`, [userId, -bet, 'Dice Royale bet']);
      if (payout > 0) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, userId]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)`, [userId, payout, 'Dice Royale win']);
      }
    });
    
    // Record game history
    await db.prepare(`
      INSERT INTO game_history (user_id, game_type, bet_amount, multiplier, payout, details)
      VALUES (?, 'dice', ?, ?, ?, ?)
    `).run(userId, bet, Number(activeRules.base_multiplier), payout, JSON.stringify({ roll }));

    const newBal = await getUserBalance(userId);
    res.json({ success: true, roll, win, payout, newBalance: Math.floor(newBal * 100) / 100 });
  } catch (err) {
    console.error('Dice Play Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const SLOT_SYMBOLS = ['💎', '🌟', '⚡', '⛏️', '🔨', '🏭'];
function spinReels() {
  return [0, 0, 0].map(() => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
}
function computeSlotPayout(bet, reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    switch (a) {
      case '💎': return bet * 30;
      case '🌟': return bet * 15;
      case '⚡': return bet * 10;
      case '⛏️': return bet * 8;
      case '🔨': return bet * 6;
      case '🏭': return bet * 4;
    }
  }
  if (a === b || b === c || a === c) return bet * 2;
  return 0;
}

router.post('/slots/spin', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const bet = Math.floor(safeNumber(req.body.bet, 0));
    
    // Load rules from Rule Book
    const rules = await getGameRules('slots');
    if (rules?.disabled) return res.status(403).json({ error: 'This game is currently disabled by admin.' });
    
    const activeRules = rules || { min_bet: 10, max_bet: 5000, base_multiplier: 30, house_edge: 0.05 };
    
    if (bet < activeRules.min_bet) return res.status(400).json({ error: `Minimum bet is ₹${activeRules.min_bet}` });
    if (bet > activeRules.max_bet) return res.status(400).json({ error: `Maximum bet is ₹${activeRules.max_bet}` });
    
    const bal = await getUserBalance(userId);
    if (bal < bet) return res.status(400).json({ error: 'Insufficient balance' });
    
    const reels = spinReels();
    let payout = computeSlotPayout(bet, reels);
    
    // Apply house edge factor from Rule Book
    const factor = 1 - (Number(activeRules.house_edge) || 0.05);
    payout = Math.floor(payout * factor);
    
    const win = payout > 0;
    await db.transaction(async (client) => {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [bet, userId]);
      await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'game', $2, $3)`, [userId, -bet, 'Crypto Slots spin']);
      if (payout > 0) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, userId]);
        await client.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)`, [userId, payout, 'Crypto Slots win']);
      }
    });
    
    // Record game history
    await db.prepare(`
      INSERT INTO game_history (user_id, game_type, bet_amount, multiplier, payout, details)
      VALUES (?, 'slots', ?, ?, ?, ?)
    `).run(userId, bet, payout / (bet || 1), payout, JSON.stringify({ reels }));

    const newBal = await getUserBalance(userId);
    res.json({ success: true, reels, win, payout, newBalance: Math.floor(newBal * 100) / 100 });
  } catch (err) {
    console.error('Slots Play Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/space-traveler/settings', async (req, res) => {
  try {
    const s = await db.prepare(`SELECT value FROM settings WHERE key = 'space_traveler_settings'`).get();
    if (!s) return res.json({ success: true, settings: null });
    res.json({ success: true, settings: JSON.parse(s.value) });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/space-traveler/bet', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const amount = parseFloat(req.body.amount);
    
    if (isNaN(amount) || amount < 10) return res.status(400).json({ error: 'Minimum bet is ₹10' });
    
    const bal = await getUserBalance(userId);
    
    if (bal < amount) return res.status(400).json({ error: 'Insufficient balance' });

    try {
      await db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, userId);
      await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'game', ?, ?)`).run(userId, -amount, 'Space Traveler bet');
    } catch (dbErr) {
      console.error('Database update failed:', dbErr.message);
      throw dbErr;
    }

    const newBal = await getUserBalance(userId);
    res.json({ success: true, newBalance: newBal });
  } catch (err) {
    console.error('Bet API Error:', err.message);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// GET /api/games/rules/:type - Get rule book for specific game
router.get('/rules/:type', async (req, res) => {
  try {
    const row = await db.prepare('SELECT rules, is_active FROM game_rules WHERE game_type = ?').get(req.params.type);
    if (!row) return res.json({ success: true, rules: {}, is_active: 1 });
    const rules = typeof row.rules === 'string' ? JSON.parse(row.rules) : row.rules;
    res.json({ success: true, rules, is_active: Number(row.is_active) });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/space-traveler/win', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const payout = parseFloat(req.body.payout);
    const betAmount = parseFloat(req.body.betAmount);
    const multiplier = parseFloat(req.body.multiplier);
    
    if (isNaN(payout)) return res.status(400).json({ error: 'Invalid payout' });

    try {
      if (payout > 0) {
        await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout, userId);
        await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)`).run(userId, payout, 'Space Traveler win');
      }
      
      // Record game history
      await db.prepare(`
        INSERT INTO game_history (user_id, game_type, bet_amount, multiplier, payout, details)
        VALUES (?, 'space_traveler', ?, ?, ?, ?)
      `).run(userId, betAmount || 0, multiplier || 0, payout || 0, JSON.stringify(req.body.details || {}));
      
    } catch (dbErr) {
      console.error('Win database update failed:', dbErr.message);
      throw dbErr;
    }

    const newBal = await getUserBalance(userId);
    res.json({ success: true, newBalance: newBal });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/games/history - Get all game history for a user
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const history = await db.prepare(`
      SELECT * FROM game_history 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 100
    `).all(userId);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/plinko/settings', async (req, res) => {
  try {
    const s = await db.prepare(`SELECT value FROM settings WHERE key = 'plinko_settings'`).get();
    if (!s) return res.json({ success: true, settings: null });
    res.json({ success: true, settings: JSON.parse(s.value) });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/plinko/bet', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const amount = Math.floor(safeNumber(req.body.amount, 0));
    
    // Load rules from Rule Book
    const rules = await getGameRules('plinko');
    if (rules?.disabled) return res.status(403).json({ error: 'This game is currently disabled by admin.' });
    
    const activeRules = rules || { min_bet: 10, max_bet: 10000 };
    
    if (amount < activeRules.min_bet) return res.status(400).json({ error: `Minimum bet is ₹${activeRules.min_bet}` });
    if (amount > activeRules.max_bet) return res.status(400).json({ error: `Maximum bet is ₹${activeRules.max_bet}` });
    const bal = await getUserBalance(userId);
    if (bal < amount) return res.status(400).json({ error: 'Insufficient balance' });

    await db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, userId);
    await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'game', ?, ?)`).run(userId, -amount, 'Plinko bet');

    const newBal = await getUserBalance(userId);
    res.json({ success: true, newBalance: newBal });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/plinko/win', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    let payout = parseFloat(req.body.payout);
    const betAmount = parseFloat(req.body.betAmount);
    let multiplier = parseFloat(req.body.multiplier);
    const details = req.body.details || {};
    
    if (isNaN(payout)) return res.status(400).json({ error: 'Invalid payout' });

    // --- SAFETY CHECK: CAP AT 8x ---
    if (multiplier > 8) {
      multiplier = 8;
      payout = betAmount * 8;
    }

    if (payout > 0) {
      await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout, userId);
      await db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)`).run(userId, payout, 'Plinko win');
    }
    
    // Record game history
    await db.prepare(`
      INSERT INTO game_history (user_id, game_type, bet_amount, multiplier, payout, details)
      VALUES (?, 'plinko', ?, ?, ?, ?)
    `).run(userId, betAmount || 0, multiplier || 0, payout || 0, JSON.stringify(details));

    const newBal = await getUserBalance(userId);
    res.json({ success: true, newBalance: newBal });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
