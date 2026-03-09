const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePartner } = require('../middleware/partner');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });
const router = express.Router();

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir); } catch {}

// Get or create a support thread for current user
router.post('/thread', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    let thread = db.prepare(`SELECT * FROM support_threads WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`).get(userId);
    if (!thread) {
      const r = db.prepare(`INSERT INTO support_threads (user_id) VALUES (?)`).run(userId);
      thread = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(r.lastInsertRowid);
    }
    res.json({ success: true, thread });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// User send message
router.post('/send', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { thread_id, message_text, image_url } = req.body;
    const thread = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(thread_id);
    if (!thread || thread.user_id !== userId) return res.status(403).json({ error: 'Invalid thread' });
    db.prepare(`
      INSERT INTO support_messages (thread_id, sender_type, sender_id, message_text, image_url)
      VALUES (?, 'user', ?, ?, ?)
    `).run(thread_id, userId, message_text || '', image_url || null);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload image (base64 JSON)
router.post('/upload', (req, res) => {
  try {
    if (!req.session?.userId && !req.session?.partnerId) return res.status(401).json({ error: 'Login required' });
    const { filename, data } = req.body || {};
    if (!filename || !data || !data.startsWith('data:')) return res.status(400).json({ error: 'Invalid payload' });
    const base64 = data.split(',')[1];
    const safeName = Date.now() + '_' + filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = path.join(uploadsDir, safeName);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    res.json({ success: true, url: '/uploads/' + safeName });
  } catch {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// List messages (user or partner)
router.get('/messages', (req, res) => {
  try {
    const { thread_id, after_id } = req.query;
    if (!thread_id) return res.status(400).json({ error: 'thread_id required' });
    const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(thread_id);
    if (!t) return res.status(404).json({ error: 'Thread not found' });

    const userId = req.session?.userId;
    const partnerId = req.session?.partnerId;
    if (!userId && !partnerId) return res.status(401).json({ error: 'Login required' });
    if (userId && t.user_id !== userId) return res.status(403).json({ error: 'Not allowed' });
    if (partnerId && t.partner_id && t.partner_id !== partnerId) return res.status(403).json({ error: 'Not allowed' });

    const rows = db.prepare(`
      SELECT * FROM support_messages
      WHERE thread_id = ? AND (? IS NULL OR id > ?)
      ORDER BY id ASC LIMIT 200
    `).all(thread_id, after_id || null, after_id || null);
    res.json({ messages: rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Partner endpoints
router.get('/threads', requirePartner, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT st.*, u.username, u.email
      FROM support_threads st JOIN users u ON st.user_id = u.id
      WHERE st.status = 'open'
      ORDER BY st.created_at DESC
      LIMIT 100
    `).all();
    res.json({ threads: rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/claim', requirePartner, (req, res) => {
  try {
    const { thread_id } = req.body;
    const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(thread_id);
    if (!t) return res.status(404).json({ error: 'Thread not found' });
    if (t.partner_id && t.partner_id !== req.session.partnerId) return res.status(403).json({ error: 'Already claimed' });
    db.prepare(`UPDATE support_threads SET partner_id = ? WHERE id = ?`).run(req.session.partnerId, thread_id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/partner/send', requirePartner, (req, res) => {
  try {
    const { thread_id, message_text, image_url } = req.body || {};
    const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(thread_id);
    if (!t) return res.status(404).json({ error: 'Thread not found' });
    if (t.partner_id && t.partner_id !== req.session.partnerId) return res.status(403).json({ error: 'Not allowed' });
    if (!t.partner_id) db.prepare(`UPDATE support_threads SET partner_id = ? WHERE id = ?`).run(req.session.partnerId, thread_id);
    db.prepare(`
      INSERT INTO support_messages (thread_id, sender_type, sender_id, message_text, image_url)
      VALUES (?, 'partner', ?, ?, ?)
    `).run(thread_id, req.session.partnerId, message_text || '', image_url || null);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
