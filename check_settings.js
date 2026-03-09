const { initDatabase, getDb } = require('./db');
(async () => {
  try {
    console.log('Calling initDatabase...');
    await initDatabase();
    console.log('initDatabase done.');
    const db = getDb();
    console.log('getDb done.');
    const row = db.prepare("SELECT * FROM settings WHERE key = 'usdt_inr_rate'").get();
    console.log('Row:', row);
  } catch (e) {
    console.error(e);
  }
})();
