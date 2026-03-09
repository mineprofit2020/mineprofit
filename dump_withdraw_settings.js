const axios = require('axios');

const base = process.env.BASE || 'http://localhost:3001';

(async () => {
  try {
    const admin = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
    const adminCookie = (admin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const res = await axios.get(base + '/api/admin/settings', { headers: { Cookie: adminCookie } });
    const s = res.data.settings || {};
    console.log({
      withdraw_cap_upi: s.withdraw_cap_upi,
      withdraw_cap_bank: s.withdraw_cap_bank,
      withdraw_daily_cap: s.withdraw_daily_cap,
      withdraw_frequency_limit: s.withdraw_frequency_limit,
      withdraw_frequency_hours: s.withdraw_frequency_hours
    });
  } catch (e) {
    console.error('ERR', e.response ? e.response.data : e.message);
    process.exitCode = 1;
  }
})();

