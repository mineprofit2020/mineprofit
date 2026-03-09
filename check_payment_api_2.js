const axios = require('axios');
const base = 'http://localhost:3000';

(async () => {
  try {
    const login = await axios.post(base + '/api/auth/login', { email: 'user1@gmail.com', password: '123456' });
    const cookie = login.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    console.log('Logged in as user1.');

    const res = await axios.get(base + '/api/payment/info', { headers: { Cookie: cookie } });
    console.log('Payment Info Settings:', res.data.settings);
  } catch (e) {
    console.error('Error:', e.response ? e.response.data : e.message);
  }
})();