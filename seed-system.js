const { getDb, initDatabase } = require('./db');
const bcrypt = require('bcryptjs');

(async () => {
    await initDatabase();
    const db = getDb();

    console.log('--- SEEDING SYSTEM ---');

    try {
        // 1. Create Business Sites
        console.log('Creating Business Sites...');
        await db.prepare('INSERT INTO business_sites (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run('btc-miner', 'BTC Miner');
        await db.prepare('INSERT INTO business_sites (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run('eth-miner', 'ETH Miner');

        // 2. Create Admins
        console.log('Creating Admins...');
        // admin (password: admin123)
        const hash1 = bcrypt.hashSync('admin123', 10);
        await db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?) ON CONFLICT (username) DO NOTHING').run('admin', hash1);

        // 3. Assign Access
        console.log('Assigning Access...');
        
        // admin -> BTC Miner
        const access1 = await db.prepare('SELECT id FROM admin_business_access WHERE admin_username = ? AND business_id = ?')
            .get('admin', 'btc-miner');
        if (!access1) {
            await db.prepare('INSERT INTO admin_business_access (admin_username, business_id, is_running) VALUES (?, ?, ?)')
                .run('admin', 'btc-miner', 1);
        }

        console.log('✅ Seeding Complete!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Seeding Failed:', err);
        process.exit(1);
    }
})();
