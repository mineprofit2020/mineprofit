const { getDb, initDatabase } = require('./db');
const bcrypt = require('bcryptjs');

(async () => {
    await initDatabase();
    const db = getDb();

    console.log('--- RECONFIGURING ADMIN HIERARCHY ---');

    try {
        // 1. Clear existing data related to site admins
        console.log('Clearing existing admins and business data...');
        db.prepare('DELETE FROM admin_business_access').run();
        db.prepare('DELETE FROM admins').run();
        db.prepare('DELETE FROM business_sites').run();

        // 2. Create Business Sites
        console.log('Creating Business Sites...');
        db.prepare('INSERT INTO business_sites (id, name) VALUES (?, ?)').run('btc-miner', 'BTC Miner');
        db.prepare('INSERT INTO business_sites (id, name) VALUES (?, ?)').run('eth-miner', 'ETH Miner');

        // 3. Create Master Admins
        console.log('Creating Master Admins...');
        // admin (password: admin123)
        const hash1 = bcrypt.hashSync('admin123', 10);
        db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash1);

        // 4. Assign Access (Super Admin rules: admin handles BTC)
        console.log('Assigning Master Admin Access...');
        
        // admin -> BTC Miner (Running)
        db.prepare('INSERT INTO admin_business_access (admin_username, business_id, is_running) VALUES (?, ?, ?)')
            .run('admin', 'btc-miner', 1);

        console.log('✅ Reconfiguration Complete!');
        console.log('Super Admin: free_guy (Master Portal)');
        console.log('Master Admin: admin -> BTC Miner');
        process.exit(0);
    } catch (err) {
        console.error('❌ Reconfiguration Failed:', err);
        process.exit(1);
    }
})();
