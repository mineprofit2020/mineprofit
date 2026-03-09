const express = require('express');
const { getDb } = require('../db');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

// POST /api/contact - Submit contact message
router.post('/', (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required' });
    }

    const userId = req.session?.userId || null;

    db.prepare(`
      INSERT INTO contact_messages (user_id, name, email, subject, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, name, email, subject || 'General Inquiry', message);

    res.json({ success: true, message: 'Your message has been sent! We will get back to you within 24 hours.' });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
