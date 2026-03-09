function requirePartner(req, res, next) {
  if (!req.session || !req.session.partnerId) {
    return res.status(401).json({ error: 'Partner login required' });
  }
  next();
}

function requirePartnerPermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.partnerId) {
      return res.status(401).json({ error: 'Partner login required' });
    }
    
    const { getDb } = require('../db');
    const db = getDb();
    const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.session.partnerId);
    
    if (!partner || !partner.active) {
      return res.status(403).json({ error: 'Partner account inactive' });
    }
    
    if (permission && !partner[permission]) {
      return res.status(403).json({ error: `Permission denied: ${permission}` });
    }
    
    req.partner = partner; // Attach partner object to request
    next();
  };
}

module.exports = { requirePartner, requirePartnerPermission };
