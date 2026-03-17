const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase.co') ? {
    rejectUnauthorized: false
  } : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false)
});

let _db = null;

// ---- Compatibility wrapper to mimic better-sqlite3 API (now async) ----

class PreparedStatement {
  constructor(pool, sql) {
    this._pool = pool;
    this._sql = this._convertSql(sql);
  }

  // Convert ? to $1, $2, etc.
  _convertSql(sql) {
    let count = 0;
    // Don't replace ?? which is used for identifiers in some cases, though pg uses ""
    // But here we just want to replace ? with $1, $2, etc.
    return sql.replace(/\?/g, (match, offset, fullString) => {
      // Check if it's part of ??
      if (fullString[offset + 1] === '?') return '?'; 
      if (fullString[offset - 1] === '?') return '?';
      return `$${++count}`;
    });
  }

  async run(...params) {
    // If last param is an array, use it as params (common for better-sqlite3)
    const finalParams = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
    
    // Postgres-specific: if it's an INSERT, add RETURNING id if not present
    let sql = this._sql;
    if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
      sql += ' RETURNING id';
    }

    try {
      const result = await this._pool.query(sql, finalParams);
      return {
        lastInsertRowid: result.rows[0]?.id || 0,
        changes: result.rowCount
      };
    } catch (e) {
      console.error('DB run error:', e.message, 'SQL:', sql);
      throw e;
    }
  }

  async get(...params) {
    const finalParams = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
    try {
      const result = await this._pool.query(this._sql, finalParams);
      return result.rows[0] || undefined;
    } catch (e) {
      console.error('DB get error:', e.message, 'SQL:', this._sql);
      throw e;
    }
  }

  async all(...params) {
    const finalParams = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
    try {
      const result = await this._pool.query(this._sql, finalParams);
      return result.rows;
    } catch (e) {
      console.error('DB all error:', e.message, 'SQL:', this._sql);
      throw e;
    }
  }
}

class DatabaseWrapper {
  constructor(pool) {
    this._pool = pool;
  }

  prepare(sql) {
    return new PreparedStatement(this._pool, sql);
  }

  async exec(sql) {
    try {
      await this._pool.query(sql);
    } catch (e) {
      console.error('DB exec error:', e.message, 'SQL:', sql);
      throw e;
    }
  }

  async transaction(fn) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

// ---- Initialization ----

async function initDatabase() {
  _db = new DatabaseWrapper(pool);

  // Helper to run query safely (Postgres doesn't support multiple statements in one query if they are complex)
  const run = async (sql) => {
    // Basic SQLite to Postgres translations
    let pgSql = sql
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
      .replace(/REAL/gi, 'DECIMAL')
      .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
      .replace(/datetime\('now','localtime'\)/gi, 'CURRENT_TIMESTAMP')
      .replace(/JSON NOT NULL/gi, 'JSONB NOT NULL')
      .replace(/INSERT OR IGNORE/gi, 'INSERT') // Need to handle ON CONFLICT separately
      .replace(/CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users\(LOWER\(username\)\)/gi, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users(LOWER(username))');
    
    try {
      await _db.exec(pgSql);
    } catch (e) {
      // Ignore "already exists" errors during initialization
      if (!e.message.includes('already exists') && !e.message.includes('already a column')) {
        console.error('Init SQL Error:', e.message, 'SQL:', pgSql);
      }
    }
  };

  // Create tables (Postgres syntax)
  await run(`
    CREATE TABLE IF NOT EXISTS business_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Initial check for business_sites
  const sitesCount = await _db.prepare('SELECT COUNT(*) as count FROM business_sites').get();
  if (Number(sitesCount.count) === 0) {
    await _db.exec("INSERT INTO business_sites (id, name) VALUES ('main', 'Main Site')");
  }

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plain_password TEXT,
      balance DECIMAL DEFAULT 0,
      free_spins INTEGER DEFAULT 1,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by_user_id INTEGER,
      business_id TEXT DEFAULT 'main' REFERENCES business_sites(id),
      withdraw_blocked INTEGER DEFAULT 0,
      withdraw_limit DECIMAL,
      withdraw_limit_until TEXT,
      frozen INTEGER DEFAULT 0,
      last_collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (referred_by_user_id) REFERENCES users(id)
    )
  `);

  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users(LOWER(username))`);

  await run(`
    CREATE TABLE IF NOT EXISTS machines (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price DECIMAL NOT NULL,
      earning_per_hour DECIMAL NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '⛏️'
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_machines (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      amount DECIMAL NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS game_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      game_type TEXT NOT NULL,
      bet_amount DECIMAL NOT NULL,
      multiplier DECIMAL NOT NULL,
      payout DECIMAL NOT NULL,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS game_rules (
      id SERIAL PRIMARY KEY,
      game_type TEXT UNIQUE NOT NULL,
      rules JSONB NOT NULL,
      is_active INTEGER DEFAULT 1,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      full_name TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      bank_account_name TEXT,
      bank_account_number TEXT,
      bank_ifsc TEXT,
      bank_name TEXT,
      upi_id TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount DECIMAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      admin_note TEXT,
      business_id TEXT DEFAULT 'main' REFERENCES business_sites(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS spin_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      prize_type TEXT NOT NULL,
      prize_value TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount DECIMAL NOT NULL,
      method TEXT NOT NULL,
      transaction_ref TEXT,
      status TEXT DEFAULT 'pending',
      business_id TEXT DEFAULT 'main' REFERENCES business_sites(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'unread',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS admin_business_access (
      id SERIAL PRIMARY KEY,
      admin_username TEXT NOT NULL,
      business_id TEXT NOT NULL REFERENCES business_sites(id),
      is_running INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payment_gateways (
      id SERIAL PRIMARY KEY,
      method TEXT NOT NULL,
      label TEXT NOT NULL,
      upi_id TEXT,
      upi_name TEXT,
      qr_url TEXT,
      bank_account_name TEXT,
      bank_account_number TEXT,
      bank_ifsc TEXT,
      bank_name TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS crypto_tokens (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT,
      network TEXT,
      address TEXT,
      qr_url TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'promo',
      audience TEXT DEFAULT 'all',
      expires_at TIMESTAMP,
      require_ack INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notification_targets (
      notification_id INTEGER NOT NULL REFERENCES notifications(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (notification_id, user_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notification_acks (
      notification_id INTEGER NOT NULL REFERENCES notifications(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, user_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      can_deposits INTEGER DEFAULT 0,
      can_withdrawals INTEGER DEFAULT 0,
      can_messages INTEGER DEFAULT 0,
      can_users INTEGER DEFAULT 0,
      can_profiles INTEGER DEFAULT 0,
      can_dashboard INTEGER DEFAULT 0,
      can_settings INTEGER DEFAULT 0,
      can_machines INTEGER DEFAULT 0,
      can_spin INTEGER DEFAULT 0,
      can_gateways INTEGER DEFAULT 0,
      can_history INTEGER DEFAULT 0,
      can_reports INTEGER DEFAULT 0,
      can_security INTEGER DEFAULT 0,
      can_controls INTEGER DEFAULT 0,
      can_passwords INTEGER DEFAULT 0,
      deposit_limit DECIMAL,
      withdraw_limit DECIMAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_boosters (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      value DECIMAL NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS support_threads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      partner_id INTEGER REFERENCES partners(id),
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES support_threads(id),
      sender_type TEXT NOT NULL,
      sender_id INTEGER NOT NULL,
      message_text TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS spin_prizes (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      amount DECIMAL,
      machine_id INTEGER REFERENCES machines(id),
      weight DECIMAL NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `);

  console.log('✅ Database initialized');
  return _db;
}

function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}

module.exports = { initDatabase, getDb };
