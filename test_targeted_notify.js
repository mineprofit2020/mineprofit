const axios = require('axios');

const base = process.env.BASE || 'http://localhost:3000';

(async () => {
  let adminCookie = '';
  let createdUserId = 0;
  let notifId = 0;
  try {
    const admin = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
    adminCookie = (admin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    if (!adminCookie) throw new Error('Admin login failed');

    const uname = 'ntest' + Date.now();
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

    const send = await axios.post(
      base + '/api/admin/notify/send',
      { title: 'Hello', message: 'Targeted test', type: 'personal', target: 'targeted', usernames: [uname], require_ack: true },
      { headers: { Cookie: adminCookie } }
    );
    notifId = send.data.id || 0;
    console.log('sent_notif_id', notifId, 'targets', send.data.targets);

    const login = await axios.post(base + '/api/auth/login', { email, password });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('User login failed');

    const promos = await axios.get(base + '/api/dashboard/promotions', { headers: { Cookie: cookie } });
    const list = promos.data.notifications || [];
    const found = list.find(n => n.title === 'Hello' && n.message === 'Targeted test');
    console.log('user_received', !!found);
    if (!found) throw new Error('User did not receive targeted notification');

    await axios.post(base + '/api/notify/ack', { notification_id: found.id }, { headers: { Cookie: cookie } });
    const promos2 = await axios.get(base + '/api/dashboard/promotions', { headers: { Cookie: cookie } });
    const found2 = (promos2.data.notifications || []).find(n => n.id === found.id);
    console.log('acked_field', found2 ? found2.acked : null);
    if (!found2 || String(found2.acked) !== '1') throw new Error('Ack not reflected');
  } catch (e) {
    console.error('ERR:', e.response ? e.response.data : e.message);
    process.exitCode = 1;
  } finally {
    try {
      if (adminCookie && createdUserId) {
        await axios.post(base + '/api/admin/users/delete', { user_id: createdUserId }, { headers: { Cookie: adminCookie } });
      }
    } catch {}
    try {
      if (adminCookie && notifId) {
        await axios.post(base + '/api/admin/notify/delete', { id: notifId }, { headers: { Cookie: adminCookie } });
      }
    } catch {}
  }
})();

