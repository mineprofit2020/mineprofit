const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// GET /api/profile - Get user profile + bank details
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await db.prepare('SELECT id, username, email, balance, created_at FROM users WHERE id = ?').get(userId);
    const profile = await db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);

    res.json({ user, profile: profile || null });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/profile/update - Update personal info + bank details
router.post('/update', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { full_name, phone, address, city, state, pincode, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id } = req.body;

    const existing = await db.prepare('SELECT id FROM user_profiles WHERE user_id = ?').get(userId);

    if (existing) {
      await db.prepare(`
        UPDATE user_profiles SET
          full_name = ?, phone = ?, address = ?, city = ?, state = ?, pincode = ?,
          bank_account_name = ?, bank_account_number = ?, bank_ifsc = ?, bank_name = ?, upi_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(full_name, phone, address, city, state, pincode, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id, userId);
    } else {
      await db.prepare(`
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
router.post('/withdraw', requireAuth, async (req, res) => {
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

    const user = await db.prepare('SELECT balance, withdraw_blocked, withdraw_limit, withdraw_limit_until FROM users WHERE id = ?').get(userId);
    if (user.withdraw_blocked) {
      return res.status(403).json({ error: 'Withdrawals are temporarily disabled for your account. Please contact support.' });
    }
    if (user.withdraw_limit && user.withdraw_limit_until) {
      const until = new Date(user.withdraw_limit_until);
      const now = new Date();
      if (now < until && reqAmount > Number(user.withdraw_limit)) {
        return res.status(400).json({ error: `You can withdraw up to ₹${user.withdraw_limit} until ${until.toLocaleDateString('en-IN')}` });
      }
    }
    if (Number(user.balance) < reqAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Global per-transaction caps by method
    const caps = await db.prepare(`SELECT key, value FROM settings WHERE key IN ('withdraw_cap_upi','withdraw_cap_bank','withdraw_daily_cap','withdraw_frequency_limit','withdraw_frequency_hours')`).all();
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
      // Postgres syntax for interval
      const recent = await db.prepare(`
        SELECT COUNT(*) as count 
        FROM withdrawals 
        WHERE user_id = ? AND created_at > (CURRENT_TIMESTAMP - ($2 * INTERVAL '1 hour'))
      `).get(userId, freqHours);
      
      if (Number(recent.count) >= freqLimit) {
        return res.status(400).json({ error: `Withdrawal limit reached. Max ${freqLimit} withdrawals every ${freqHours} hours.` });
      }
    }

    // Optional daily cap: pending + approved today
    if (dailyCap > 0) {
      const todayRes = await db.prepare(`
        SELECT COALESCE(SUM(amount),0) as total
        FROM withdrawals WHERE user_id = ? AND DATE(created_at) = CURRENT_DATE AND status IN ('pending','approved')
      `).get(userId);
      const todaySum = Number(todayRes.total);
      if ((todaySum + reqAmount) > dailyCap) {
        return res.status(400).json({ error: `Daily withdrawal cap ₹${dailyCap} exceeded (${todaySum} used today)` });
      }
    }


    // Require complete profile info
    const profile = await db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
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

    await db.transaction(async (client) => {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [reqAmount, userId]);

      await client.query('INSERT INTO withdrawals (user_id, amount, method) VALUES ($1, $2, $3)', [userId, reqAmount, method]);

      await client.query(`
        INSERT INTO transactions (user_id, type, amount, description)
        VALUES ($1, 'withdrawal', $2, $3)
      `, [userId, -reqAmount, `Withdrawal via ${method.toUpperCase()} - ₹${reqAmount}`]);
    });

    res.json({ success: true, message: `Withdrawal of ₹${reqAmount} requested. Will be processed within 30 minutes.` });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/profile/withdrawals - Get withdrawal history
router.get('/withdrawals', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const withdrawals = await db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
    res.json({ withdrawals });
  } catch (err) {
    console.error('Withdrawals fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
