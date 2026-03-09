const axios = require('axios');
const base = process.env.BASE || 'http://localhost:3001';

(async () => {
  let adminCookie = '';
  let tokenId = 0;
  let createdUserId = 0;
  try {
    const admin = await axios.post(base + '/api/admin/login', { username: 'admin', password: 'admin123' });
    adminCookie = (admin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    if (!adminCookie) throw new Error('Admin login failed (no cookie)');
    console.log('Logged in as admin.');

    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X0S0cAAAAASUVORK5CYII=';
    const dataUrl = 'data:image/png;base64,' + png;
    const upload = await axios.post(base + '/api/admin/upload', { filename: 'qr.png', data: dataUrl }, { headers: { Cookie: adminCookie } });
    if (!upload.data || !upload.data.success || !upload.data.url) throw new Error('Upload failed');
    console.log('Uploaded QR:', upload.data.url);

    const tokenAdd = await axios.post(
      base + '/api/admin/crypto/tokens/add',
      { symbol: 'TST', name: 'Test Token', network: 'TEST', address: 'test_address_123', qr_url: upload.data.url, enabled: 1 },
      { headers: { Cookie: adminCookie } }
    );
    console.log('Token add response:', tokenAdd.data);
    if (!tokenAdd.data || !tokenAdd.data.success) throw new Error('Token add failed');
    tokenId = tokenAdd.data.id;
    console.log('Created test token id:', tokenId);

    let cookie = '';
    try {
      const login = await axios.post(base + '/api/auth/login', { email: 'demo@mineprofit.com', password: 'demo123' });
      cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      console.log('Logged in as demo user.');
    } catch {
      const uname = 'test' + Date.now();
      const email = uname + '@example.com';
      const password = 'test1234';
      await axios.post(base + '/api/admin/users/create', { username: uname, email, password, balance: 0, free_spins: 1 }, { headers: { Cookie: adminCookie } });
      const users = await axios.get(base + '/api/admin/users?search=' + encodeURIComponent(email) + '&page=1&limit=10', { headers: { Cookie: adminCookie } });
      const u = (users.data.users || []).find(x => x.email === email);
      createdUserId = u ? u.id : 0;
      const login = await axios.post(base + '/api/auth/login', { email, password });
      cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      console.log('Logged in as fallback test user:', email);
    }

    const res = await axios.get(base + '/api/payment/info', { headers: { Cookie: cookie } });
    const tokens = res.data.tokens || [];
    const tok = tokens.find(t => t.symbol === 'TST');
    console.log('User panel token found:', !!tok, tok ? tok.qr_url : null);
    if (!tok || !tok.qr_url) throw new Error('Token not visible in user panel');

    const img = await axios.get(base + tok.qr_url, { responseType: 'arraybuffer' });
    console.log('QR fetch status:', img.status, 'bytes:', img.data.byteLength);

  } catch (e) {
    console.error('Error:', e.response ? e.response.data : e.message);
    process.exitCode = 1;
  } finally {
    try {
      if (adminCookie && tokenId) {
        await axios.post(base + '/api/admin/crypto/tokens/delete', { id: tokenId }, { headers: { Cookie: adminCookie } });
        console.log('Cleaned up test token.');
      }
    } catch {}
    try {
      if (adminCookie && createdUserId) {
        await axios.post(base + '/api/admin/users/delete', { user_id: createdUserId }, { headers: { Cookie: adminCookie } });
        console.log('Cleaned up test user.');
      }
    } catch {}
  }
})();
