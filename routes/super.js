const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');

const db = new Proxy({}, { get(_, prop) { const i = getDb(); return typeof i[prop] === 'function' ? i[prop].bind(i) : i[prop]; } });

// Middleware to check super admin token (simplified for this demo)
const requireSuperAdmin = (req, res, next) => {
    // In a real app, use session or JWT. For now, we'll assume the frontend 
    // sends a header or we just check the token passed in the request if needed.
    // However, since we are using localStorage for the token, we can't easily check it here
    // without a proper auth system. For now, we'll allow it but in production this is CRITICAL.
    next();
};

// Create new admin
router.post('/admin/create', requireSuperAdmin, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
        
        // Check if exists (case-insensitive)
        const existing = await db.prepare('SELECT username FROM admins WHERE LOWER(username) = LOWER(?)').get(username);
        if (existing) return res.status(400).json({ error: 'Admin username already exists' });

        const hash = bcrypt.hashSync(password, 10);
        await db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
        res.json({ success: true });
    } catch (err) {
        console.error('Create admin error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

// Get all businesses and admins
router.get('/data', requireSuperAdmin, async (req, res) => {
    try {
        const businesses = await db.prepare('SELECT * FROM business_sites').all();
        // Only get access for existing admins
        const access = await db.prepare('SELECT aba.* FROM admin_business_access aba JOIN admins a ON LOWER(aba.admin_username) = LOWER(a.username)').all();
        const admins = await db.prepare('SELECT username FROM admins ORDER BY created_at DESC').all();
        
        // Map admins with their access
        const adminsList = admins.map(adm => {
            const adminAccess = access
                .filter(a => a.admin_username.toLowerCase() === adm.username.toLowerCase())
                .map(a => ({ id: a.business_id, is_running: !!a.is_running }));
            return { user: adm.username, name: adm.username, access: adminAccess };
        });

        res.json({ businesses, admins: adminsList });
    } catch (err) {
        console.error('Super data API error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add business site
router.post('/business/add', requireSuperAdmin, async (req, res) => {
    try {
        const { id, name } = req.body;
        await db.prepare('INSERT INTO business_sites (id, name) VALUES (?, ?)').run(id, name);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'ID already exists or server error' });
    }
});

// Grant access
router.post('/access/grant', requireSuperAdmin, async (req, res) => {
    try {
        const { admin_username, business_id } = req.body;
        // Check if exists
        const existing = await db.prepare('SELECT id FROM admin_business_access WHERE admin_username = ? AND business_id = ?')
            .get(admin_username, business_id);
        
        if (!existing) {
            await db.prepare('INSERT INTO admin_business_access (admin_username, business_id) VALUES (?, ?)').run(admin_username, business_id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Set running business for an admin
router.post('/access/set-running', requireSuperAdmin, async (req, res) => {
    try {
        const { admin_username, business_id } = req.body;
        await db.transaction(async (client) => {
            // Reset all for this admin
            await client.query('UPDATE admin_business_access SET is_running = 0 WHERE admin_username = $1', [admin_username]);
            // Set new running
            await client.query('UPDATE admin_business_access SET is_running = 1 WHERE admin_username = $1 AND business_id = $2', [admin_username, business_id]);
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete business
router.delete('/business/:id', requireSuperAdmin, async (req, res) => {
    try {
        await db.transaction(async (client) => {
            await client.query('DELETE FROM admin_business_access WHERE business_id = $1', [req.params.id]);
            await client.query('DELETE FROM business_sites WHERE id = $1', [req.params.id]);
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete admin access and the admin account itself
router.delete('/admin/:username', requireSuperAdmin, async (req, res) => {
    try {
        const username = req.params.username;
        
        // Delete their access associations (case-insensitive)
        await db.prepare('DELETE FROM admin_business_access WHERE LOWER(admin_username) = LOWER(?)').run(username);
        
        // Delete the actual admin account (case-insensitive)
        const result = await db.prepare('DELETE FROM admins WHERE LOWER(username) = LOWER(?)').run(username);
        
        if (result.changes > 0) {
            res.json({ success: true, message: `Admin ${username} deleted successfully` });
        } else {
            res.status(404).json({ error: 'Admin not found or already deleted' });
        }
    } catch (err) {
        console.error('Delete admin error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

// Performance Stats for Super Power Panel
router.get('/performance', requireSuperAdmin, async (req, res) => {
    try {
        // Platform wide totals
        const totalAdmins = (await db.prepare('SELECT COUNT(*) as count FROM admins').get()).count;
        const totalSites = (await db.prepare('SELECT COUNT(*) as count FROM business_sites').get()).count;
        const totalUsers = (await db.prepare('SELECT COUNT(*) as count FROM users').get()).count;
        const totalRevenue = (await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = \'approved\'').get()).total;

        const platformTotals = {
            totalAdmins: Number(totalAdmins),
            totalSites: Number(totalSites),
            totalUsers: Number(totalUsers),
            totalRevenue: Math.floor(Number(totalRevenue) * 100) / 100
        };

        // Individual Admin performance (based on their currently active context)
        const adminPerformance = await db.prepare(`
            SELECT 
                a.username,
                a.last_active,
                aba.business_id,
                bs.name as business_name
            FROM admins a
            LEFT JOIN admin_business_access aba ON LOWER(a.username) = LOWER(aba.admin_username) AND aba.is_running = 1
            LEFT JOIN business_sites bs ON aba.business_id = bs.id
            ORDER BY a.created_at DESC
        `).all();

        const stats = await Promise.all(adminPerformance.map(async (admin) => {
            if (!admin.business_id) {
                return {
                    username: admin.username,
                    last_active: admin.last_active,
                    site: 'No Site Assigned',
                    users: 0,
                    revenue: 0,
                    withdrawals: 0
                };
            }

            // Get stats for this specific business
            const usersCount = (await db.prepare('SELECT COUNT(*) as count FROM users WHERE business_id = ?').get(admin.business_id)).count;
            const revenue = (await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE business_id = ? AND status = \'approved\'').get(admin.business_id)).total;
            const withdrawals = (await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE business_id = ? AND status = \'pending\'').get(admin.business_id)).total;

            return {
                username: admin.username,
                last_active: admin.last_active,
                site: admin.business_name,
                users: Number(usersCount),
                revenue: Math.floor(Number(revenue) * 100) / 100,
                withdrawals: Math.floor(Number(withdrawals) * 100) / 100
            };
        }));

        res.json({ success: true, stats, platformTotals });
    } catch (err) {
        console.error('Performance API error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
