const { initDatabase, getDb } = require('./db');
(async () => {
  await initDatabase();
  const db = getDb();
  console.log(db.prepare('SELECT * FROM users').all());
})();