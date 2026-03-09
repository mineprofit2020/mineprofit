const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// GET /api/profile - Get user profile + bank details
router.get('/', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, username, email, balance, created_at FROM users WHERE id = ?').get(userId);
    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);

    res.json({ user, profile: profile || null });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/profile/update - Update personal info + bank details
router.post('/update', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { full_name, phone, address, city, state, pincode, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id } = req.body;

    const existing = db.prepare('SELECT id FROM user_profiles WHERE user_id = ?').get(userId);

    if (existing) {
      db.prepare(`
        UPDATE user_profiles SET
          full_name = ?, phone = ?, address = ?, city = ?, state = ?, pincode = ?,
          bank_account_name = ?, bank_account_number = ?, bank_ifsc = ?, bank_name = ?, upi_id = ?,
          updated_at = datetime('now')
        WHERE user_id = ?
      `).run(full_name, phone, address, city, state, pincode, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id, userId);
    } else {
      db.prepare(`
        INSERT INTO user_profiles (user_id, full_name, phone, address, city, state, pincode, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, full_name, phone, address, city, state, pincode, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id);
    }

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/profile/withdraw - Request withdrawal
router.post('/withdraw', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { amount, method } = req.body;
    const reqAmount = parseFloat(amount);

    if (!reqAmount || isNaN(reqAmount) || reqAmount < 100) {
      return res.status(400).json({ error: 'Minimum withdrawal is ₹100' });
    }

    if (!method || !['bank', 'upi'].includes(method)) {
      return res.status(400).json({ error: 'Invalid withdrawal method' });
    }

    const user = db.prepare('SELECT balance, withdraw_blocked, withdraw_limit, withdraw_limit_until FROM users WHERE id = ?').get(userId);
    if (user.withdraw_blocked) {
      return res.status(403).json({ error: 'Withdrawals are temporarily disabled for your account. Please contact support.' });
    }
    if (user.withdraw_limit && user.withdraw_limit_until) {
      const until = new Date(user.withdraw_limit_until + 'Z');
      const now = new Date();
      if (now < until && reqAmount > user.withdraw_limit) {
        return res.status(400).json({ error: `You can withdraw up to ₹${user.withdraw_limit} until ${until.toLocaleDateString('en-IN')}` });
      }
    }
    if (user.balance < reqAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Global per-transaction caps by method
    const caps = db.prepare(`SELECT key, value FROM settings WHERE key IN ('withdraw_cap_upi','withdraw_cap_bank','withdraw_daily_cap','withdraw_frequency_limit','withdraw_frequency_hours')`).all();
    const capMap = {};
    caps.forEach(r => { capMap[r.key] = r.value; });
    const asNum = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };
    const asInt = (v) => {
      const n = parseInt(v, 10);
      return isNaN(n) ? 0 : n;
    };

    const upiCap = asNum(capMap['withdraw_cap_upi']);
    const bankCap = asNum(capMap['withdraw_cap_bank']);
    const dailyCap = asNum(capMap['withdraw_daily_cap']);

    if (method === 'upi' && upiCap > 0 && reqAmount > upiCap) {
      return res.status(400).json({ error: `Max per UPI withdrawal is ₹${upiCap}` });
    }
    if (method === 'bank' && bankCap > 0 && reqAmount > bankCap) {
      return res.status(400).json({ error: `Max per bank withdrawal is ₹${bankCap}` });
    }
    
    // Frequency Limit Check
    const freqLimit = asInt(capMap['withdraw_frequency_limit']);
    const freqHours = Math.max(1, asInt(capMap['withdraw_frequency_hours']) || 24);
    
    if (freqLimit > 0) {
      const recent = db.prepare(`
        SELECT COUNT(*) as count 
        FROM withdrawals 
        WHERE user_id = ? AND created_at > datetime('now', '-' || ? || ' hours')
      `).get(userId, freqHours);
      
      if (recent.count >= freqLimit) {
        return res.status(400).json({ error: `Withdrawal limit reached. Max ${freqLimit} withdrawals every ${freqHours} hours.` });
      }
    }

    // Optional daily cap: pending + approved today
    if (dailyCap > 0) {
      const todaySum = db.prepare(`
        SELECT COALESCE(SUM(amount),0) as total
        FROM withdrawals WHERE user_id = ? AND date(created_at) = date('now') AND status IN ('pending','approved')
      `).get(userId).total;
      if ((todaySum + reqAmount) > dailyCap) {
        return res.status(400).json({ error: `Daily withdrawal cap ₹${dailyCap} exceeded (${todaySum} used today)` });
      }
    }


    // Require complete profile info
    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
    if (!profile) {
      return res.status(400).json({ error: 'Please complete your profile before withdrawing' });
    }
    const requiredBasic = ['full_name','phone','address','city','state','pincode'];
    for (const k of requiredBasic) {
      if (!profile[k] || String(profile[k]).trim() === '') {
        return res.status(400).json({ error: 'Please complete your profile before withdrawing' });
      }
    }
    if (method === 'bank') {
      const requiredBank = ['bank_account_name','bank_account_number','bank_ifsc','bank_name'];
      for (const k of requiredBank) {
        if (!profile[k] || String(profile[k]).trim() === '') {
          return res.status(400).json({ error: 'Please add full bank details in Profile to withdraw via bank' });
        }
      }
    } else if (method === 'upi') {
      if (!profile.upi_id || String(profile.upi_id).trim() === '') {
        return res.status(400).json({ error: 'Please add your UPI ID in Profile to withdraw via UPI' });
      }
    }

    const withdrawTx = db.transaction(() => {
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(reqAmount, userId);

      db.prepare('INSERT INTO withdrawals (user_id, amount, method) VALUES (?, ?, ?)').run(userId, reqAmount, method);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, description)
        VALUES (?, 'withdrawal', ?, ?)
      `).run(userId, -reqAmount, `Withdrawal via ${method.toUpperCase()} - ₹${reqAmount}`);
    });

    withdrawTx();

    res.json({ success: true, message: `Withdrawal of ₹${reqAmount} requested. Will be processed within 30 minutes.` });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/profile/withdrawals - Get withdrawal history
router.get('/withdrawals', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
    res.json({ withdrawals });
  } catch (err) {
    console.error('Withdrawals fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
