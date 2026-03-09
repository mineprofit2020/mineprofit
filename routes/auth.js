const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../db');

// Lazy proxy: delegates to initialized DB instance
const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// Generate unique referral code
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { username, email, password, referralCode } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    let referrerId = null;
    if (referralCode && String(referralCode).trim()) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(String(referralCode).trim().toUpperCase());
      if (!referrer) {
        return res.status(400).json({ error: 'Invalid invite code. Please enter a valid referral code from an existing user.' });
      }
      referrerId = referrer.id;
    }

    const uname = String(username).trim();
    const unameLC = uname.toLowerCase();
    // Check if user exists (case-insensitive username)
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR LOWER(username) = ?').get(email, unameLC);
    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const myReferralCode = generateReferralCode();

    // Insert user
    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, plain_password, referral_code, referred_by_user_id, free_spins)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(uname, email, passwordHash, password, myReferralCode, referrerId);

    const userId = result.lastInsertRowid;

    // Give free Mini Miner (machine id = 1)
    db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 1)').run(userId);

    // Log transaction
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, description)
      VALUES (?, 'bonus', 0, 'Received free Mini Miner on signup')
    `).run(userId);

    // Set session
    req.session.userId = userId;
    req.session.username = username;

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session error' });
      }
      res.json({ success: true, message: 'Account created! You received a free Mini Miner!' });
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { identifier, email, password } = req.body;
    const loginId = (identifier || email || '').trim();

    if (!loginId || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    // Allow login by username (case-insensitive) OR email (case-insensitive)
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').get(loginId.toLowerCase(), loginId.toLowerCase());
    if (!user) {
      return res.status(400).json({ error: 'Invalid username/email or password' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    req.session.save((err) => {
      if (err) {
        console.error('Login session save error:', err);
        return res.status(500).json({ error: 'Session error' });
      }
      res.json({ success: true, message: 'Login successful' });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || req.session.userId === undefined || req.session.userId === null) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const user = db.prepare('SELECT id, username, email, balance, referral_code, created_at FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user });
});

// POST /api/auth/password/change
router.post('/password/change', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'All fields required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 chars' });

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    if (!bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
    
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('User password change error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
