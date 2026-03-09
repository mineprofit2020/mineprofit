const axios = require('axios');

async function main() {
  const base = 'http://localhost:3000';
  const login = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('No admin session cookie');

  const reset = await axios.post(base + '/api/admin/reset/all', { confirm: 'RESET' }, { headers: { Cookie: cookie } });
  console.log('reset', reset.status, reset.data);

  const dash = await axios.get(base + '/api/admin/dashboard', { headers: { Cookie: cookie } });
  console.log('dashboard', dash.status, dash.data);
}

main().catch((e) => {
  if (e.response) {
    console.error('error', e.response.status, e.response.data);
  } else {
    console.error('error', e.message);
  }
  process.exit(1);
});

