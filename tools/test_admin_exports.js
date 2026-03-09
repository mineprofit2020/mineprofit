const axios = require('axios');

async function main() {
  const base = 'http://localhost:3000';
  const login = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const headers = cookie ? { Cookie: cookie } : {};

  const dep = await axios.get(base + '/api/admin/export/report-deposits', { headers });
  console.log('Deposits CSV first 3 lines:\n' + dep.data.split('\n').slice(0, 3).join('\n'));

  const wd = await axios.get(base + '/api/admin/export/report-withdrawals', { headers });
  console.log('\nWithdrawals CSV first 3 lines:\n' + wd.data.split('\n').slice(0, 3).join('\n'));
}

main().catch((e) => {
  console.error(e.response ? e.response.data : e);
  process.exit(1);
});

