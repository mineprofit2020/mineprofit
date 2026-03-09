const axios = require('axios');
const base = 'http://localhost:3000';

(async () => {
  try {
    const login = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
    const cookie = login.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    console.log('Logged in.');

    const payload = {
      usdt_inr_rate: '105',
      crypto_btc: 'btc_test_addr'
    };

    console.log('Sending payload:', payload);
    const res = await axios.post(base + '/api/admin/settings/update', payload, { headers: { Cookie: cookie } });
    console.log('Update response:', res.data);
  } catch (e) {
    console.error('Error:', e.response ? e.response.data : e.message);
  }
})();