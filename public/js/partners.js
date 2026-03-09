// Helper to format date
function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d.includes(' ') ? d.replace(' ', 'T') + 'Z' : d + 'Z');
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// Toast helper
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('show'); }, 100);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

async function pLogin() {
  const err = document.getElementById('p_err');
  err.style.display = 'none';
  const username = document.getElementById('p_user').value.trim();
  const password = document.getElementById('p_pass').value;
  try {
    const res = await fetch('/api/partner/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (data.success) {
      document.getElementById('partnerLogin').style.display = 'none';
      document.getElementById('partnerPanel').style.display = 'block';
      loadPartner();
    } else {
      err.textContent = data.error || 'Login failed';
      err.style.display = 'block';
    }
  } catch {
    err.textContent = 'Login failed';
    err.style.display = 'block';
  }
}

document.getElementById('partnerLoginForm')?.addEventListener('submit', (e) => { e.preventDefault(); pLogin(); });
document.getElementById('partnerLogout')?.addEventListener('click', async (e) => { e.preventDefault(); await fetch('/api/partner/logout', { method: 'POST' }); location.reload(); });
document.getElementById('partnerMobileLogout')?.addEventListener('click', async (e) => { e.preventDefault(); await fetch('/api/partner/logout', { method: 'POST' }); location.reload(); });

// Tabs Logic
document.querySelectorAll('.p-tab, .admin-nav-mobile a').forEach(t => {
  t.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = t.dataset.tab;
    if (!tab) return;
    
    document.querySelectorAll('.p-tab, .admin-nav-mobile a').forEach(x => x.classList.remove('active'));
    document.querySelectorAll(`[data-tab="${tab}"]`).forEach(x => x.classList.add('active'));
    
    document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
    document.getElementById('p-' + tab).style.display = 'block';
    
    if (tab === 'overview') pLoadStats();
    if (tab === 'users') pLoadUsers();
    if (tab === 'payments') pLoadPayments();
    if (tab === 'withdrawals') pLoadWithdrawals();
  });
});

let currentPartner = null;

async function loadPartner() {
  const res = await fetch('/api/partner/me');
  const data = await res.json();
  if (data.error) { location.reload(); return; }
  
  currentPartner = data.partner;
  const p = currentPartner;
  
  // Hide unauthorized tabs
  if (!p.can_dashboard) document.querySelectorAll('[data-tab="overview"]').forEach(el => el.style.display = 'none');
  if (!p.can_users) document.querySelectorAll('[data-tab="users"]').forEach(el => el.style.display = 'none');
  if (!p.can_withdrawals) document.querySelectorAll('[data-tab="withdrawals"]').forEach(el => el.style.display = 'none');
  if (!p.can_deposits) document.querySelectorAll('[data-tab="payments"]').forEach(el => el.style.display = 'none');
  if (!p.can_messages) document.querySelectorAll('[data-tab="messages"]').forEach(el => el.style.display = 'none');
  if (!p.can_settings && !p.can_machines && !p.can_spin && !p.can_gateways && !p.can_history && !p.can_reports && !p.can_security) {
    document.querySelectorAll('[data-tab="settings"]').forEach(el => el.style.display = 'none');
  } else {
    // Hide specific settings cards
    if (!p.can_machines) document.querySelector('[onclick="openPSubTab(\'machines\')"]').style.display = 'none';
    if (!p.can_gateways && !p.can_settings) document.querySelector('[onclick="openPSubTab(\'paysettings\')"]').style.display = 'none';
    if (!p.can_spin) document.querySelector('[onclick="openPSubTab(\'spin\')"]').style.display = 'none';
    if (!p.can_history) document.querySelector('[onclick="openPSubTab(\'history\')"]').style.display = 'none';
    if (!p.can_reports) document.querySelector('[onclick="openPSubTab(\'reports\')"]').style.display = 'none';
    if (!p.can_security) document.querySelector('[onclick="openPSubTab(\'security\')"]').style.display = 'none';
  }

  // Default tab
  if (p.can_dashboard) {
     document.querySelector('[data-tab="overview"]').click();
  } else if (p.can_deposits) {
     document.querySelector('[data-tab="payments"]').click();
  }
}

// Stats
async function pLoadStats() {
  try {
    const res = await fetch('/api/partner/dashboard');
    const data = await res.json();
    document.getElementById('partnerStats').innerHTML = `
      <div class="stat-card"><div class="stat-icon" style="background:rgba(59,130,246,0.1); color:#3b82f6;">👥</div><div class="stat-value">${data.totalUsers}</div><div class="stat-label">Total Users</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(16,185,129,0.1); color:#10b981;">💰</div><div class="stat-value">₹${data.totalBalance.toFixed(2)}</div><div class="stat-label">User Balances</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(245,158,11,0.1); color:#f59e0b;">💳</div><div class="stat-value">₹${data.totalDeposits.toFixed(2)}</div><div class="stat-label">Total Deposits</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(239,68,68,0.1); color:#ef4444;">💸</div><div class="stat-value">₹${data.totalWithdrawals.toFixed(2)}</div><div class="stat-label">Total Withdrawals</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(99,102,241,0.1); color:#6366f1;">⏳</div><div class="stat-value">${data.pendingPayments}</div><div class="stat-label">Pending Deposits</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(139,92,246,0.1); color:#8b5cf6;">⌛</div><div class="stat-value">${data.pendingWithdrawals}</div><div class="stat-label">Pending W/D</div></div>
    `;
  } catch {}
}

// Users
async function pLoadUsers(page = 1) {
  try {
    const search = document.getElementById('p_userSearch').value;
    const res = await fetch(`/api/partner/users?page=${page}&search=${encodeURIComponent(search)}`);
    const data = await res.json();
    const list = document.getElementById('pUsersList');
    list.innerHTML = data.users.length === 0 ? '<div class="no-transactions">No users found</div>' :
      data.users.map(u => `
        <div class="user-card">
          <div class="user-header">
            <div style="font-size:1.5rem;">👤</div>
            <div>
              <div class="user-name">${u.username} ${u.frozen ? '❄️' : ''}</div>
              <div class="user-email">${u.email}</div>
            </div>
            <div style="margin-left:auto; text-align:right;">
              <div style="font-size:0.8rem; color:var(--text-muted);">Joined</div>
              <div style="font-weight:500;">${formatDate(u.created_at)}</div>
            </div>
          </div>
          <div class="user-stats-grid">
            <div class="stat-item"><span class="stat-label">Balance</span><span class="stat-value" style="color:#10b981;">₹${u.balance.toFixed(2)}</span></div>
            <div class="stat-item"><span class="stat-label">Machines</span><span class="stat-value">${u.machine_count}</span></div>
            <div class="stat-item"><span class="stat-label">Deposited</span><span class="stat-value">₹${u.total_deposited.toFixed(2)}</span></div>
            <div class="stat-item"><span class="stat-label">Won</span><span class="stat-value">₹${u.total_won.toFixed(2)}</span></div>
          </div>
          <div class="control-section" style="display:flex; gap:8px; flex-wrap:wrap; background:rgba(255,255,255,0.02);">
            ${currentPartner.can_controls ? `
              <button class="btn-admin ${u.frozen ? 'btn-emerald' : 'btn-coral'}" onclick="pToggleFrozen(${u.id}, ${u.frozen})">${u.frozen ? 'Unfreeze' : 'Freeze'}</button>
              <button class="btn-admin ${u.withdraw_blocked ? 'btn-emerald' : 'btn-coral'}" onclick="pToggleWDBlocked(${u.id}, ${u.withdraw_blocked})">${u.withdraw_blocked ? 'Unblock W/D' : 'Block W/D'}</button>
            ` : ''}
            ${currentPartner.can_passwords ? `
              <button class="btn-admin btn-indigo" onclick="pResetUserPass(${u.id})">🔑 Pass</button>
            ` : ''}
            ${currentPartner.can_history ? `
              <button class="btn-admin btn-indigo" onclick="pOpenHistory('${u.username}')">🔍 History</button>
            ` : ''}
          </div>
        </div>
      `).join('');
    
    // Pagination
    const pag = document.getElementById('pUsersPagination');
    pag.innerHTML = '';
    if (data.totalPages > 1) {
      for (let i = 1; i <= data.totalPages; i++) {
        const b = document.createElement('button');
        b.className = `page-btn ${i === data.page ? 'active' : ''}`;
        b.textContent = i;
        b.onclick = () => pLoadUsers(i);
        pag.appendChild(b);
      }
    }
  } catch {}
}

async function pToggleFrozen(id, cur) {
  const res = await fetch('/api/partner/users/controls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: id, frozen: !cur }) });
  if ((await res.json()).success) pLoadUsers();
}
async function pToggleWDBlocked(id, cur) {
  const res = await fetch('/api/partner/users/controls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: id, withdraw_blocked: !cur }) });
  if ((await res.json()).success) pLoadUsers();
}
async function pResetUserPass(id) {
  const pass = prompt('Enter new password (min 6 chars):');
  if (!pass) return;
  const res = await fetch('/api/partner/users/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: id, new_password: pass }) });
  const data = await res.json();
  showToast(data.success ? 'Password updated' : data.error, data.success ? 'success' : 'error');
}

// Modal logic
function showCreateUserModal() { document.getElementById('createUserModal').style.display = 'flex'; }
function hideCreateUserModal() { document.getElementById('createUserModal').style.display = 'none'; }

async function pcuCreate() {
  const body = {
    username: document.getElementById('pcu_user').value.trim(),
    email: document.getElementById('pcu_email').value.trim(),
    password: document.getElementById('pcu_pass').value,
    balance: document.getElementById('pcu_bal').value,
    free_spins: document.getElementById('pcu_spins').value
  };
  const res = await fetch('/api/partner/users/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  const msg = document.getElementById('pcu_msg');
  msg.className = data.success ? 'success-msg' : 'error-msg';
  msg.textContent = data.success ? 'User created' : (data.error || 'Failed');
  if (data.success) {
    pLoadUsers();
    setTimeout(hideCreateUserModal, 1500);
  }
}

// Payments
async function pLoadPayments() {
  try {
    const res = await fetch('/api/partner/payments');
    if (res.status === 403) return;
    const data = await res.json();
    document.getElementById('pPayments').innerHTML = data.payments.length === 0
      ? '<div style="padding:40px;text-align:center;color:var(--text-muted);">No payment records found</div>'
      : `
        <div class="user-list-container">
          ${data.payments.map(p => `
            <div class="user-card">
              <div class="user-header">
                <div style="font-size:1.5rem;">💳</div>
                <div>
                  <div class="user-name">₹${p.amount.toFixed(2)} <span style="font-weight:400;color:var(--text-secondary);">via ${p.method.toUpperCase()}</span></div>
                  <div class="user-email">${p.username} (${p.email})</div>
                </div>
                <div style="margin-left:auto; text-align:right;">
                  <span class="status-pill status-${p.status}">${p.status.toUpperCase()}</span>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${formatDate(p.created_at)}</div>
                </div>
              </div>
              <div class="user-stats-grid">
                <div class="stat-item"><span class="stat-label">Ref</span><span class="stat-value">${p.transaction_ref || 'N/A'}</span></div>
                <div class="stat-item"><span class="stat-label">Gateway</span><span class="stat-value">${p.gateway_id || 'Standard'}</span></div>
              </div>
              ${p.status === 'pending' ? `
                <div class="control-section" style="background:rgba(255,255,255,0.02); display:flex; gap:12px; justify-content:flex-end;">
                  <button class="btn-admin btn-emerald" onclick="pUpdatePayment(${p.id}, 'approved')">✅ Approve</button>
                  <button class="btn-admin btn-coral" onclick="pUpdatePayment(${p.id}, 'rejected')">❌ Reject</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
  } catch {}
}

async function pUpdatePayment(id, status) {
  const res = await fetch('/api/partner/payments/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
  const data = await res.json();
  if (data.success) { showToast('Payment ' + status); pLoadPayments(); } else showToast(data.error, 'error');
}

// Withdrawals
async function pLoadWithdrawals() {
  try {
    const res = await fetch('/api/partner/withdrawals');
    if (res.status === 403) return;
    const data = await res.json();
    document.getElementById('pWithdrawals').innerHTML = data.withdrawals.length === 0
      ? '<div style="padding:40px;text-align:center;color:var(--text-muted);">No withdrawal requests found</div>'
      : `
        <div class="user-list-container">
          ${data.withdrawals.map(w => `
            <div class="user-card">
              <div class="user-header">
                <div style="font-size:1.5rem;">💸</div>
                <div>
                  <div class="user-name">₹${w.amount.toFixed(2)} <span style="font-weight:400;color:var(--text-secondary);">via ${w.method.toUpperCase()}</span></div>
                  <div class="user-email">${w.username} (${w.email})</div>
                </div>
                <div style="margin-left:auto; text-align:right;">
                  <span class="status-pill status-${w.status}">${w.status.toUpperCase()}</span>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${formatDate(w.created_at)}</div>
                </div>
              </div>
              <div class="user-stats-grid">
                <div class="stat-item"><span class="stat-label">Bank/UPI</span><span class="stat-value">${w.bank_name || ''} ${w.bank_account_number || ''} ${w.upi_id || ''}</span></div>
                <div class="stat-item"><span class="stat-label">IFSC</span><span class="stat-value">${w.bank_ifsc || '-'}</span></div>
              </div>
              ${w.status === 'pending' ? `
                <div class="control-section" style="background:rgba(255,255,255,0.02); display:flex; gap:12px; justify-content:flex-end;">
                  <button class="btn-admin btn-emerald" onclick="pUpdateWithdrawal(${w.id}, 'approved')">✅ Approve</button>
                  <button class="btn-admin btn-coral" onclick="pUpdateWithdrawal(${w.id}, 'rejected')">❌ Reject</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
  } catch {}
}

async function pUpdateWithdrawal(id, status) {
  const note = status === 'rejected' ? prompt('Reason for rejection:') : '';
  const res = await fetch('/api/partner/withdrawals/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status, admin_note: note }) });
  const data = await res.json();
  if (data.success) { showToast('Withdrawal ' + status); pLoadWithdrawals(); } else showToast(data.error, 'error');
}

// Sub-tabs for Messages
function openPTab(sub) {
  document.getElementById('p-broadcast').style.display = 'none';
  document.getElementById('p-support').style.display = 'none';
  document.getElementById('p-contacts').style.display = 'none';
  document.getElementById('p-' + sub).style.display = 'block';
  if (sub === 'broadcast') pLoadBroadcasts();
  if (sub === 'support') pLoadThreads();
  if (sub === 'contacts') pLoadContacts();
}

async function pLoadBroadcasts() {
  try {
    const res = await fetch('/api/partner/notify/list');
    const data = await res.json();
    const list = document.getElementById('pBroadcastList');
    if (!list) return;

    list.innerHTML = data.notifications.length === 0
      ? '<div style="padding:20px;text-align:center;color:var(--text-muted);">No broadcasts found</div>'
      : `
        <div class="user-list-container">
          ${data.notifications.map(n => `
            <div class="user-card" style="padding:16px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <div style="font-weight:700; color:var(--text-primary);">📣 ${n.title}</div>
                <span class="status-pill" style="background:rgba(255,255,255,0.1); color:var(--text-secondary); font-size:0.75rem;">${n.type.toUpperCase()}</span>
              </div>
              <div style="color:var(--text-secondary); font-size:0.95rem; margin-bottom:12px; line-height:1.5;">${n.message}</div>
              <div class="user-stats-grid" style="grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:0;">
                <div class="stat-item"><span class="stat-label">Target</span><span class="stat-value" style="font-size:0.9rem;">${n.audience === 'all' ? 'All Users' : (n.target_count || 0) + ' Users'}</span></div>
                <div class="stat-item"><span class="stat-label">Views</span><span class="stat-value" style="font-size:0.9rem;">${n.view_count || 0}</span></div>
                <div class="stat-item"><span class="stat-label">Sent</span><span class="stat-value" style="font-size:0.9rem;">${formatDate(n.created_at)}</span></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
  } catch (err) { console.error('Broadcast load error:', err); }
}

async function ppSend() {
  const title = document.getElementById('pp_title').value.trim();
  const message = document.getElementById('pp_message').value.trim();
  const target = document.getElementById('pp_target').value;
  const require_ack = document.getElementById('pp_require').value === '1';
  const expires_raw = document.getElementById('pp_expires').value;
  
  if (!title || !message) { showToast('Title and message are required', 'error'); return; }

  const normalizeExpires = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    if (s.includes('T')) return s.replace('T', ' ') + ':00';
    return s;
  };

  const body = {
    title, message, target, require_ack,
    expires_at: normalizeExpires(expires_raw)
  };

  if (target === 'usernames') {
    const names = document.getElementById('pp_usernames').value.split(',').map(s => s.trim()).filter(Boolean);
    if (names.length === 0) { showToast('Enter at least one username', 'error'); return; }
    body.usernames = names;
  }

  const res = await fetch('/api/partner/notify/send', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(body) 
  });
  const data = await res.json();
  showToast(data.success ? 'Broadcast sent' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) {
    document.getElementById('pp_title').value = '';
    document.getElementById('pp_message').value = '';
  }
}

// Settings logic
function openPSubTab(sub) {
  document.getElementById('p-settings-grid').style.display = 'none';
  document.getElementById('p-settings-subpanels').style.display = 'block';
  document.querySelectorAll('.p-sub-panel').forEach(p => p.style.display = 'none');
  document.getElementById('psub-' + sub).style.display = 'block';
  
  if (sub === 'machines') pLoadMachines();
  if (sub === 'paysettings') pLoadPaySettings();
  if (sub === 'spin') pLoadSpin();
}
function closePSubTabs() {
  document.getElementById('p-settings-grid').style.display = 'grid';
  document.getElementById('p-settings-subpanels').style.display = 'none';
}

async function pLoadMachines() {
  const res = await fetch('/api/partner/machines');
  const data = await res.json();
  document.getElementById('pMachinesList').innerHTML = data.machines.map(m => `
    <div class="admin-item-card">
      <div class="admin-item-header">${m.name}</div>
      <div class="form-grid">
        <div class="form-group"><label>Price (₹)</label><input type="number" id="pm_p_${m.id}" value="${m.price}"></div>
        <div class="form-group"><label>Earnings/Hr (₹)</label><input type="number" id="pm_e_${m.id}" value="${m.earning_per_hour}"></div>
        <div class="form-group" style="grid-column:1/-1;"><label>Icon (Emoji/HTML)</label><input type="text" id="pm_i_${m.id}" value="${m.icon}"></div>
      </div>
      <button class="btn btn-primary" style="margin-top:10px;" onclick="pSaveMachine(${m.id})">Save Machine</button>
    </div>
  `).join('');
}
async function pSaveMachine(id) {
  const body = { id, price: document.getElementById(`pm_p_${id}`).value, earning_per_hour: document.getElementById(`pm_e_${id}`).value, icon: document.getElementById(`pm_i_${id}`).value };
  const res = await fetch('/api/partner/machines/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if ((await res.json()).success) showToast('Saved');
}

async function pLoadPaySettings() {
  const sres = await fetch('/api/partner/settings');
  const sdata = await sres.json();
  const s = sdata.settings;
  document.getElementById('pps_usdt_rate').value = s.usdt_inr_rate || 101;
  document.getElementById('pps_min_wd').value = s.min_withdrawal || 100;
  document.getElementById('pps_max_wd').value = s.max_withdrawal || 50000;
  document.getElementById('pps_wd_fee').value = s.withdrawal_fee_percent || 5;
  
  const gres = await fetch('/api/partner/gateways');
  const gdata = await gres.json();
  document.getElementById('pGatewaysList').innerHTML = gdata.gateways.map(g => `<div>${g.name} (${g.type}) - ${g.active ? '✅' : '❌'}</div>`).join('');
}
async function pSaveSettings() {
  const body = { 
    usdt_inr_rate: document.getElementById('pps_usdt_rate').value,
    min_withdrawal: document.getElementById('pps_min_wd').value,
    max_withdrawal: document.getElementById('pps_max_wd').value,
    withdrawal_fee_percent: document.getElementById('pps_wd_fee').value
  };
  const res = await fetch('/api/partner/settings/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if ((await res.json()).success) showToast('Financial settings saved');
}

async function pLoadSpin() {
  const sres = await fetch('/api/partner/settings');
  const sdata = await sres.json();
  const s = sdata.settings;
  
  document.getElementById('ps_cost').value = s.spin_cost || 200;
  document.getElementById('ps_diff').value = s.spin_difficulty || 1;
  document.getElementById('ps_mul').value = s.spin_reward_multiplier || 1.0;
  document.getElementById('ps_lucky_diff').value = s.game_lucky_difficulty || 1;
  document.getElementById('ps_dice_diff').value = s.game_dice_difficulty || 1;

  const res = await fetch('/api/partner/spin/config');
  const data = await res.json();
  document.getElementById('pSpinPrizes').innerHTML = data.prizes.map(p => `<div>${p.label} (${p.type})</div>`).join('');
}

async function pSaveGameSettings() {
  const body = {
    spin_cost: document.getElementById('ps_cost').value,
    spin_difficulty: document.getElementById('ps_diff').value,
    spin_reward_multiplier: document.getElementById('ps_mul').value,
    game_lucky_difficulty: document.getElementById('ps_lucky_diff').value,
    game_dice_difficulty: document.getElementById('ps_dice_diff').value
  };
  const res = await fetch('/api/partner/settings/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if ((await res.json()).success) showToast('Game settings saved');
}

async function phLookup() {
  const uInput = document.getElementById('ph_lookup').value.trim();
  const res = await fetch('/api/partner/users/history?username=' + encodeURIComponent(uInput));
  const data = await res.json();
  const resultEl = document.getElementById('ph_result');
  if (data.error) { resultEl.innerHTML = `<div class="error-msg">${data.error}</div>`; return; }
  
  const u = data.user;
  const s = data.summary;
  const p = data.profile;

  let html = `
    <div class="admin-item-card">
      <div class="admin-item-header">👤 ${u.username} — ${u.email}</div>
      <div class="stats-grid" style="margin:16px 0;">
        <div class="stat-card" style="background:rgba(59,130,246,0.05);"><div class="stat-icon">💰</div><div class="stat-info"><div class="stat-label">Balance</div><div class="stat-value">₹${u.balance.toFixed(2)}</div></div></div>
        <div class="stat-card" style="background:rgba(16,185,129,0.05);"><div class="stat-icon">📈</div><div class="stat-info"><div class="stat-label">Earning/Hr</div><div class="stat-value">₹${s.totalPerHour}</div></div></div>
        <div class="stat-card" style="background:rgba(245,158,11,0.05);"><div class="stat-icon">⚙️</div><div class="stat-info"><div class="stat-label">Machines</div><div class="stat-value">${s.machineCount}</div></div></div>
        <div class="stat-card" style="background:rgba(139,92,246,0.05);"><div class="stat-icon">🎟️</div><div class="stat-info"><div class="stat-label">Free Spins</div><div class="stat-value">${u.free_spins||0}</div></div></div>
      </div>
      <div class="admin-item-details">
        <strong>Summary:</strong> Dep: <strong>₹${s.totalDeposited}</strong> | WD: <strong>₹${s.totalWithdrawn}</strong> | Mine: <strong>₹${s.totalMiningEarnings}</strong> | Ref: <strong>₹${s.totalReferralEarnings}</strong> | Bonus: <strong>₹${s.totalSpinWinnings}</strong> | Buy: <strong>₹${s.totalPurchases}</strong>
      </div>
      <div class="admin-item-details">
        Referral Code: <strong>${u.referral_code}</strong> | Joined: ${formatDate(u.created_at)} | Last Collected: ${formatDate(u.last_collected_at || '')}
      </div>`;

  if (p) {
    html += `
      <div class="admin-item-details" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
        <strong>Profile:</strong> ${p.full_name||'N/A'} | ${p.phone||'N/A'} | ${p.city||''} ${p.state||''}<br>
        <strong>Bank:</strong> ${p.bank_name||'N/A'} A/C: ${p.bank_account_number||'N/A'} IFSC: ${p.bank_ifsc||'N/A'} | UPI: ${p.upi_id||'N/A'}
      </div>`;
  }
  html += `</div>`;

  // Machines
  if (data.machines && data.machines.length > 0) {
    html += `<h3 style="margin:20px 0 12px;">⚙️ Machines (${data.machines.length})</h3><div class="admin-scroll-table">`;
    data.machines.forEach(m => {
      html += `<div class="admin-item-card" style="padding:12px 16px;"><span style="font-size:1.2rem;">${m.icon}</span> <strong>${m.name}</strong> — ₹${m.earning_per_hour}/hr — Bought: ${formatDate(m.purchased_at)}</div>`;
    });
    html += `</div>`;
  }

  // Recent Transactions
  if (data.transactions && data.transactions.length > 0) {
    html += `<h3 style="margin:20px 0 12px;">📜 Transactions (last ${data.transactions.length})</h3><div class="transactions-list" style="max-height:400px;overflow-y:auto;">`;
    data.transactions.forEach(t => {
      const isPos = t.amount >= 0 && t.type !== 'purchase';
      html += `<div class="transaction-item"><div class="tx-info"><div class="tx-description">${t.description||''} <span class="tx-type-badge tx-type-${t.type}">${t.type}</span></div><div class="tx-date">${formatDate(t.created_at)}</div></div><div class="tx-amount ${isPos?'positive':'negative'}">${isPos?'+':''}₹${Math.abs(t.amount).toFixed(2)}</div></div>`;
    });
    html += `</div>`;
  }

  // Withdrawals
  if (data.withdrawals && data.withdrawals.length > 0) {
    html += `<h3 style="margin:20px 0 12px;">💸 Withdrawals (${data.withdrawals.length})</h3><div class="transactions-list" style="max-height:300px;overflow-y:auto;">`;
    data.withdrawals.forEach(w => {
      html += `<div class="transaction-item"><div class="tx-info"><div class="tx-description">₹${w.amount.toFixed(2)} via ${w.method.toUpperCase()} <span class="tx-type-badge tx-type-${w.status==='approved'?'mining':w.status==='rejected'?'purchase':'bonus'}">${w.status}</span></div><div class="tx-date">${formatDate(w.created_at)}</div></div></div>`;
    });
    html += `</div>`;
  }

  resultEl.innerHTML = html;
}

async function pChangePassword() {
  const current_password = document.getElementById('pp_curr').value;
  const new_password = document.getElementById('pp_new').value;
  const conf = document.getElementById('pp_conf').value;
  if (new_password !== conf) { showToast('Passwords mismatch', 'error'); return; }
  const res = await fetch('/api/partner/password/change', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password, new_password }) });
  const data = await res.json();
  showToast(data.success ? 'Password updated' : data.error, data.success ? 'success' : 'error');
}

async function pLoadContacts() {
  try {
    const res = await fetch('/api/partner/contacts');
    const data = await res.json();
    const list = document.getElementById('pContactsList');
    if (!list) return;

    list.innerHTML = data.messages.length === 0
      ? '<div style="padding:40px;text-align:center;color:var(--text-muted);">No messages found</div>'
      : `
        <div class="user-list-container">
          ${data.messages.map(m => `
            <div class="user-card">
              <div class="user-header">
                <div style="font-size:1.5rem;">💬</div>
                <div>
                  <div class="user-name">${m.subject || 'No Subject'}</div>
                  <div class="user-email">${m.name} (${m.email})</div>
                </div>
                <div style="margin-left:auto; text-align:right;">
                  <span class="status-pill status-${m.status === 'read' ? 'approved' : 'pending'}">${(m.status || 'NEW').toUpperCase()}</span>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${formatDate(m.created_at)}</div>
                </div>
              </div>
              <div style="background:rgba(0,0,0,0.2); padding:16px; border-radius:8px; color:var(--text-secondary); line-height:1.6; margin-top:10px;">
                ${m.message}
              </div>
            </div>
          `).join('')}
        </div>
      `;
  } catch (err) { console.error('Contacts load error:', err); }
}

// Support chat logic (same as admin but using pOpenHistory if needed)
function pOpenHistory(u) {
  document.querySelector('[data-tab="settings"]').click();
  openPSubTab('history');
  document.getElementById('ph_lookup').value = u;
  phLookup();
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/partner/check').then(r => r.json()).then(d => {
    if (d.authenticated) {
      document.getElementById('partnerLogin').style.display = 'none';
      document.getElementById('partnerPanel').style.display = 'block';
      loadPartner();
    }
  });
});

// Re-use support functions from original js if needed, but here simplified for brevity
// ... (rest of support logic)
