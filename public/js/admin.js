// Safe Number Formatting helper
function fNum(val, decimals = 2) {
  const num = Number(val);
  return isNaN(num) ? (0).toFixed(decimals) : num.toFixed(decimals);
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Check admin auth
async function checkAdmin() {
  try {
    const res = await fetch('/api/admin/check');
    const data = await res.json();
    return data.authenticated;
  } catch { return false; }
}

// Login
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('adminLoginErr');
  err.style.display = 'none';

  const username = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      showDashboard();
    } else {
      err.textContent = data.error;
      err.style.display = 'block';
    }
  } catch {
    err.textContent = 'Connection error';
    err.style.display = 'block';
  }
});

function showDashboard() {
  document.getElementById('adminLogin').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'block';
  loadOverview();
}

// Tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
    const panelId = 'panel-' + tab.dataset.tab;
    const p = document.getElementById(panelId);
    if(p) p.style.display = 'block';

    const loaders = { 
      overview: loadOverview, 
      users: loadUsers, 
      withdrawals: loadWithdrawals, 
      payments: loadPayments, 
      'game-history': loadGameHistory,
      messages: loadAdminMessages, 
      settings: () => closeSubTabs() // Reset settings view
    };
    if (loaders[tab.dataset.tab]) loaders[tab.dataset.tab]();
  });
});

// Settings Sub-tabs
function openSubTab(name) {
  document.getElementById('settings-grid-view').style.display = 'none';
  document.getElementById('settings-subpanels').style.display = 'block';
  document.querySelectorAll('.sub-panel').forEach(p => p.style.display = 'none');
  const target = document.getElementById('sub-' + name);
  if(target) {
    target.style.display = 'block';
    const loaders = { 
      machines: loadMachines, 
      paysettings: () => { loadPaySettings(); try { loadGatewaysTokens(); } catch {} }, 
      spin: loadSpinSettings, 
      partners: loadPartners, 
      security: () => {}, 
      reports: () => {}, 
      history: () => {} 
    };
    if (loaders[name]) loaders[name]();
  }
}

function closeSubTabs() {
  document.getElementById('settings-subpanels').style.display = 'none';
  document.getElementById('settings-grid-view').style.display = 'grid';
}

async function changeAdminPassword() {
  const current_password = document.getElementById('ap_current').value;
  const new_password = document.getElementById('ap_new').value;
  const confirm = document.getElementById('ap_confirm').value;
  const msg = document.getElementById('ap_msg');
  msg.style.display = 'none';

  if (!current_password || !new_password) {
    msg.className = 'error-msg';
    msg.textContent = 'Current and new password are required';
    msg.style.display = 'block';
    return;
  }
  if (new_password.length < 6) {
    msg.className = 'error-msg';
    msg.textContent = 'New password must be at least 6 characters';
    msg.style.display = 'block';
    return;
  }
  if (new_password !== confirm) {
    msg.className = 'error-msg';
    msg.textContent = 'Passwords do not match';
    msg.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/admin/password/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password })
    });
    const data = await res.json();
    if (data.success) {
      msg.className = 'success-msg';
      msg.textContent = data.message || 'Password updated';
      msg.style.display = 'block';
      showToast('Admin password updated', 'success');
      document.getElementById('ap_current').value = '';
      document.getElementById('ap_new').value = '';
      document.getElementById('ap_confirm').value = '';
    } else {
      msg.className = 'error-msg';
      msg.textContent = data.error || 'Failed';
      msg.style.display = 'block';
      showToast(msg.textContent, 'error');
    }
  } catch {
    msg.className = 'error-msg';
    msg.textContent = 'Failed to update password';
    msg.style.display = 'block';
    showToast(msg.textContent, 'error');
  }
}

async function resetFinanceData() {
  const msg = document.getElementById('resetFinanceMsg');
  if (msg) msg.style.display = 'none';
  const typed = prompt("Type RESET to delete ALL users and ALL financial data:", '');
  if (typed !== 'RESET') return;
  if (!confirm('This will permanently delete ALL USERS and ALL related data. Continue?')) return;

  try {
    const res = await fetch('/api/admin/reset/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET' })
    });
    const data = await res.json();
    if (data.success) {
      if (msg) {
        msg.className = 'success-msg';
        msg.textContent = data.message || 'Cleared';
        msg.style.display = 'block';
      }
      showToast('All users & data cleared', 'success');
      try { loadOverview(); } catch {}
      try { loadPayments(); } catch {}
      try { loadWithdrawals(); } catch {}
      try { loadUsers(); } catch {}
    } else {
      if (msg) {
        msg.className = 'error-msg';
        msg.textContent = data.error || 'Failed';
        msg.style.display = 'block';
      }
      showToast(data.error || 'Failed', 'error');
    }
  } catch {
    if (msg) {
      msg.className = 'error-msg';
      msg.textContent = 'Failed to reset';
      msg.style.display = 'block';
    }
    showToast('Failed to reset', 'error');
  }
}

async function resetAllData() {
  const msg = document.getElementById('resetAllMsg');
  if (msg) msg.style.display = 'none';
  const typed = prompt("Type RESET to delete ALL users and data:", '');
  if (typed !== 'RESET') return;
  if (!confirm('This will permanently delete ALL USERS and ALL related data. Continue?')) return;

  try {
    const res = await fetch('/api/admin/reset/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET' })
    });
    const data = await res.json();
    if (data.success) {
      if (msg) {
        msg.className = 'success-msg';
        msg.textContent = data.message || 'All data cleared';
        msg.style.display = 'block';
      }
      showToast('All users & data cleared', 'success');
      try { loadOverview(); } catch {}
      try { loadUsers(); } catch {}
      try { loadPayments(); } catch {}
      try { loadWithdrawals(); } catch {}
    } else {
      if (msg) {
        msg.className = 'error-msg';
        msg.textContent = data.error || 'Failed';
        msg.style.display = 'block';
      }
      showToast(data.error || 'Failed', 'error');
    }
  } catch {
    if (msg) {
      msg.className = 'error-msg';
      msg.textContent = 'Failed to reset';
      msg.style.display = 'block';
    }
    showToast('Failed to reset', 'error');
  }
}

// User Filter State
let userPage = 1;
let userLimit = 20;
let userDebounceTimer;

function debounceLoadUsers() {
  clearTimeout(userDebounceTimer);
  userDebounceTimer = setTimeout(() => { userPage = 1; loadUsers(); }, 500);
}

function changeUserPage(dir) {
  userPage += dir;
  if(userPage < 1) userPage = 1;
  loadUsers();
}

// Create User Modal
function showCreateUserModal() {
  document.getElementById('modal-createuser').style.display = 'block';
}
function closeCreateUserModal() {
  document.getElementById('modal-createuser').style.display = 'none';
}
// Handle clicking outside of modal to close
window.addEventListener('click', (event) => {
  const modal = document.getElementById('modal-createuser');
  if (event.target == modal) modal.style.display = "none";
});

// Overview
async function loadOverview() {
  try {
    const res = await fetch('/api/admin/dashboard?t=' + Date.now());
    const d = await res.json();
    document.getElementById('adminStats').innerHTML = `
      <div class="stat-card balance-card"><div class="stat-icon">👥</div><div class="stat-info"><div class="stat-label">Total Users</div><div class="stat-value">${d.totalUsers}</div></div></div>
      <div class="stat-card earning-card"><div class="stat-icon">💰</div><div class="stat-info"><div class="stat-label">Total Balance</div><div class="stat-value">₹${fNum(d.totalBalance)}</div></div></div>
      <div class="stat-card uncollected-card"><div class="stat-icon">⚙️</div><div class="stat-info"><div class="stat-label">Total Machines</div><div class="stat-value">${d.totalMachines}</div></div></div>
      <div class="stat-card machines-card"><div class="stat-icon">💸</div><div class="stat-info"><div class="stat-label">Total Withdrawn</div><div class="stat-value">₹${fNum(d.totalWithdrawals)}</div></div></div>
      <div class="stat-card balance-card"><div class="stat-icon">⏳</div><div class="stat-info"><div class="stat-label">Pending Withdrawals</div><div class="stat-value">${d.pendingWithdrawals}</div></div></div>
      <div class="stat-card earning-card"><div class="stat-icon">💳</div><div class="stat-info"><div class="stat-label">Pending Payments</div><div class="stat-value">${d.pendingPayments}</div></div></div>
      <div class="stat-card uncollected-card"><div class="stat-icon">📥</div><div class="stat-info"><div class="stat-label">Total Deposits</div><div class="stat-value">₹${fNum(d.totalDeposits)}</div></div></div>
      <div class="stat-card machines-card"><div class="stat-icon">📨</div><div class="stat-info"><div class="stat-label">Unread Messages</div><div class="stat-value">${d.unreadMessages}</div></div></div>
    `;
  } catch (err) { console.error('Overview error:', err); }
}

// Machines
async function loadMachines() {
  try {
    const res = await fetch('/api/admin/machines');
    const data = await res.json();
    document.getElementById('adminMachines').innerHTML = data.machines.map(m => `
      <div class="admin-item-card">
        <div class="admin-item-header">${m.icon} ${m.name} (ID: ${m.id})</div>
        <div class="form-grid">
          <div class="form-group"><label>Name</label><input type="text" id="m_name_${m.id}" value="${m.name}"></div>
          <div class="form-group"><label>Price</label><input type="number" id="m_price_${m.id}" value="${m.price}"></div>
          <div class="form-group"><label>Earning/hr</label><input type="number" id="m_earn_${m.id}" value="${m.earning_per_hour}"></div>
          <div class="form-group"><label>Icon</label><input type="text" id="m_icon_${m.id}" value="${m.icon}"></div>
          <div class="form-group" style="grid-column:1/-1;"><label>Description</label><input type="text" id="m_desc_${m.id}" value="${m.description || ''}"></div>
        </div>
        <button class="btn btn-primary" onclick="updateMachine(${m.id})">💾 Save Changes</button>
      </div>
    `).join('');
  } catch (err) { console.error('Machines error:', err); }
}

async function updateMachine(id) {
  try {
    const body = {
      id,
      name: document.getElementById(`m_name_${id}`).value,
      price: parseFloat(document.getElementById(`m_price_${id}`).value),
      earning_per_hour: parseFloat(document.getElementById(`m_earn_${id}`).value),
      icon: document.getElementById(`m_icon_${id}`).value,
      description: document.getElementById(`m_desc_${id}`).value
    };
    const res = await fetch('/api/admin/machines/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    showToast(data.success ? 'Machine updated!' : data.error, data.success ? 'success' : 'error');
  } catch { showToast('Update failed', 'error'); }
}

// Create User
document.getElementById('createUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('createUserMsg');
  msg.style.display = 'none';

  const body = {
    username: document.getElementById('cu_username').value.trim(),
    email: document.getElementById('cu_email').value.trim(),
    password: document.getElementById('cu_password').value,
    balance: parseFloat(document.getElementById('cu_balance').value) || 0,
    free_spins: parseInt(document.getElementById('cu_spins').value) || 1
  };

  try {
    const res = await fetch('/api/admin/users/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.success) {
      msg.className = 'success-msg';
      msg.textContent = data.message;
      msg.style.display = 'block';
      showToast(data.message, 'success');
      document.getElementById('createUserForm').reset();
      document.getElementById('cu_balance').value = '0';
      document.getElementById('cu_spins').value = '1';
      loadUsers();
    } else {
      msg.className = 'error-msg';
      msg.textContent = data.error;
      msg.style.display = 'block';
    }
  } catch {
    msg.className = 'error-msg';
    msg.textContent = 'Failed to create user';
    msg.style.display = 'block';
  }
});

// Users
async function loadUsers() {
  try {
    const search = document.getElementById('u_search').value.trim();
    const sort = document.getElementById('u_sort').value;
    const order = document.getElementById('u_order').value;
    
    // Add timestamp to prevent caching
    const url = `/api/admin/users?page=${userPage}&limit=${userLimit}&search=${encodeURIComponent(search)}&sortBy=${sort}&sortOrder=${order}&t=${Date.now()}`;
    
    const res = await fetch(url);
    const data = await res.json();
    
    // Update pagination display
    document.getElementById('userPageNum').textContent = `Page ${data.page} of ${data.totalPages || 1}`;
    
    document.getElementById('adminUsers').innerHTML = `
      <div class="user-list-container">
        ${data.users.length === 0 ? '<div style="padding:40px;text-align:center;color:var(--text-muted);">No users found matching criteria</div>' : ''}
        ${data.users.map(u => `
          <div class="user-card">
            <!-- Header -->
            <div class="user-header">
              <div style="font-size:1.5rem;">👤</div>
              <div>
                <div class="user-name">${u.username}</div>
                <div class="user-email">${u.email}</div>
              </div>
              <div style="margin-left:auto; text-align:right;">
                <div style="font-size:0.8rem; color:var(--text-muted);">Joined</div>
                <div style="font-weight:500;">${formatDate(u.created_at)}</div>
              </div>
            </div>

            <!-- Stats Grid -->
            <div class="user-stats-grid">
              <div class="stat-item">
                <span class="stat-label">Wallet Balance</span>
                <span class="stat-value" style="color:#10b981;">💰 ₹${fNum(u.balance)}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Active Machines</span>
                <span class="stat-value">⚙️ ${u.machine_count}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Free Spins</span>
                <span class="stat-value">🎰 ${u.free_spins || 0}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Referrals</span>
                <span class="stat-value">👥 ${u.referral_count || 0}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Total Deposited</span>
                <span class="stat-value">📥 ₹${fNum(u.total_deposited)}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Total Won</span>
                <span class="stat-value">🏆 ₹${fNum(u.total_won)}</span>
              </div>
            </div>

            <!-- Permissions & Status -->
            <div class="control-section">
              <div class="control-header">Account Status & Permissions</div>
              <div class="control-group">
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:0.8rem; color:var(--text-muted);">Block Withdrawals</label>
                  <select id="uc_block_${u.id}" class="input-admin" style="width:100px;">
                    <option value="0" ${u.withdraw_blocked ? '' : 'selected'}>No</option>
                    <option value="1" ${u.withdraw_blocked ? 'selected' : ''}>Yes</option>
                  </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:0.8rem; color:var(--text-muted);">Freeze Account</label>
                  <select id="uc_frozen_${u.id}" class="input-admin" style="width:100px;">
                    <option value="0" ${u.frozen ? '' : 'selected'}>No</option>
                    <option value="1" ${u.frozen ? 'selected' : ''}>Yes</option>
                  </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:0.8rem; color:var(--text-muted);">Limit Amount (₹)</label>
                  <input type="number" id="uc_limit_${u.id}" class="input-admin" placeholder="No limit" style="width:120px;" value="${u.withdraw_limit || ''}">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:0.8rem; color:var(--text-muted);">Limit Until</label>
                  <input type="text" id="uc_until_${u.id}" class="input-admin" placeholder="YYYY-MM-DD" style="width:140px;" value="${u.withdraw_limit_until || ''}">
                </div>
                <button class="btn-admin btn-emerald" style="margin-top:auto;" onclick="saveUserControls(${u.id})">Save Status</button>
              </div>
            </div>

            <!-- Actions & Edit -->
            <div class="control-section" style="background:rgba(255,255,255,0.02);">
              <div class="control-header">Actions & Adjustments</div>
              <div class="control-group" style="align-items:end;">
                <div style="flex:1; min-width:200px;">
                  <label style="font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:4px;">Adjust Balance</label>
                  <input type="number" id="ue_bal_${u.id}" class="input-admin" value="${u.balance}" step="1">
                </div>
                <div style="width:100px;">
                  <label style="font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:4px;">Spins</label>
                  <input type="number" id="ue_spins_${u.id}" class="input-admin" value="${u.free_spins || 0}">
                </div>
                <button class="btn-admin btn-indigo" onclick="editUser(${u.id})">Update</button>
                
                <div style="width:1px; height:30px; background:var(--border); margin:0 8px;"></div>
                
                <button class="btn-admin btn-indigo" style="background:#4f46e5;" onclick="addBooster(${u.id})">⚡ Booster</button>
                <button class="btn-admin btn-indigo" style="background:#8b5cf6;" onclick="impersonate(${u.id})">🔑 Login</button>
                <button class="btn-admin btn-coral" style="background:#ef4444;" onclick="clearUserMachines(${u.id}, '${u.username.replace(/'/g, "\\'")}')">🧹 Remove Machines</button>
                <button class="btn-admin btn-coral" onclick="deleteUser(${u.id}, '${u.username.replace(/'/g, "\\'")}')">🗑️ Delete</button>
              </div>
              
              <!-- Password Reset -->
              <div style="margin-top:12px; display:flex; gap:8px;">
                <input type="text" id="ue_pass_${u.id}" class="input-admin" value="${u.plain_password || ''}" placeholder="Reset Password" style="flex:1;">
                <button class="btn-admin btn-indigo" style="width:auto;" onclick="resetPassword(${u.id})">Set Password</button>
              </div>
              
              <!-- Active Boosters -->
              <div id="booster_list_${u.id}" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;"></div>
            </div>

          </div>
        `).join('')}
      </div>
    `;
    // Load boosters for each (could be optimized, but ok for pagination of 20)
    for (const u of data.users) { try { await loadUserBoosters(u.id); } catch {} }
  } catch (err) { console.error('Users error:', err); }
}

async function clearUserMachines(userId, username) {
  if (!confirm(`Remove ALL machines from "${username}"?`)) return;
  try {
    const res = await fetch('/api/admin/users/machines/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Machines removed', 'success');
      loadUsers();
    } else {
      showToast(data.error || 'Failed', 'error');
    }
  } catch {
    showToast('Failed to remove machines', 'error');
  }
}

async function saveUserControls(id) {
  try {
    const body = {
      user_id: id,
      withdraw_blocked: document.getElementById(`uc_block_${id}`).value === '1',
      withdraw_limit: document.getElementById(`uc_limit_${id}`).value ? parseFloat(document.getElementById(`uc_limit_${id}`).value) : null,
      withdraw_limit_until: document.getElementById(`uc_until_${id}`).value || null,
      frozen: document.getElementById(`uc_frozen_${id}`).value === '1'
    };
    const res = await fetch('/api/admin/users/controls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    showToast(data.success ? 'Controls saved!' : data.error, data.success ? 'success' : 'error');
  } catch { showToast('Save failed', 'error'); }
}

async function addBooster(userId) {
  const type = prompt("Booster type ('speed' = +earning%, 'discount' = price off):", 'speed');
  if (!type) return;
  const pct = parseFloat(prompt('Value (%) e.g., 20 for 20%:', '20') || '0');
  if (!pct || pct <= 0) return;
  const days = parseInt(prompt('Duration (days). Leave blank for no expiry:', '') || '0') || null;
  try {
    const res = await fetch('/api/admin/users/boosters/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, type, value: pct / 100, days })
    });
    const data = await res.json();
    if (data.success) { showToast('Booster added!', 'success'); loadUserBoosters(userId); } else { showToast(data.error, 'error'); }
  } catch { showToast('Add failed', 'error'); }
}

async function loadUserBoosters(userId) {
  const res = await fetch(`/api/admin/users/boosters?user_id=${userId}`);
  const data = await res.json();
  const list = document.getElementById(`booster_list_${userId}`);
  if (!list) return;
  list.innerHTML = data.boosters.length === 0
    ? '<div class="no-transactions">No boosters</div>'
    : data.boosters.map(b => {
        const expires = b.expires_at ? new Date(b.expires_at + 'Z').toLocaleDateString('en-IN') : 'No expiry';
        const val = Math.round((b.value || 0) * 100);
        return `<div class="transaction-item"><div class="tx-info"><div class="tx-description">${b.type} +${val}%</div><div class="tx-date">${expires}</div></div><div><button class="btn btn-primary" style="padding:4px 10px;" onclick="removeBooster(${b.id}, ${userId})">✖</button></div></div>`;
      }).join('');
}

async function removeBooster(id, userId) {
  try {
    const res = await fetch('/api/admin/users/boosters/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if (data.success) { loadUserBoosters(userId); showToast('Removed', 'success'); } else { showToast(data.error, 'error'); }
  } catch { showToast('Remove failed', 'error'); }
}

async function resetPassword(id) {
  const newPass = document.getElementById(`ue_pass_${id}`).value.trim();
  if (!newPass || newPass.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }
  try {
    const res = await fetch('/api/admin/users/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id, new_password: newPass })
    });
    const data = await res.json();
    showToast(data.success ? `Password updated!` : data.error, data.success ? 'success' : 'error');
  } catch { showToast('Update failed', 'error'); }
}

async function editUser(id) {
  try {
    const body = {
      user_id: id,
      balance: parseFloat(document.getElementById(`ue_bal_${id}`).value),
      free_spins: parseInt(document.getElementById(`ue_spins_${id}`).value)
    };
    const res = await fetch('/api/admin/users/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    showToast(data.success ? 'User updated!' : data.error, data.success ? 'success' : 'error');
    if (data.success) loadUsers();
  } catch { showToast('Update failed', 'error'); }
}

// Withdrawals
async function loadWithdrawals() {
  try {
    const res = await fetch('/api/admin/withdrawals?t=' + Date.now());
    const data = await res.json();
    document.getElementById('adminWithdrawals').innerHTML = data.withdrawals.length === 0
      ? '<div style="padding:40px;text-align:center;color:var(--text-muted);">No withdrawal requests found</div>'
      : `
        <div class="user-list-container">
          ${data.withdrawals.map(w => `
            <div class="user-card">
              <div class="user-header">
                <div style="font-size:1.5rem;">💸</div>
                <div>
                  <div class="user-name">₹${fNum(w.amount)} <span style="font-weight:400;color:var(--text-secondary);">via ${w.method.toUpperCase()}</span></div>
                  <div class="user-email">${w.username} (${w.email})</div>
                </div>
                <div style="margin-left:auto; text-align:right;">
                  <span class="status-pill status-${w.status}">${w.status.toUpperCase()}</span>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${formatDate(w.created_at)}</div>
                </div>
              </div>

              <div class="user-stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                <div class="stat-item">
                  <span class="stat-label">Bank Name</span>
                  <span class="stat-value">${w.bank_name || '-'}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Account Number</span>
                  <span class="stat-value">${w.bank_account_number || '-'}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">IFSC Code</span>
                  <span class="stat-value">${w.bank_ifsc || '-'}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">UPI ID</span>
                  <span class="stat-value">${w.upi_id || '-'}</span>
                </div>
              </div>

              ${w.status === 'pending' ? `
                <div class="control-section" style="background:rgba(255,255,255,0.02); display:flex; gap:12px; justify-content:flex-end;">
                  <button class="btn-admin btn-emerald" onclick="updateWithdrawal(${w.id}, 'approved')">✅ Approve Request</button>
                  <button class="btn-admin btn-coral" onclick="updateWithdrawal(${w.id}, 'rejected')">❌ Reject Request</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
  } catch (err) { console.error('Withdrawals error:', err); }
}

async function updateWithdrawal(id, status) {
  try {
    const res = await fetch('/api/admin/withdrawals/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    const data = await res.json();
    showToast(data.success ? data.message : data.error, data.success ? 'success' : 'error');
    loadWithdrawals();
  } catch { showToast('Failed', 'error'); }
}

// Payments
async function loadPayments() {
  try {
    const res = await fetch('/api/admin/payments?t=' + Date.now());
    const data = await res.json();
    document.getElementById('adminPayments').innerHTML = data.payments.length === 0
      ? '<div style="padding:40px;text-align:center;color:var(--text-muted);">No payment records found</div>'
      : `
        <div class="user-list-container">
          ${data.payments.map(p => `
            <div class="user-card">
              <div class="user-header">
                <div style="font-size:1.5rem;">💳</div>
                <div>
                  <div class="user-name">₹${fNum(p.amount)} <span style="font-weight:400;color:var(--text-secondary);">via ${p.method.toUpperCase()}</span></div>
                  <div class="user-email">${p.username} (${p.email})</div>
                </div>
                <div style="margin-left:auto; text-align:right;">
                  <span class="status-pill status-${p.status}">${p.status.toUpperCase()}</span>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${formatDate(p.created_at)}</div>
                </div>
              </div>

              <div class="user-stats-grid">
                <div class="stat-item">
                  <span class="stat-label">Transaction Ref</span>
                  <span class="stat-value">${p.transaction_ref || 'N/A'}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Gateway</span>
                  <span class="stat-value">${p.gateway_id || 'Standard'}</span>
                </div>
              </div>

              ${p.status === 'pending' ? `
                <div class="control-section" style="background:rgba(255,255,255,0.02); display:flex; gap:12px; justify-content:flex-end;">
                  <button class="btn-admin btn-emerald" onclick="updatePayment(${p.id}, 'approved')">✅ Approve Deposit</button>
                  <button class="btn-admin btn-coral" onclick="updatePayment(${p.id}, 'rejected')">❌ Reject Deposit</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
  } catch (err) { console.error('Payments error:', err); }
}

async function updatePayment(id, status) {
  try {
    const res = await fetch('/api/admin/payments/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    const data = await res.json();
    showToast(data.success ? data.message : data.error, data.success ? 'success' : 'error');
    loadPayments();
  } catch { showToast('Failed', 'error'); }
}

// Messages
async function loadAdminMessages() {
  setBroadcastExpiryDefaultIfEmpty();
  // Broadcasts
  try {
    const res = await fetch('/api/admin/notify/list?t=' + Date.now());
    const data = await res.json();
    const list = document.getElementById('broadcastList');
    if (list) {
      list.innerHTML = data.notifications.length === 0
        ? '<div style="padding:20px;text-align:center;color:var(--text-muted);">No broadcasts sent</div>'
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
    }
  } catch (err) { console.error('Broadcast list error:', err); }

  // Contact Messages
  try {
    const res = await fetch('/api/admin/contacts?t=' + Date.now());
    const data = await res.json();
    document.getElementById('adminMessages').innerHTML = data.messages.length === 0
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
                  <span class="status-pill status-${m.status === 'read' ? 'approved' : 'pending'}">${m.status.toUpperCase()}</span>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${formatDate(m.created_at)}</div>
                </div>
              </div>
              <div style="background:rgba(0,0,0,0.2); padding:16px; border-radius:8px; color:var(--text-secondary); line-height:1.6;">
                ${m.message}
              </div>
            </div>
          `).join('')}
        </div>
      `;
  } catch (err) { console.error('Messages error:', err); }
}

// Broadcast helpers
let selectedBroadcastUsers = [];

function toSqlDateTime(val) {
  const v = String(val || '').trim();
  if (!v) return null;
  if (v.includes('T')) {
    const [d, t] = v.split('T');
    if (!d || !t) return null;
    return `${d} ${t}:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(v)) return v + ':00';
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(v)) return v;
  return v;
}

function setBroadcastExpiryDefaultIfEmpty() {
  const el = document.getElementById('bc_expires');
  if (!el || String(el.value || '').trim()) return;
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const pad = (n) => String(n).padStart(2, '0');
  const v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  el.value = v;
}

function toggleBroadcastTarget() {
  const t = document.getElementById('bc_target').value;
  document.getElementById('bc_users_wrap').style.display = t === 'usernames' ? 'block' : 'none';
}

let searchUserTimer;
async function searchUsersForBroadcast(q) {
  clearTimeout(searchUserTimer);
  const resContainer = document.getElementById('bc_search_results');
  
  if (!q || q.length < 2) {
    resContainer.style.display = 'none';
    return;
  }
  
  searchUserTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      
      if (data.users && data.users.length > 0) {
        resContainer.innerHTML = data.users.map(u => `
          <div class="search-chip" style="background:var(--bg-secondary); border:1px solid var(--border); color:var(--text-primary); cursor:pointer;" onclick="addBroadcastUser('${u.username}')">
            <span>+ ${u.username}</span>
          </div>
        `).join('');
        resContainer.style.display = 'flex';
      } else {
        resContainer.style.display = 'none';
      }
    } catch {}
  }, 300);
}

function addBroadcastUser(username) {
  if (selectedBroadcastUsers.includes(username)) return;
  selectedBroadcastUsers.push(username);
  renderSelectedBroadcastUsers();
  document.getElementById('bc_user_search').value = '';
  document.getElementById('bc_search_results').style.display = 'none';
}

function removeBroadcastUser(username) {
  selectedBroadcastUsers = selectedBroadcastUsers.filter(u => u !== username);
  renderSelectedBroadcastUsers();
}

function renderSelectedBroadcastUsers() {
  const container = document.getElementById('bc_selected_users');
  container.innerHTML = selectedBroadcastUsers.map(u => `
    <div class="search-chip">
      <span>${u}</span>
      <span onclick="removeBroadcastUser('${u}')" style="cursor:pointer;margin-left:4px;">&times;</span>
    </div>
  `).join('');
  document.getElementById('bc_usernames').value = selectedBroadcastUsers.join(',');
}

async function sendBroadcast() {
  const title = document.getElementById('bc_title').value.trim();
  const message = document.getElementById('bc_message').value.trim();
  const type = document.getElementById('bc_type').value;
  const target = document.getElementById('bc_target').value;
  setBroadcastExpiryDefaultIfEmpty();
  const expires_at = document.getElementById('bc_expires') ? toSqlDateTime(document.getElementById('bc_expires').value) : null;
  const require_ack = document.getElementById('bc_require') ? document.getElementById('bc_require').value === '1' : false;
  const msgEl = document.getElementById('bc_msg');
  msgEl.style.display = 'none';

  if (!title || !message) { 
    msgEl.className = 'error-msg'; 
    msgEl.textContent = 'Title and message required'; 
    msgEl.style.display = 'block'; 
    return; 
  }

  let body = { title, message, type, target: target === 'all' ? 'all' : 'targeted', expires_at: expires_at || null, require_ack };
  
  if (target === 'usernames') {
    const usernames = document.getElementById('bc_usernames').value.trim().split(',').map(s => s.trim()).filter(Boolean);
    if (usernames.length === 0) {
       msgEl.className = 'error-msg';
       msgEl.textContent = 'Please select at least one user';
       msgEl.style.display = 'block';
       return;
    }
    body.usernames = usernames;
  }

  try {
    const res = await fetch('/api/admin/notify/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    msgEl.className = data.success ? 'success-msg' : 'error-msg';
    msgEl.textContent = data.success ? `Message sent to ${target === 'all' ? 'ALL' : data.targets + ' users'}!` : (data.error || 'Failed');
    msgEl.style.display = 'block';
    
    if (data.success) {
       document.getElementById('bc_title').value = '';
       document.getElementById('bc_message').value = '';
       selectedBroadcastUsers = [];
       renderSelectedBroadcastUsers();
       document.getElementById('bc_expires').value = '';
       setBroadcastExpiryDefaultIfEmpty();
       loadAdminMessages();
    }
  } catch { msgEl.className = 'error-msg'; msgEl.textContent = 'Failed to send'; msgEl.style.display = 'block'; }
}

// Spin settings
async function loadSpinSettings() {
  try {
    const res = await fetch('/api/admin/spin/config');
    const data = await res.json();
    document.getElementById('spin_cost').value = data.spin_cost || 200;
    // Load difficulties from settings
    try {
      const sres = await fetch('/api/admin/settings');
      const sdata = await sres.json();
      const s = sdata.settings || {};
      
      const spinDiff = s.spin_difficulty || 0;
      const gamesDiff = s.all_games_difficulty || s.game_lucky_difficulty || 0;
      
      if (document.getElementById('spin_diff')) { 
        document.getElementById('spin_diff').value = spinDiff; 
        document.getElementById('spin_diff_num').textContent = spinDiff; 
      }
      if (document.getElementById('all_games_diff')) { 
        document.getElementById('all_games_diff').value = gamesDiff; 
        document.getElementById('all_games_diff_num').textContent = gamesDiff; 
      }
      if (document.getElementById('spin_reward_mul')) document.getElementById('spin_reward_mul').value = s.spin_reward_multiplier || 1;
      
      // Update range labels on input
      document.getElementById('spin_diff').oninput = function() { document.getElementById('spin_diff_num').textContent = this.value; };
      document.getElementById('all_games_diff').oninput = function() { document.getElementById('all_games_diff_num').textContent = this.value; };
      
    } catch {}
    const wrap = document.getElementById('spinPrizes');
    wrap.innerHTML = data.prizes.map(p => `
      <div class="admin-item-card">
        <div class="form-grid">
          <div class="form-group"><label>Label</label><input type="text" id="sp_label_${p.id}" value="${p.label}"></div>
          <div class="form-group"><label>Type</label>
            <select id="sp_type_${p.id}">
              <option value="balance" ${p.type==='balance'?'selected':''}>balance</option>
              <option value="machine" ${p.type==='machine'?'selected':''}>machine</option>
              <option value="lose" ${p.type==='lose'?'selected':''}>lose</option>
            </select>
          </div>
          <div class="form-group"><label>Amount</label><input type="number" id="sp_amount_${p.id}" value="${p.amount || ''}"></div>
          <div class="form-group"><label>Machine ID</label><input type="number" id="sp_machine_${p.id}" value="${p.machine_id || ''}"></div>
          <div class="form-group"><label>Weight</label><input type="number" step="0.1" id="sp_weight_${p.id}" value="${p.weight}"></div>
          <div class="form-group"><label>Enabled</label><select id="sp_enabled_${p.id}"><option value="1" ${p.enabled? 'selected':''}>Yes</option><option value="0" ${!p.enabled?'selected':''}>No</option></select></div>
        </div>
        <button class="btn btn-primary" onclick="saveSpinPrize(${p.id})">💾 Save</button>
      </div>
    `).join('');
  } catch (err) { console.error('Spin load error:', err); }
}

async function saveSpinPrize(id) {
  try {
    const body = {
      id,
      label: document.getElementById(`sp_label_${id}`).value,
      type: document.getElementById(`sp_type_${id}`).value,
      amount: parseFloat(document.getElementById(`sp_amount_${id}`).value) || null,
      machine_id: parseInt(document.getElementById(`sp_machine_${id}`).value) || null,
      weight: parseFloat(document.getElementById(`sp_weight_${id}`).value) || 0,
      enabled: document.getElementById(`sp_enabled_${id}`).value === '1'
    };
    const res = await fetch('/api/admin/spin/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    showToast(data.success ? 'Prize updated!' : data.error, data.success ? 'success' : 'error');
  } catch { showToast('Update failed', 'error'); }
}

async function loadGameHistory() {
  const container = document.getElementById('adminGameHistory');
  if (!container) return;
  
  container.innerHTML = '<div style="padding:20px;text-align:center;">Loading history...</div>';
  
  try {
    const res = await fetch('/api/admin/games/history');
    const data = await res.json();
    
    if (data.success) {
      if (data.history.length === 0) {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">No game history recorded yet.</div>';
        return;
      }
      
      let html = `
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Game</th>
              <th>Bet</th>
              <th>Mult</th>
              <th>Payout</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      data.history.forEach(h => {
        const date = formatDate(h.created_at);
        const isWin = h.multiplier > 0;
        const payoutColor = isWin ? '#10b981' : '#ef4444';
        const gameIcon = h.game_type === 'plinko' ? '🔴' : (h.game_type === 'space_traveler' ? '🚀' : '🎮');
        
        html += `
          <tr>
            <td style="white-space:nowrap; font-size:0.8rem;">${date}</td>
            <td style="font-weight:700;">${h.username}</td>
            <td>${gameIcon} ${h.game_type.replace('_', ' ').toUpperCase()}</td>
            <td style="font-weight:700;">₹${fNum(h.bet_amount)}</td>
            <td><span class="status-pill" style="background:rgba(255,255,255,0.05); color:${isWin ? '#10b981' : '#94a3b8'};">${h.multiplier}x</span></td>
            <td style="color:${payoutColor}; font-weight:800;">₹${fNum(h.payout)}</td>
            <td style="font-size:0.75rem; color:var(--text-muted); max-width:150px; overflow:hidden; text-overflow:ellipsis;" title='${h.details}'>${h.details}</td>
          </tr>
        `;
      });
      
      html += `</tbody></table>`;
      container.innerHTML = html;
    } else {
      container.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444;">Error: ${data.error}</div>`;
    }
  } catch (err) {
    console.error('Game history load error:', err);
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">Failed to load game history.</div>';
  }
}

async function saveSpinSettingsSimplified() {
  try {
    const cost = parseInt(document.getElementById('spin_cost').value);
    const body = {
      spin_difficulty: document.getElementById('spin_diff').value,
      all_games_difficulty: document.getElementById('all_games_diff').value,
      game_lucky_difficulty: document.getElementById('all_games_diff').value, // Backward compatibility
      game_dice_difficulty: document.getElementById('all_games_diff').value,  // Backward compatibility
      spin_reward_multiplier: document.getElementById('spin_reward_mul').value
    };
    
    // Save cost
    await fetch('/api/admin/spin/cost', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ spin_cost: cost }) 
    });
    
    // Save settings
    const res = await fetch('/api/admin/settings/update', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
    });
    
    const data = await res.json();
    showToast(data.success ? 'All settings saved!' : data.error, data.success ? 'success' : 'error');
  } catch { showToast('Save failed', 'error'); }
}

async function saveSpinCost() {
  try {
    const cost = parseInt(document.getElementById('spin_cost').value);
    const res = await fetch('/api/admin/spin/cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spin_cost: cost }) });
    const data = await res.json();
    showToast(data.success ? 'Spin cost saved!' : data.error, data.success ? 'success' : 'error');
  } catch { showToast('Save failed', 'error'); }
}

async function saveSpinDifficulties() {
  const body = {
    spin_difficulty: document.getElementById('spin_diff').value,
    game_lucky_difficulty: document.getElementById('lucky_diff').value,
    game_dice_difficulty: document.getElementById('dice_diff').value,
    spin_reward_multiplier: document.getElementById('spin_reward_mul').value
  };
  try {
    const res = await fetch('/api/admin/settings/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    showToast(data.success ? 'Difficulties saved!' : data.error, data.success ? 'success' : 'error');
  } catch { showToast('Save failed', 'error'); }
}

async function addSpinPrize() {
  try {
    const label = prompt('Prize label:');
    if (!label) return;
    const type = prompt("Type ('balance' | 'machine' | 'lose'):", 'balance');
    if (!type) return;
    const weight = parseFloat(prompt('Weight (e.g., 1.0):', '1') || '1');
    const payload = { label, type, weight, enabled: true };
    if (type === 'balance') {
      payload.amount = parseFloat(prompt('Amount (₹):', '100') || '0');
    } else if (type === 'machine') {
      payload.machine_id = parseInt(prompt('Machine ID:', '2') || '0');
    }
    const res = await fetch('/api/admin/spin/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.success) { showToast('Prize added!', 'success'); loadSpinSettings(); } else { showToast(data.error, 'error'); }
  } catch { showToast('Add failed', 'error'); }
}

// Partners
async function loadPartners() {
  try {
    const res = await fetch('/api/admin/partners');
    const data = await res.json();
    const list = document.getElementById('partnersList');
    list.innerHTML = data.partners.length === 0 ? '<div class="no-transactions">No partners</div>' :
      data.partners.map(p => `
        <div class="admin-item-card">
          <div class="admin-item-header">${p.username} — ${p.active ? 'Active' : 'Inactive'}</div>
          <div class="form-grid">
            <div class="form-group"><label>Active</label><select id="e_active_${p.id}"><option value="1" ${p.active? 'selected':''}>Yes</option><option value="0" ${!p.active?'selected':''}>No</option></select></div>
            <div class="form-group"><label>Dashboard</label><select id="e_dash_${p.id}"><option value="0" ${!p.can_dashboard?'selected':''}>No</option><option value="1" ${p.can_dashboard?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Deposits</label><select id="e_dep_${p.id}"><option value="0" ${!p.can_deposits?'selected':''}>No</option><option value="1" ${p.can_deposits?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Withdrawals</label><select id="e_wd_${p.id}"><option value="0" ${!p.can_withdrawals?'selected':''}>No</option><option value="1" ${p.can_withdrawals?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Messages</label><select id="e_msg_${p.id}"><option value="0" ${!p.can_messages?'selected':''}>No</option><option value="1" ${p.can_messages?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Users</label><select id="e_users_${p.id}"><option value="0" ${!p.can_users?'selected':''}>No</option><option value="1" ${p.can_users?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Profiles</label><select id="e_prof_${p.id}"><option value="0" ${!p.can_profiles?'selected':''}>No</option><option value="1" ${p.can_profiles?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Settings</label><select id="e_set_${p.id}"><option value="0" ${!p.can_settings?'selected':''}>No</option><option value="1" ${p.can_settings?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Machines</label><select id="e_mac_${p.id}"><option value="0" ${!p.can_machines?'selected':''}>No</option><option value="1" ${p.can_machines?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Spin</label><select id="e_spin_${p.id}"><option value="0" ${!p.can_spin?'selected':''}>No</option><option value="1" ${p.can_spin?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Gateways</label><select id="e_gw_${p.id}"><option value="0" ${!p.can_gateways?'selected':''}>No</option><option value="1" ${p.can_gateways?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>History</label><select id="e_hist_${p.id}"><option value="0" ${!p.can_history?'selected':''}>No</option><option value="1" ${p.can_history?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Reports</label><select id="e_rep_${p.id}"><option value="0" ${!p.can_reports?'selected':''}>No</option><option value="1" ${p.can_reports?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Security</label><select id="e_sec_${p.id}"><option value="0" ${!p.can_security?'selected':''}>No</option><option value="1" ${p.can_security?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Controls</label><select id="e_ctrl_${p.id}"><option value="0" ${!p.can_controls?'selected':''}>No</option><option value="1" ${p.can_controls?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Passwords</label><select id="e_pass_${p.id}"><option value="0" ${!p.can_passwords?'selected':''}>No</option><option value="1" ${p.can_passwords?'selected':''}>Yes</option></select></div>
            <div class="form-group"><label>Deposit Limit</label><input type="number" id="e_dep_lim_${p.id}" value="${p.deposit_limit || ''}"></div>
            <div class="form-group"><label>Withdraw Limit</label><input type="number" id="e_wd_lim_${p.id}" value="${p.withdraw_limit || ''}"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="savePartner(${p.id})">💾 Save</button>
            <button class="btn btn-buy" onclick="resetPartnerPassword(${p.id})">🔑 Reset Password</button>
            <button class="btn btn-primary" style="background:linear-gradient(135deg,#e94560,#c83b50);" onclick="deletePartner(${p.id})">🗑️ Delete</button>
          </div>
        </div>
      `).join('');
  } catch (e) { console.error('Partners load error', e); }
}

async function createPartner() {
  const body = {
    username: document.getElementById('pr_username').value.trim(),
    password: document.getElementById('pr_password').value,
    active: document.getElementById('pr_active').value === '1',
    can_dashboard: document.getElementById('pr_dash').value === '1',
    can_deposits: document.getElementById('pr_dep').value === '1',
    can_withdrawals: document.getElementById('pr_wd').value === '1',
    can_messages: document.getElementById('pr_msg').value === '1',
    can_users: document.getElementById('pr_users').value === '1',
    can_profiles: document.getElementById('pr_prof').value === '1',
    can_settings: document.getElementById('pr_settings').value === '1',
    can_machines: document.getElementById('pr_machines').value === '1',
    can_spin: document.getElementById('pr_spin').value === '1',
    can_gateways: document.getElementById('pr_gateways').value === '1',
    can_history: document.getElementById('pr_history').value === '1',
    can_reports: document.getElementById('pr_reports').value === '1',
    can_security: document.getElementById('pr_security').value === '1',
    can_controls: document.getElementById('pr_controls').value === '1',
    can_passwords: document.getElementById('pr_passwords').value === '1',
    deposit_limit: document.getElementById('pr_dep_lim').value ? parseFloat(document.getElementById('pr_dep_lim').value) : null,
    withdraw_limit: document.getElementById('pr_wd_lim').value ? parseFloat(document.getElementById('pr_wd_lim').value) : null
  };
  const res = await fetch('/api/admin/partners/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  const msg = document.getElementById('pr_msgbox');
  msg.className = data.success ? 'success-msg' : 'error-msg';
  msg.textContent = data.success ? 'Partner created' : (data.error || 'Failed');
  msg.style.display = 'block';
  if (data.success) {
    loadPartners();
    // Clear fields
    ['pr_username','pr_password','pr_dep_lim','pr_wd_lim'].forEach(id => document.getElementById(id).value = '');
  }
}

async function savePartner(id) {
  const body = {
    id,
    active: document.getElementById(`e_active_${id}`).value === '1',
    can_dashboard: document.getElementById(`e_dash_${id}`).value === '1',
    can_deposits: document.getElementById(`e_dep_${id}`).value === '1',
    can_withdrawals: document.getElementById(`e_wd_${id}`).value === '1',
    can_messages: document.getElementById(`e_msg_${id}`).value === '1',
    can_users: document.getElementById(`e_users_${id}`).value === '1',
    can_profiles: document.getElementById(`e_prof_${id}`).value === '1',
    can_settings: document.getElementById(`e_set_${id}`).value === '1',
    can_machines: document.getElementById(`e_mac_${id}`).value === '1',
    can_spin: document.getElementById(`e_spin_${id}`).value === '1',
    can_gateways: document.getElementById(`e_gw_${id}`).value === '1',
    can_history: document.getElementById(`e_hist_${id}`).value === '1',
    can_reports: document.getElementById(`e_rep_${id}`).value === '1',
    can_security: document.getElementById(`e_sec_${id}`).value === '1',
    can_controls: document.getElementById(`e_ctrl_${id}`).value === '1',
    can_passwords: document.getElementById(`e_pass_${id}`).value === '1',
    deposit_limit: document.getElementById(`e_dep_lim_${id}`).value ? parseFloat(document.getElementById(`e_dep_lim_${id}`).value) : null,
    withdraw_limit: document.getElementById(`e_wd_lim_${id}`).value ? parseFloat(document.getElementById(`e_wd_lim_${id}`).value) : null
  };
  const res = await fetch('/api/admin/partners/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  showToast(data.success ? 'Saved' : (data.error || 'Failed'), data.success ? 'success' : 'error');
}

async function resetPartnerPassword(id) {
  const np = prompt('New password (min 6 chars):');
  if (!np || np.length < 6) return;
  const res = await fetch('/api/admin/partners/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, new_password: np }) });
  const data = await res.json();
  showToast(data.success ? 'Password reset' : (data.error || 'Failed'), data.success ? 'success' : 'error');
}

async function deletePartner(id) {
  if (!confirm('Delete this partner account?')) return;
  const res = await fetch('/api/admin/partners/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  const data = await res.json();
  showToast(data.success ? 'Deleted' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) loadPartners();
}

// Impersonate user
async function impersonate(id) {
  const res = await fetch('/api/admin/users/impersonate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: id }) });
  const data = await res.json();
  showToast(data.success ? 'Opening user session…' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) window.open('/dashboard.html', '_blank');
}
// Delete user
async function deleteUser(id, username) {
  if (!confirm(`⚠️ PERMANENTLY DELETE user "${username}" (ID: ${id})?\n\nThis will remove ALL their data: machines, transactions, withdrawals, payments, profile, spin history.\n\nThis cannot be undone!`)) return;
  try {
    const res = await fetch('/api/admin/users/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id })
    });
    const data = await res.json();
    showToast(data.success ? data.message : data.error, data.success ? 'success' : 'error');
    if (data.success) { loadUsers(); loadOverview(); }
  } catch { showToast('Delete failed', 'error'); }
}

// User History Lookup
async function lookupUserHistory() {
  const username = document.getElementById('historyUsername').value.trim();
  const errEl = document.getElementById('historyError');
  const resultEl = document.getElementById('historyResult');
  errEl.style.display = 'none';
  resultEl.style.display = 'none';

  if (!username) { errEl.textContent = 'Please enter a username'; errEl.style.display = 'block'; return; }

  try {
    const res = await fetch(`/api/admin/users/history?username=${encodeURIComponent(username)}`);
    const data = await res.json();
    if (data.error) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }

    const u = data.user;
    const s = data.summary;
    const p = data.profile;

    let html = `
      <div class="admin-item-card">
        <div class="admin-item-header">👤 ${u.username} — ${u.email}</div>
        <div class="stats-grid" style="margin:16px 0;">
          <div class="stat-card balance-card"><div class="stat-icon">💰</div><div class="stat-info"><div class="stat-label">Balance</div><div class="stat-value">₹${u.balance.toFixed(2)}</div></div></div>
          <div class="stat-card earning-card"><div class="stat-icon">📈</div><div class="stat-info"><div class="stat-label">Earning/Hr</div><div class="stat-value">₹${s.totalPerHour}</div></div></div>
          <div class="stat-card uncollected-card"><div class="stat-icon">⚙️</div><div class="stat-info"><div class="stat-label">Machines</div><div class="stat-value">${s.machineCount}</div></div></div>
          <div class="stat-card machines-card"><div class="stat-icon">🎟️</div><div class="stat-info"><div class="stat-label">Free Spins</div><div class="stat-value">${u.free_spins||0}</div></div></div>
        </div>
        <div class="admin-item-details">
          <strong>Summary:</strong> Deposited: <strong>₹${s.totalDeposited}</strong> | Withdrawn: <strong>₹${s.totalWithdrawn}</strong> | Mining: <strong>₹${s.totalMiningEarnings}</strong> | Referral: <strong>₹${s.totalReferralEarnings}</strong> | Spin/Bonus: <strong>₹${s.totalSpinWinnings}</strong> | Purchases: <strong>₹${s.totalPurchases}</strong>
        </div>
        <div class="admin-item-details">
          Referral Code: <strong>${u.referral_code}</strong> | Joined: ${formatDate(u.created_at)} | Last Collected: ${formatDate(u.last_collected_at)}
        </div>`;

    if (p) {
      html += `
        <div class="admin-item-details" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
          <strong>Profile:</strong> ${p.full_name||'N/A'} | ${p.phone||'N/A'} | ${p.city||''} ${p.state||''} ${p.pincode||''}<br>
          <strong>Bank:</strong> ${p.bank_name||'N/A'} A/C: ${p.bank_account_number||'N/A'} IFSC: ${p.bank_ifsc||'N/A'} | UPI: ${p.upi_id||'N/A'}
        </div>`;
    }
    html += `</div>`;

    // Machines
    if (data.machines.length > 0) {
      html += `<h3 style="margin:20px 0 12px;">⚙️ Machines (${data.machines.length})</h3><div class="admin-scroll-table">`;
      data.machines.forEach(m => {
        html += `<div class="admin-item-card" style="padding:12px 16px;"><span style="font-size:1.2rem;">${m.icon}</span> <strong>${m.name}</strong> — ₹${m.earning_per_hour}/hr — Bought: ${formatDate(m.purchased_at)}</div>`;
      });
      html += `</div>`;
    }

    // Recent Transactions
    if (data.transactions.length > 0) {
      html += `<h3 style="margin:20px 0 12px;">📜 Transactions (last ${data.transactions.length})</h3><div class="transactions-list" style="max-height:400px;overflow-y:auto;">`;
      data.transactions.forEach(t => {
        const isPos = t.amount >= 0 && t.type !== 'purchase';
        html += `<div class="transaction-item"><div class="tx-info"><div class="tx-description">${t.description||''} <span class="tx-type-badge tx-type-${t.type}">${t.type}</span></div><div class="tx-date">${formatDate(t.created_at)}</div></div><div class="tx-amount ${isPos?'positive':'negative'}">${isPos?'+':''}₹${Math.abs(t.amount).toFixed(2)}</div></div>`;
      });
      html += `</div>`;
    }

    // Withdrawals
    if (data.withdrawals.length > 0) {
      html += `<h3 style="margin:20px 0 12px;">💸 Withdrawals (${data.withdrawals.length})</h3><div class="transactions-list" style="max-height:300px;overflow-y:auto;">`;
      data.withdrawals.forEach(w => {
        html += `<div class="transaction-item"><div class="tx-info"><div class="tx-description">₹${w.amount.toFixed(2)} via ${w.method.toUpperCase()} <span class="tx-type-badge tx-type-${w.status==='approved'?'mining':w.status==='rejected'?'purchase':'bonus'}">${w.status}</span></div><div class="tx-date">${formatDate(w.created_at)}</div></div></div>`;
      });
      html += `</div>`;
    }

    resultEl.innerHTML = html;
    resultEl.style.display = 'block';
  } catch (err) {
    errEl.textContent = 'Failed to load user history';
    errEl.style.display = 'block';
  }
}

// Payment Settings
async function uploadQrImage(fileInputId, targetInputId) {
  const fileEl = document.getElementById(fileInputId);
  const targetEl = document.getElementById(targetInputId);
  if (!fileEl || !targetEl) return;
  const file = fileEl.files && fileEl.files[0];
  if (!file) { showToast('Select an image first', 'error'); return; }

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(file);
    });
    const compressedDataUrl = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round((img.width || 1) * scale));
        const h = Math.max(1, Math.round((img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas_failed'));
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('image_decode_failed'));
      img.src = dataUrl;
    });
    const res = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ filename: (file.name || 'qr').replace(/\.[^.]+$/, '') + '.jpg', data: compressedDataUrl })
    });
    let out = {};
    try { out = await res.json(); } catch {}
    if (res.status === 401) {
      showToast('Admin login required', 'error');
      return;
    }
    if (!res.ok) {
      showToast(out.error || ('Upload failed (' + res.status + ')'), 'error');
      return;
    }
    if (!out.success) {
      showToast(out.error || 'Upload failed', 'error');
      return;
    }
    targetEl.value = out.url;
    showToast('QR uploaded', 'success');
  } catch (e) {
    showToast(e && e.message ? e.message : 'Upload failed', 'error');
  }
}

async function loadPaySettings() {
  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();
    const s = data.settings || {};
    document.getElementById('ps_withdraw_cap_upi').value = s.withdraw_cap_upi || '';
    document.getElementById('ps_withdraw_cap_bank').value = s.withdraw_cap_bank || '';
    document.getElementById('ps_withdraw_daily_cap').value = s.withdraw_daily_cap || '';
    document.getElementById('ps_withdraw_frequency_limit').value = s.withdraw_frequency_limit || '';
    document.getElementById('ps_withdraw_frequency_hours').value = s.withdraw_frequency_hours || '';
    document.getElementById('ps_usdt_inr_rate').value = s.usdt_inr_rate || '101';
  } catch (err) { console.error('Load settings error:', err); }
}

async function savePaySettings() {
  const msg = document.getElementById('paySettingsMsg');
  msg.style.display = 'none';
  const body = {
    withdraw_cap_upi: document.getElementById('ps_withdraw_cap_upi').value.trim(),
    withdraw_cap_bank: document.getElementById('ps_withdraw_cap_bank').value.trim(),
    withdraw_daily_cap: document.getElementById('ps_withdraw_daily_cap').value.trim(),
    withdraw_frequency_limit: document.getElementById('ps_withdraw_frequency_limit').value.trim(),
    withdraw_frequency_hours: document.getElementById('ps_withdraw_frequency_hours').value.trim(),
    usdt_inr_rate: document.getElementById('ps_usdt_inr_rate').value.trim()
  };
  try {
    const res = await fetch('/api/admin/settings/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      msg.className = 'success-msg';
      msg.textContent = data.message;
      showToast('Payment settings saved!', 'success');
    } else {
      msg.className = 'error-msg';
      msg.textContent = data.error;
    }
    msg.style.display = 'block';
    setTimeout(() => msg.style.display = 'none', 4000);
  } catch { showToast('Failed to save settings', 'error'); }
}

// Gateways and tokens CRUD
async function loadGatewaysTokens() {
  try {
    const gres = await fetch('/api/admin/gateways');
    const gdata = await gres.json();
    window.__admin_gateways = gdata.gateways || [];
    const list = document.getElementById('gatewaysList');
    if (list) {
      list.innerHTML = gdata.gateways.length === 0 ? '<div class="no-transactions">No gateways</div>' :
        gdata.gateways.map(g => `
          <div class="admin-item-card">
            <div class="admin-item-header">${(g.method||'').toUpperCase()} — ${g.label || ''} ${g.enabled? '<span class="status-pill status-approved" style="margin-left:8px;">STARTED</span>':'<span class="status-pill status-rejected" style="margin-left:8px;">STOPPED</span>'}</div>
            <div class="admin-item-details">
              ${g.method==='upi' ? `UPI: ${g.upi_id || ''} ${g.upi_name? '('+g.upi_name+')':''}` : `Bank: ${g.bank_name || ''} A/C: ${g.bank_account_number || ''} IFSC: ${g.bank_ifsc || ''}`}
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary" onclick="editGateway(${g.id})">Edit</button>
              <button class="btn btn-primary" onclick="toggleGateway(${g.id}, ${g.enabled?0:1})">${g.enabled? 'Stop':'Start'}</button>
              <button class="btn btn-primary" style="background:linear-gradient(135deg,#e94560,#c83b50);" onclick="deleteGateway(${g.id})">Delete</button>
            </div>
          </div>
        `).join('');
    }
    const tres = await fetch('/api/admin/crypto/tokens');
    const tdata = await tres.json();
    window.__admin_tokens = tdata.tokens || [];
    const tlist = document.getElementById('tokensList');
    if (tlist) {
      tlist.innerHTML = tdata.tokens.length === 0 ? '<div class="no-transactions">No tokens</div>' :
        tdata.tokens.map(t => `
          <div class="admin-item-card">
            <div class="admin-item-header">${t.symbol} — ${t.name || ''} ${t.network? '('+t.network+')':''}</div>
            <div class="admin-item-details">${t.address}</div>
            ${t.qr_url ? `<div style="margin:8px 0;"><img src="${t.qr_url}" style="max-width:120px;max-height:120px;border-radius:8px;"></div>` : ''}
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary" onclick="editToken(${t.id})">Edit</button>
              <button class="btn btn-primary" onclick="toggleToken(${t.id}, ${t.enabled?0:1})">${t.enabled? 'Stop':'Start'}</button>
              <button class="btn btn-primary" style="background:linear-gradient(135deg,#e94560,#c83b50);" onclick="deleteToken(${t.id})">Delete</button>
            </div>
          </div>
        `).join('');
    }
    const allBox = document.getElementById('allGatewaysList');
    if (allBox) {
      const header = `
        <div style="display:grid;grid-template-columns:120px 220px 1fr 120px 220px;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border);font-weight:600;color:var(--text-secondary);">
          <div>Type</div><div>Name</div><div>Details</div><div>Status</div><div>Actions</div>
        </div>`;
      const gwRows = (window.__admin_gateways || []).map(g => {
        const type = (g.method || '').toUpperCase();
        const name = g.label || '';
        const details = g.method === 'upi'
          ? `UPI: ${g.upi_id || ''} ${g.upi_name ? '('+g.upi_name+')' : ''}`
          : `Bank: ${g.bank_name || ''} A/C: ${g.bank_account_number || ''} IFSC: ${g.bank_ifsc || ''}`;
        const status = g.enabled ? '<span class="status-pill status-approved">STARTED</span>' : '<span class="status-pill status-rejected">STOPPED</span>';
        const actions = `
          <button class="btn btn-primary" onclick="editGateway(${g.id})">Edit</button>
          <button class="btn btn-primary" onclick="toggleGateway(${g.id}, ${g.enabled?0:1})">${g.enabled? 'Stop':'Start'}</button>
          <button class="btn btn-primary" style="background:linear-gradient(135deg,#e94560,#c83b50);" onclick="deleteGateway(${g.id})">Delete</button>`;
        return `
          <div style="display:grid;grid-template-columns:120px 220px 1fr 120px 220px;gap:8px;padding:10px;border-bottom:1px solid var(--border);align-items:center;">
            <div>${type}</div>
            <div>${name}</div>
            <div style="color:var(--text-secondary);">${details}</div>
            <div>${status}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${actions}</div>
          </div>`;
      }).join('');
      const tokenRows = (window.__admin_tokens || []).map(t => {
        const type = 'CRYPTO';
        const name = `${t.symbol}${t.network ? ' ('+t.network+')' : ''}`;
        const details = `${t.address}${t.qr_url ? ` — <img src="${t.qr_url}" style="height:28px;width:28px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-left:6px;">` : ''}`;
        const status = t.enabled ? '<span class="status-pill status-approved">STARTED</span>' : '<span class="status-pill status-rejected">STOPPED</span>';
        const actions = `
          <button class="btn btn-primary" onclick="editToken(${t.id})">Edit</button>
          <button class="btn btn-primary" onclick="toggleToken(${t.id}, ${t.enabled?0:1})">${t.enabled? 'Stop':'Start'}</button>
          <button class="btn btn-primary" style="background:linear-gradient(135deg,#e94560,#c83b50);" onclick="deleteToken(${t.id})">Delete</button>`;
        return `
          <div style="display:grid;grid-template-columns:120px 220px 1fr 120px 220px;gap:8px;padding:10px;border-bottom:1px solid var(--border);align-items:center;">
            <div>${type}</div>
            <div>${name}</div>
            <div style="color:var(--text-secondary);">${details}</div>
            <div>${status}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${actions}</div>
          </div>`;
      }).join('');
      const empty = (!window.__admin_gateways || window.__admin_gateways.length === 0) && (!window.__admin_tokens || window.__admin_tokens.length === 0);
      allBox.innerHTML = empty ? '<div class="no-transactions">No payment options added</div>' : header + gwRows + tokenRows;
    }
  } catch {}
}
document.addEventListener('DOMContentLoaded', () => { loadGatewaysTokens(); });

async function editGateway(id) {
  try {
    if (!window.__admin_gateways) {
      const res = await fetch('/api/admin/gateways'); 
      const data = await res.json(); 
      window.__admin_gateways = data.gateways || [];
    }
    const g = (window.__admin_gateways || []).find(x => x.id === id);
    if (!g) { showToast('Gateway not found', 'error'); return; }
    const method = prompt('Method (upi/bank):', g.method || 'upi');
    if (!method) return;
    const label = prompt('Label:', g.label || '');
    if (!label) return;
    let payload = { id, method: method.trim(), label: label.trim(), enabled: g.enabled ? 1 : 0 };
    if (method === 'upi') {
      payload.upi_id = prompt('UPI ID:', g.upi_id || '') || '';
      payload.upi_name = prompt('UPI Name:', g.upi_name || '') || '';
      payload.qr_url = prompt('QR URL (optional):', g.qr_url || '') || '';
    } else {
      payload.bank_name = prompt('Bank Name:', g.bank_name || '') || '';
      payload.bank_account_name = prompt('Account Name:', g.bank_account_name || '') || '';
      payload.bank_account_number = prompt('Account Number:', g.bank_account_number || '') || '';
      payload.bank_ifsc = prompt('IFSC:', g.bank_ifsc || '') || '';
    }
    const res = await fetch('/api/admin/gateways/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const out = await res.json();
    showToast(out.success ? 'Gateway updated' : (out.error || 'Failed'), out.success ? 'success' : 'error');
    if (out.success) loadGatewaysTokens();
  } catch { showToast('Failed to edit gateway', 'error'); }
}
async function addGateway() {
  const body = {
    method: document.getElementById('gw_method').value,
    label: document.getElementById('gw_label').value.trim(),
    upi_id: document.getElementById('gw_upi_id').value.trim(),
    upi_name: document.getElementById('gw_upi_name').value.trim(),
    qr_url: document.getElementById('gw_qr_url').value.trim(),
    bank_name: document.getElementById('gw_bank_name').value.trim(),
    bank_account_name: document.getElementById('gw_bank_accname').value.trim(),
    bank_account_number: document.getElementById('gw_bank_accno').value.trim(),
    bank_ifsc: document.getElementById('gw_bank_ifsc').value.trim()
  };
  const res = await fetch('/api/admin/gateways/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  showToast(data.success ? 'Gateway added' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) loadGatewaysTokens();
}
async function deleteGateway(id) {
  if (!confirm('Delete this gateway?')) return;
  const res = await fetch('/api/admin/gateways/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  const data = await res.json();
  showToast(data.success ? 'Gateway deleted' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) loadGatewaysTokens();
}
async function toggleGateway(id, enabled) {
  const res = await fetch('/api/admin/gateways/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) });
  const data = await res.json();
  showToast(data.success ? 'Gateway updated' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) loadGatewaysTokens();
}
async function editToken(id) {
  try {
    if (!window.__admin_tokens) {
      const res = await fetch('/api/admin/crypto/tokens'); 
      const data = await res.json(); 
      window.__admin_tokens = data.tokens || [];
    }
    const t = (window.__admin_tokens || []).find(x => x.id === id);
    if (!t) { showToast('Token not found', 'error'); return; }
    const symbol = prompt('Symbol:', t.symbol || '') || t.symbol;
    const name = prompt('Name:', t.name || '') || '';
    const network = prompt('Network (e.g., TRC20, ERC20):', t.network || '') || '';
    const address = prompt('Address:', t.address || '') || '';
    const qr_url = prompt('QR URL (optional):', t.qr_url || '') || '';
    const res = await fetch('/api/admin/crypto/tokens/update', { 
      method: 'POST', headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ id, symbol, name, network, address, qr_url, enabled: t.enabled ? 1 : 0 }) 
    });
    const out = await res.json();
    showToast(out.success ? 'Token updated' : (out.error || 'Failed'), out.success ? 'success' : 'error');
    if (out.success) loadGatewaysTokens();
  } catch { showToast('Failed to edit token', 'error'); }
}
async function addToken() {
  const body = {
    symbol: document.getElementById('ct_symbol').value.trim(),
    name: document.getElementById('ct_name').value.trim(),
    network: document.getElementById('ct_network').value.trim(),
    address: document.getElementById('ct_address').value.trim(),
    qr_url: document.getElementById('ct_qr').value.trim()
  };
  const res = await fetch('/api/admin/crypto/tokens/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  showToast(data.success ? 'Token added' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) loadGatewaysTokens();
}
async function deleteToken(id) {
  if (!confirm('Delete this token?')) return;
  const res = await fetch('/api/admin/crypto/tokens/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  const data = await res.json();
  showToast(data.success ? 'Token deleted' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) loadGatewaysTokens();
}
async function toggleToken(id, enabled) {
  const res = await fetch('/api/admin/crypto/tokens/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) });
  const data = await res.json();
  showToast(data.success ? 'Token updated' : (data.error || 'Failed'), data.success ? 'success' : 'error');
  if (data.success) loadGatewaysTokens();
}

// Logout
document.getElementById('adminLogoutBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/admin/logout', { method: 'POST' });
  document.getElementById('adminDashboard').style.display = 'none';
  document.getElementById('adminLogin').style.display = 'flex';
});

// Init
(async () => {
  const authed = await checkAdmin();
  if (authed) showDashboard();
})();

// Reports filter link builder
document.addEventListener('DOMContentLoaded', () => {
  const from = document.getElementById('r_from');
  const to = document.getElementById('r_to');
  const btn = document.getElementById('r_tx_btn');
  const btn2 = document.getElementById('r_activity_btn');
  const depBtn = document.getElementById('r_dep_btn');
  const wdBtn = document.getElementById('r_wd_btn');
  const sd = document.getElementById('spin_diff'); const sdNum = document.getElementById('spin_diff_num');
  const ld = document.getElementById('lucky_diff'); const ldNum = document.getElementById('lucky_diff_num');
  const dd = document.getElementById('dice_diff'); const ddNum = document.getElementById('dice_diff_num');
  function updateLink() {
    const params = [];
    if (from && from.value.trim()) params.push('from=' + encodeURIComponent(from.value.trim()));
    if (to && to.value.trim()) params.push('to=' + encodeURIComponent(to.value.trim()));
    const q = params.length ? '?' + params.join('&') : '';
    if (btn) btn.href = '/api/admin/export/report-transactions' + q;
    if (btn2) btn2.href = '/api/admin/export/report-activity' + q;
    if (depBtn) depBtn.href = '/api/admin/export/report-deposits' + q;
    if (wdBtn) wdBtn.href = '/api/admin/export/report-withdrawals' + q;
  }
  if (from) from.addEventListener('input', updateLink);
  if (to) to.addEventListener('input', updateLink);
  updateLink();
  if (sd && sdNum) sd.addEventListener('input', () => sdNum.textContent = sd.value);
  if (ld && ldNum) ld.addEventListener('input', () => ldNum.textContent = ld.value);
  if (dd && ddNum) dd.addEventListener('input', () => ddNum.textContent = dd.value);
});
