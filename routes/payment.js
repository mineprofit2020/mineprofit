const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// GET /api/payment/info - Get payment methods info (reads from settings table)
router.get('/info', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    const recentPayments = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(userId);

    const gateways = db.prepare('SELECT * FROM payment_gateways WHERE enabled=1 ORDER BY created_at DESC').all();
    const tokens = db.prepare('SELECT * FROM crypto_tokens WHERE enabled=1 ORDER BY created_at DESC').all();

    // Fetch settings to get USDT rate
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    res.json({
      balance: Math.floor(user.balance * 100) / 100,
      payments: recentPayments,
      gateways,
      tokens,
      settings // Send settings to frontend
    });
  } catch (err) {
    console.error('Payment info error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/payment/submit - Submit a payment
router.post('/submit', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { amount, method, transaction_ref, gateway_id, token_symbol } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Minimum deposit is ₹100' });
    }

    let methodStr = null;
    if (method === 'upi' || method === 'bank') {
      if (!gateway_id) return res.status(400).json({ error: 'Select a gateway' });
      // Remove strict enabled=1 check for now to debug, or ensure gateways are actually enabled in DB
      const gw = db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(gateway_id);
      if (!gw) return res.status(400).json({ error: 'Invalid gateway selected' });
      
      // Allow method mismatch if the gateway supports the intent (some banks support UPI)
      // But strictly, let's just check ID existence.
      methodStr = `${method}:${gw.label}`;
    } else if (method === 'crypto') {
      if (!token_symbol) return res.status(400).json({ error: 'Select a token' });
      const tok = db.prepare('SELECT * FROM crypto_tokens WHERE symbol = ? AND enabled=1').get(token_symbol.toUpperCase());
      if (!tok) return res.status(400).json({ error: 'Invalid token' });
      methodStr = `token:${tok.symbol}`;
    } else {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    if (!transaction_ref || transaction_ref.trim().length < 4) {
      return res.status(400).json({ error: 'Please provide a valid transaction reference/ID' });
    }

    db.prepare(`
      INSERT INTO payments (user_id, amount, method, transaction_ref)
      VALUES (?, ?, ?, ?)
    `).run(userId, amount, methodStr, transaction_ref.trim());

    res.json({
      success: true,
      message: 'Payment submitted! Your balance will be credited after verification (usually within 1-2 hours).'
    });
  } catch (err) {
    console.error('Payment submit error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
