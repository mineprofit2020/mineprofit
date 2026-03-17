function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function fNum(val, decimals = 2) {
  const num = Number(val);
  return isNaN(num) ? (0).toFixed(decimals) : num.toFixed(decimals);
}

function formatDate(dateStr) {
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

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.user) { window.location.href = '/login.html'; return false; }
    return true;
  } catch { window.location.href = '/login.html'; return false; }
}

// Load profile data
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    const data = await res.json();

    if (res.status === 401) { window.location.href = '/login.html'; return; }

    document.getElementById('withdrawBalance').textContent = `₹${fNum(data.user.balance)}`;

    if (data.profile) {
      const p = data.profile;
      document.getElementById('full_name').value = p.full_name || '';
      document.getElementById('phone').value = p.phone || '';
      document.getElementById('address').value = p.address || '';
      document.getElementById('city').value = p.city || '';
      document.getElementById('state').value = p.state || '';
      document.getElementById('pincode').value = p.pincode || '';
      document.getElementById('bank_account_name').value = p.bank_account_name || '';
      document.getElementById('bank_account_number').value = p.bank_account_number || '';
      document.getElementById('bank_ifsc').value = p.bank_ifsc || '';
      document.getElementById('bank_name').value = p.bank_name || '';
      document.getElementById('upi_id').value = p.upi_id || '';
    }
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

// Save profile
document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('profileMsg');

  const body = {
    full_name: document.getElementById('full_name').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    address: document.getElementById('address').value.trim(),
    city: document.getElementById('city').value.trim(),
    state: document.getElementById('state').value.trim(),
    pincode: document.getElementById('pincode').value.trim(),
    bank_account_name: document.getElementById('bank_account_name').value.trim(),
    bank_account_number: document.getElementById('bank_account_number').value.trim(),
    bank_ifsc: document.getElementById('bank_ifsc').value.trim(),
    bank_name: document.getElementById('bank_name').value.trim(),
    upi_id: document.getElementById('upi_id').value.trim(),
  };

  try {
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.success) {
      msg.className = 'success-msg';
      msg.textContent = data.message;
      msg.style.display = 'block';
      showToast('Profile saved!', 'success');
    } else {
      msg.className = 'error-msg';
      msg.textContent = data.error;
      msg.style.display = 'block';
    }
  } catch {
    showToast('Failed to save profile', 'error');
  }

  setTimeout(() => msg.style.display = 'none', 4000);
});

// Change Password
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const current_password = document.getElementById('cp_current').value;
  const new_password = document.getElementById('cp_new').value;
  const confirm_password = document.getElementById('cp_confirm').value;
  const msg = document.getElementById('cp_msg');
  
  if (new_password !== confirm_password) {
    showToast('New passwords do not match', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/password/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password })
    });
    const data = await res.json();

    if (data.success) {
      msg.className = 'success-msg';
      msg.textContent = data.message;
      msg.style.display = 'block';
      showToast(data.message, 'success');
      document.getElementById('changePasswordForm').reset();
    } else {
      msg.className = 'error-msg';
      msg.textContent = data.error;
      msg.style.display = 'block';
      showToast(data.error, 'error');
    }
  } catch {
    showToast('Failed to change password', 'error');
  }
  setTimeout(() => msg.style.display = 'none', 4000);
});

// Withdraw
document.getElementById('withdrawForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('withdrawMsg');
  msg.style.display = 'none';

  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  const method = document.getElementById('withdrawMethod').value;

  try {
    const res = await fetch('/api/profile/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('withdrawAmount').value = '';
      loadProfile();
      loadWithdrawals();
    } else {
      msg.textContent = data.error;
      msg.style.display = 'block';
    }
  } catch {
    msg.textContent = 'Failed to submit withdrawal';
    msg.style.display = 'block';
  }
});

// Load withdrawal history
async function loadWithdrawals() {
  try {
    const res = await fetch('/api/profile/withdrawals');
    const data = await res.json();
    const list = document.getElementById('withdrawalsList');

    if (data.withdrawals.length === 0) {
      list.innerHTML = '<div class="no-transactions">No withdrawals yet</div>';
      return;
    }

    list.innerHTML = data.withdrawals.map(w => {
      const statusClass = w.status === 'approved' ? 'positive' : w.status === 'rejected' ? 'negative' : '';
      return `
        <div class="transaction-item">
          <div class="tx-info">
            <div class="tx-description">
              Withdrawal via ${w.method.toUpperCase()}
              <span class="tx-type-badge tx-type-${w.status === 'approved' ? 'mining' : w.status === 'rejected' ? 'purchase' : 'bonus'}">${w.status}</span>
            </div>
            <div class="tx-date">${formatDate(w.created_at)}</div>
          </div>
          <div class="tx-amount negative">-₹${w.amount.toFixed(2)}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load withdrawals:', err);
  }
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

(async () => {
  const authed = await checkAuth();
  if (authed) {
    loadProfile();
    loadWithdrawals();
  }
})();
