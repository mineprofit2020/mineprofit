const { getDb, initDatabase } = require('./db');
const bcrypt = require('bcryptjs');

async function testSystem() {
    await initDatabase();
    console.log('--- STARTING SYSTEM VERIFICATION ---');
    const db = getDb();

    try {
        // 1. Verify Businesses
        const businesses = db.prepare('SELECT * FROM business_sites').all();
        console.log(`Checking Businesses: ${businesses.length} found`);
        businesses.forEach(b => console.log(` - [${b.id}] ${b.name}`));

        // 2. Verify Admins
        const admins = db.prepare('SELECT username FROM admins').all();
        console.log(`Checking Admins: ${admins.length} found`);
        admins.forEach(a => console.log(` - @${a.username}`));

        // 3. Verify Access Mapping
        const access = db.prepare(`
            SELECT a.admin_username, b.name as site_name, a.is_running 
            FROM admin_business_access a
            JOIN business_sites b ON a.business_id = b.id
        `).all();
        console.log(`Checking Access Mapping: ${access.length} links found`);
        access.forEach(acc => {
            console.log(` - Admin: ${acc.admin_username} -> Site: ${acc.site_name} (Running: ${!!acc.is_running})`);
        });

        // 4. Test Logic - Find admin1's running site
        const admin1Running = db.prepare(`
            SELECT b.name FROM business_sites b
            JOIN admin_business_access a ON b.id = a.business_id
            WHERE a.admin_username = 'admin1' AND a.is_running = 1
        `).get();
        
        if (admin1Running && admin1Running.name === 'ETH Miner') {
            console.log('✅ LOGIC VERIFIED: admin1 correctly assigned to ETH Miner');
        } else {
            console.error('❌ LOGIC ERROR: admin1 mapping incorrect');
        }

        console.log('--- VERIFICATION COMPLETE ---');
    } catch (err) {
        console.error('❌ VERIFICATION FAILED:', err);
    }
}

testSystem();
