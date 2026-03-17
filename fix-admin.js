const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function fix() {
    const hash = bcrypt.hashSync('admin123', 10);
    try {
        await pool.query('UPDATE admins SET password_hash = $1 WHERE username = $2', [hash, 'admin']);
        console.log('✅ Admin password updated to "admin123"');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error updating password:', err.message);
        process.exit(1);
    }
}

fix();
