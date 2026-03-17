const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

const router = express.Router();

router.get('/pending', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const rows = await db.prepare(`
      SELECT n.*
      FROM notifications n
      LEFT JOIN notification_targets nt ON nt.notification_id = n.id AND nt.user_id = ?
      LEFT JOIN notification_acks na ON na.notification_id = n.id AND na.user_id = ?
      WHERE (n.audience = 'all' OR nt.user_id IS NOT NULL)
        AND (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)
        AND n.require_ack = 1
        AND na.user_id IS NULL
      ORDER BY n.created_at DESC
      LIMIT 5
    `).all(userId, userId);
    res.json({ pending: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/ack', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { notification_id } = req.body;
    if (!notification_id) return res.status(400).json({ error: 'notification_id required' });
    await db.prepare(`INSERT INTO notification_acks (notification_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`).run(notification_id, userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
