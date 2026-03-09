const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'mining.db');

let _db = null;

// ---- Compatibility wrapper to mimic better-sqlite3 API ----

class PreparedStatement {
  constructor(sqlDb, sql, saveFn, inTransactionFn) {
    this._db = sqlDb;
    this._sql = sql;
    this._save = saveFn;
    this._inTx = inTransactionFn || (() => false);
  }

  run(...params) {
    const prevModified = this._db.getRowsModified();
    this._db.run(this._sql, params);
    const nowModified = this._db.getRowsModified();
    const changes = nowModified - prevModified;
    
    let lastInsertRowid = 0;
    try {
      const lastId = this._db.exec('SELECT last_insert_rowid() as id');
      lastInsertRowid = lastId[0]?.values[0]?.[0] || 0;
    } catch (e) {
      console.error('last_insert_rowid error:', e.message);
    }
    this._save();
    return {
      lastInsertRowid,
      changes: changes
    };
  }

  get(...params) {
    let result = null;
    try {
      const stmt = this._db.prepare(this._sql);
      if (params.length > 0) stmt.bind(params);
      if (stmt.step()) {
        result = stmt.getAsObject();
      }
      stmt.free();
    } catch (e) {
      console.error('DB get error:', e.message);
    }
    return result || undefined;
  }

  all(...params) {
    const results = [];
    try {
      const stmt = this._db.prepare(this._sql);
      if (params.length > 0) stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
    } catch (e) {
      console.error('DB all error:', e.message);
    }
    return results;
  }
}

class DatabaseWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._inTransaction = false;
  }

  prepare(sql) {
    return new PreparedStatement(this._db, sql, () => this.save(), () => this._inTransaction);
  }

  exec(sql) {
    this._db.run(sql);
    this.save();
  }

  pragma() { /* no-op for sql.js */ }

  transaction(fn) {
    return (...args) => {
      this._inTransaction = true;
      this._db.run('BEGIN');
      let originalError = null;
      try {
        const result = fn(...args);
        this._db.run('COMMIT');
        this._inTransaction = false;
        this.save();
        return result;
      } catch (e) {
        originalError = e;
        try {
          this._db.run('ROLLBACK');
        } catch (rollbackErr) {
          console.error('Rollback error (original error was):', e.message);
        }
        this._inTransaction = false;
        throw originalError;
      }
    };
  }

  save() {
    if (this._inTransaction) return; // never save mid-transaction
    try {
      const data = this._db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }
}

// ---- Initialization ----

async function initDatabase() {
  const SQL = await initSqlJs();

  let sqlDb;
  try {
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      sqlDb = new SQL.Database(buffer);
    } else {
      sqlDb = new SQL.Database();
    }
  } catch {
    sqlDb = new SQL.Database();
  }

  _db = new DatabaseWrapper(sqlDb);

  // Create tables (one at a time for sql.js)
  _db._db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plain_password TEXT,
      balance REAL DEFAULT 0,
      free_spins INTEGER DEFAULT 1,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by_user_id INTEGER,
      business_id TEXT, -- Tied to business_sites.id
      withdraw_blocked INTEGER DEFAULT 0,
      withdraw_limit REAL,
      withdraw_limit_until TEXT,
      frozen INTEGER DEFAULT 0,
      last_collected_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (referred_by_user_id) REFERENCES users(id),
      FOREIGN KEY (business_id) REFERENCES business_sites(id)
    )
  `);
  // Ensure case-insensitive uniqueness for usernames
  try { _db._db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users(LOWER(username))`); } catch(e) {}

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      earning_per_hour REAL NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '⛏️'
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS user_machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      machine_id INTEGER NOT NULL,
      purchased_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_type TEXT NOT NULL, -- 'plinko' | 'space_traveler' | 'lucky' | 'dice' | 'slots'
      bet_amount REAL NOT NULL,
      multiplier REAL NOT NULL,
      payout REAL NOT NULL,
      details TEXT, -- JSON string for extra data like risk, rows, or crash point
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS game_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_type TEXT UNIQUE NOT NULL, -- 'plinko', 'space_traveler', etc.
      rules JSON NOT NULL, -- The "Rule Book" for this game
      is_active INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Insert default rules if they don't exist
  try {
    const plinkoRules = JSON.stringify({
      max_multiplier: 8.0,
      eight_x_probability: 0.04,
      enforce_nudge: true,
      house_edge: 0.1,
      min_bet: 10,
      max_bet: 10000
    });
    const spaceTravelerRules = JSON.stringify({
      max_multiplier: 50.0,
      house_edge: 0.05,
      min_bet: 10,
      max_bet: 5000,
      crash_rarity_high: 0.02 // Probability for > 20x
    });
    const genericRules = (min, max, mult) => JSON.stringify({
      min_bet: min,
      max_bet: max,
      base_multiplier: mult,
      house_edge: 0.05
    });
    
    _db._db.run(`INSERT OR IGNORE INTO game_rules (game_type, rules) VALUES ('plinko', ?)`, [plinkoRules]);
    _db._db.run(`INSERT OR IGNORE INTO game_rules (game_type, rules) VALUES ('space_traveler', ?)`, [spaceTravelerRules]);
    _db._db.run(`INSERT OR IGNORE INTO game_rules (game_type, rules) VALUES ('lucky', ?)`, [genericRules(10, 5000, 9)]);
    _db._db.run(`INSERT OR IGNORE INTO game_rules (game_type, rules) VALUES ('dice', ?)`, [genericRules(10, 5000, 5)]);
    _db._db.run(`INSERT OR IGNORE INTO game_rules (game_type, rules) VALUES ('slots', ?)`, [genericRules(10, 5000, 30)]);
  } catch(e) { console.error('Default rules insertion error:', e.message); }

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
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
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      admin_note TEXT,
      business_id TEXT, -- Multi-tenant tracking
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (business_id) REFERENCES business_sites(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS spin_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      prize_type TEXT NOT NULL,
      prize_value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      transaction_ref TEXT,
      status TEXT DEFAULT 'pending',
      business_id TEXT, -- Multi-tenant tracking
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (business_id) REFERENCES business_sites(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'unread',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      last_active TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS business_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS admin_business_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT NOT NULL,
      business_id TEXT NOT NULL,
      is_running INTEGER DEFAULT 0,
      FOREIGN KEY (business_id) REFERENCES business_sites(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS payment_gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS crypto_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      name TEXT,
      network TEXT,
      address TEXT,
      qr_url TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // New: notifications for broadcasts/promotions
  _db._db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'promo',
      audience TEXT DEFAULT 'all',
      expires_at TEXT,
      require_ack INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS notification_targets (
      notification_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (notification_id, user_id),
      FOREIGN KEY (notification_id) REFERENCES notifications(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS notification_acks (
      notification_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (notification_id, user_id),
      FOREIGN KEY (notification_id) REFERENCES notifications(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  try { _db._db.run(`ALTER TABLE notifications ADD COLUMN expires_at TEXT`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE notifications ADD COLUMN require_ack INTEGER DEFAULT 0`); } catch(e) {}

  _db._db.run(`
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      deposit_limit REAL,
      withdraw_limit REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // New: user boosters (speed/discount) with expiry
  _db._db.run(`
    CREATE TABLE IF NOT EXISTS user_boosters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL, -- 'speed' | 'discount'
      value REAL NOT NULL, -- e.g., 0.2 for +20% or 0.15 for 15% discount
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_dashboard INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_settings INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_machines INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_spin INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_gateways INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_history INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_reports INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_security INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_controls INTEGER DEFAULT 0`); } catch(e) {}
  try { _db._db.run(`ALTER TABLE partners ADD COLUMN can_passwords INTEGER DEFAULT 0`); } catch(e) {}

  // Support chat: threads and messages (user <-> partner)
  _db._db.run(`
    CREATE TABLE IF NOT EXISTS support_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      partner_id INTEGER,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (partner_id) REFERENCES partners(id)
    )
  `);
  _db._db.run(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL, -- 'user' | 'partner'
      sender_id INTEGER NOT NULL,
      message_text TEXT,
      image_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (thread_id) REFERENCES support_threads(id)
    )
  `);

  // New: configurable spin prizes + weights, including 'lose'
  _db._db.run(`
    CREATE TABLE IF NOT EXISTS spin_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      type TEXT NOT NULL, -- 'machine' | 'balance' | 'lose'
      amount REAL,        -- for balance prizes
      machine_id INTEGER, -- for machine prizes
      weight REAL NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    )
  `);

  // New: withdrawal control columns on users
  try {
    _db._db.run(`ALTER TABLE users ADD COLUMN withdraw_blocked INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    _db._db.run(`ALTER TABLE users ADD COLUMN withdraw_limit REAL`);
  } catch (e) {}
  try {
    _db._db.run(`ALTER TABLE users ADD COLUMN withdraw_limit_until TEXT`);
  } catch (e) {}
  try {
    _db._db.run(`ALTER TABLE users ADD COLUMN frozen INTEGER DEFAULT 0`);
  } catch (e) {}

  // Seed default payment settings if not present
  const settingsCount = _db.prepare('SELECT COUNT(*) as count FROM settings').get();
  if (settingsCount.count === 0) {
    const defaults = [
      ['upi_id', 'mineprofit@ybl'],
      ['upi_name', 'MineProfit Official'],
      ['upi_qr_url', ''],
      ['crypto_btc', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
      ['crypto_eth', '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18'],
      ['crypto_usdt', 'TN2Y8vNk9R4VcXz8QELhPJ8Wg7tKmTa4zF'],
      ['crypto_qr_url', ''],
      ['spin_cost', '200']
    ];
    for (const [key, value] of defaults) {
      _db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }
    console.log('\u2705 Seeded default payment settings');
  }

  // Add free_spins column to users if not exists
  try {
    _db._db.run(`ALTER TABLE users ADD COLUMN free_spins INTEGER DEFAULT 1`);
  } catch (e) {
    // Column already exists
  }

  // Seed spin prizes (Force update to match new requirements)
  _db._db.run('DELETE FROM spin_prizes');
  const prizes = [
    // label, type, amount, machine_id, weight
    ['💰 ₹50 Cash', 'balance', 50, null, 45],
    ['💰 ₹100 Cash', 'balance', 100, null, 12],
    ['💰 ₹200 Cash', 'balance', 200, null, 2],
    ['💰 ₹500 Cash', 'balance', 500, null, 0.1],
    ['💰 ₹1,000 Cash', 'balance', 1000, null, 0],
    ['⛏️ Mini Miner', 'machine', null, 1, 35],
    ['🔧 Basic Rig', 'machine', null, 2, 0.2],
    ['🔨 Power Drill', 'machine', null, 3, 0],
    ['⚡ Turbo Miner', 'machine', null, 4, 0],
    ['🏭 Mega Machine', 'machine', null, 5, 0],
    ['🚀 Ultra Excavator', 'machine', null, 6, 0],
    ['💎 Diamond Drill', 'machine', null, 7, 0],
    ['🌟 Quantum Miner', 'machine', null, 8, 0],
    ['💣 Better luck next time', 'lose', null, null, 5.7]
  ];

  for (const [label, type, amount, machineId, weight] of prizes) {
    _db.prepare('INSERT INTO spin_prizes (label, type, amount, machine_id, weight, enabled) VALUES (?, ?, ?, ?, ?, 1)')
      .run(label, type, amount, machineId, weight);
  }
  console.log('✅ Updated spin_prizes table with new probabilities');

  // Add plain_password column for admin visibility
  try {
    _db._db.run(`ALTER TABLE users ADD COLUMN plain_password TEXT DEFAULT NULL`);
  } catch (e) {
    // Column already exists
  }

  // Seed machines if empty
  const countResult = _db.prepare('SELECT COUNT(*) as count FROM machines').get();
  if (countResult.count === 0) {
    const machines = [
      ['Mini Miner', 0, 4, 'Your free starter miner. Slow but steady!', '⛏️'],
      ['Basic Rig', 500, 12, 'A basic mining rig. 3x faster than the Mini Miner.', '🔧'],
      ['Power Drill', 1500, 30, 'Powerful drilling machine for serious miners.', '🔨'],
      ['Turbo Miner', 4000, 70, 'Turbocharged mining with high output.', '⚡'],
      ['Mega Machine', 10000, 160, 'Industrial-grade mining machine.', '🏭'],
      ['Ultra Excavator', 25000, 380, 'Top-tier excavator for maximum earnings.', '🚀'],
      ['Diamond Drill', 60000, 900, 'The ultimate mining machine. Pure diamond-tipped.', '💎'],
      ['Quantum Miner', 150000, 2200, 'Legendary quantum-powered mining rig.', '🌟'],
    ];

    for (const [name, price, earning, desc, icon] of machines) {
      _db.prepare('INSERT INTO machines (name, price, earning_per_hour, description, icon) VALUES (?, ?, ?, ?, ?)').run(name, price, earning, desc, icon);
    }
    console.log('✅ Seeded machines table');
  }

  // Seed demo user if no users exist
  const userCount = _db.prepare('SELECT COUNT(*) as count FROM users').get();
  const seedDisabledRow = _db.prepare("SELECT value FROM settings WHERE key = 'seed_demo_disabled'").get();
  const seedDisabled = seedDisabledRow && String(seedDisabledRow.value) === '1';
  if (userCount.count === 0 && !seedDisabled) {
    const demoHash = bcrypt.hashSync('demo123', 10);
    const demoRef = crypto.randomBytes(4).toString('hex').toUpperCase();

    // Create demo user with ₹25,000 balance and 5 free spins
    const demoResult = _db.prepare(`
      INSERT INTO users (username, email, password_hash, balance, referral_code, free_spins)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('demo', 'demo@mineprofit.com', demoHash, 25000, demoRef, 5);

    const demoId = demoResult.lastInsertRowid;

    // Give demo user several machines
    _db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 1)').run(demoId); // Mini Miner
    _db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 2)').run(demoId); // Basic Rig
    _db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 2)').run(demoId); // Basic Rig x2
    _db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 3)').run(demoId); // Power Drill
    _db.prepare('INSERT INTO user_machines (user_id, machine_id) VALUES (?, 4)').run(demoId); // Turbo Miner

    // Add profile with bank details
    _db.prepare(`
      INSERT INTO user_profiles (user_id, full_name, phone, address, city, state, pincode, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(demoId, 'Demo User', '9876543210', '123 Mining Street', 'Mumbai', 'Maharashtra', '400001', 'Demo User', '1234567890123456', 'SBIN0001234', 'State Bank of India', 'demo@upi');

    // Add some realistic transactions
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'deposit', 50000, 'Initial deposit via UPI')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', 0, 'Received free Mini Miner on signup')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'purchase', -500, 'Purchased Basic Rig')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'purchase', -500, 'Purchased Basic Rig')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'purchase', -1500, 'Purchased Power Drill')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'purchase', -4000, 'Purchased Turbo Miner')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'mining', 1200, 'Collected mining earnings')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'mining', 800, 'Collected mining earnings')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', 100, 'Won ₹100 from Spin Wheel!')`).run(demoId);
    _db.prepare(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'withdrawal', -20000, 'Withdrawal via UPI - ₹20000')`).run(demoId);

    // Add a completed withdrawal
    _db.prepare(`INSERT INTO withdrawals (user_id, amount, method, status) VALUES (?, 20000, 'upi', 'approved')`).run(demoId);

    // Add spin history
    _db.prepare(`INSERT INTO spin_history (user_id, prize_type, prize_value) VALUES (?, 'balance', '100')`).run(demoId);
    _db.prepare(`INSERT INTO spin_history (user_id, prize_type, prize_value) VALUES (?, 'machine', 'Mini Miner')`).run(demoId);

    console.log('\u2705 Demo user created (email: demo@mineprofit.com, password: demo123)');
  }

  _db.save();
  console.log('\u2705 Database initialized');
  return _db;
}

function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}

module.exports = { initDatabase, getDb };
