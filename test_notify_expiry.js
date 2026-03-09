const axios = require('axios');

const base = process.env.BASE || 'http://localhost:3000';

(async () => {
  let adminCookie = '';
  let createdUserId = 0;
  try {
    const admin = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
    adminCookie = (admin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    if (!adminCookie) throw new Error('Admin login failed');

    const uname = 'etest' + Date.now();
    const email = uname + '@example.com';
    const password = 'test1234';

    await axios.post(
      base + '/api/admin/users/create',
      { username: uname, email, password, balance: 0, free_spins: 1 },
      { headers: { Cookie: adminCookie } }
    );

    const users = await axios.get(
      base + '/api/admin/users?search=' + encodeURIComponent(email) + '&page=1&limit=10',
      { headers: { Cookie: adminCookie } }
    );
    const u = (users.data.users || []).find(x => x.email === email);
    createdUserId = u ? u.id : 0;
    if (!createdUserId) throw new Error('Failed to resolve created user id');

    await axios.post(
      base + '/api/admin/notify/send',
      { title: 'Expired', message: 'Should not show', type: 'personal', target: 'targeted', usernames: [uname], require_ack: false, expires_at: '2000-01-01 00:00:00' },
      { headers: { Cookie: adminCookie } }
    );
    await axios.post(
      base + '/api/admin/notify/send',
      { title: 'Active', message: 'Should show', type: 'personal', target: 'targeted', usernames: [uname], require_ack: false, expires_at: '2099-01-01 00:00:00' },
      { headers: { Cookie: adminCookie } }
    );

    const login = await axios.post(base + '/api/auth/login', { email, password });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    const promos = await axios.get(base + '/api/dashboard/promotions', { headers: { Cookie: cookie } });
    const list = promos.data.notifications || [];
    const hasExpired = list.some(n => n.title === 'Expired');
    const hasActive = list.some(n => n.title === 'Active');
    console.log('hasExpired', hasExpired, 'hasActive', hasActive);
    if (hasExpired) throw new Error('Expired notification still visible');
    if (!hasActive) throw new Error('Active notification not visible');
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

