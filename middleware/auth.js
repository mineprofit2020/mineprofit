const { getDb } = require('../db');

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Please login first' });
  }
  try {
    const db = getDb();
    const user = await db.prepare('SELECT frozen FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.frozen) {
      return res.status(403).json({ error: 'Account is frozen. Contact support.' });
    }
  } catch {}
  next();
}

module.exports = { requireAuth };
