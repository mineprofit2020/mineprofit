const axios = require('axios');

const base = process.env.BASE || 'http://localhost:3001';

(async () => {
  let adminCookie = '';
  let createdUserId = 0;
  try {
    const admin = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
    adminCookie = (admin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    if (!adminCookie) throw new Error('Admin login failed');

    await axios.post(
      base + '/api/admin/settings/update',
      {
        withdraw_cap_upi: 1000,
        withdraw_cap_bank: 1000,
        withdraw_daily_cap: 5000,
        withdraw_frequency_limit: 3,
        withdraw_frequency_hours: 2
      },
      { headers: { Cookie: adminCookie } }
    );

    const uname = 'wtest' + Date.now();
    const email = uname + '@example.com';
    const password = 'test1234';

    await axios.post(
      base + '/api/admin/users/create',
      { username: uname, email, password, balance: 10000, free_spins: 1 },
      { headers: { Cookie: adminCookie } }
    );

    const users = await axios.get(
      base + '/api/admin/users?search=' + encodeURIComponent(email) + '&page=1&limit=10',
      { headers: { Cookie: adminCookie } }
    );
    const u = (users.data.users || []).find(x => x.email === email);
    createdUserId = u ? u.id : 0;
    if (!createdUserId) throw new Error('Failed to resolve created user id');

    const login = await axios.post(base + '/api/auth/login', { email, password });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('User login failed');

    await axios.post(
      base + '/api/profile/update',
      {
        full_name: 'Test User',
        phone: '9999999999',
        address: 'Addr',
        city: 'City',
        state: 'State',
        pincode: '000000',
        bank_account_name: 'Name',
        bank_account_number: '1234567890',
        bank_ifsc: 'TEST0001',
        bank_name: 'Test Bank',
        upi_id: 'test@upi'
      },
      { headers: { Cookie: cookie } }
    );

    let ok = 0;
    let blocked = 0;
    for (let i = 0; i < 4; i++) {
      try {
        await axios.post(base + '/api/profile/withdraw', { amount: 500, method: 'upi' }, { headers: { Cookie: cookie } });
        ok++;
      } catch (e) {
        blocked++;
        console.log('frequency_block:', e.response?.data?.error || e.message);
      }
    }

    try {
      await axios.post(base + '/api/profile/withdraw', { amount: 1500, method: 'upi' }, { headers: { Cookie: cookie } });
      console.log('per_tx_cap: FAILED (should have blocked)');
    } catch (e) {
      console.log('per_tx_cap:', e.response?.data?.error || e.message);
    }

    try {
      await axios.post(base + '/api/profile/withdraw', { amount: 4000, method: 'bank' }, { headers: { Cookie: cookie } });
      console.log('daily_cap: FAILED (should have blocked)');
    } catch (e) {
      console.log('daily_cap:', e.response?.data?.error || e.message);
    }

    console.log('withdrawals_ok:', ok, 'withdrawals_blocked:', blocked);
  } catch (e) {
    console.error('ERR:', e.response ? e.response.data : e.message);
    process.exitCode = 1;
  } finally {
    try {
      if (adminCookie && createdUserId) {
        await axios.post(base + '/api/admin/users/delete', { user_id: createdUserId }, { headers: { Cookie: adminCookie } });
      }
    } catch {}
  }
})();

