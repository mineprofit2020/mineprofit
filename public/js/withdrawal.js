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

let userProfile = null;

function startWithdrawNews() {
  const el = document.getElementById('withdrawNewsBar');
  if (!el) return;

  const names = ['Amit', 'Rohit', 'Neha', 'Priya', 'Sahil', 'Kiran', 'Ankit', 'Simran', 'Vikas', 'Pooja'];
  const methods = ['UPI', 'BANK'];
  const amounts = [100, 200, 300, 500, 800, 1000, 1500, 2000];

  const tick = () => {
    const n = names[Math.floor(Math.random() * names.length)];
    const m = methods[Math.floor(Math.random() * methods.length)];
    const a = amounts[Math.floor(Math.random() * amounts.length)];
    const mins = Math.floor(Math.random() * 25) + 1;
    el.innerHTML = `<div>📤 <strong>${n}</strong> withdrew <strong>₹${a}</strong> via <strong>${m}</strong></div><div class="news-meta">${mins} min ago</div>`;
  };

  tick();
  if (window.__withdrawNewsTimer) clearInterval(window.__withdrawNewsTimer);
  window.__withdrawNewsTimer = setInterval(tick, 10000);
}

async function loadWithdrawalData() {
  try {
    // Load user balance + profile
    const profileRes = await fetch('/api/profile');
    if (profileRes.status === 401) { window.location.href = '/login.html'; return; }
    const profileData = await profileRes.json();

    document.getElementById('withdrawBalance').textContent = `₹${fNum(profileData.user.balance)}`;
    userProfile = profileData.profile;

    // Load withdrawal history
    const wRes = await fetch('/api/profile/withdrawals');
    const wData = await wRes.json();
    const withdrawals = wData.withdrawals || [];

    // Compute totals
    const totalWithdrawn = withdrawals.filter(w => w.status === 'approved').reduce((sum, w) => sum + Number(w.amount), 0);
    const pendingAmt = withdrawals.filter(w => w.status === 'pending').reduce((sum, w) => sum + Number(w.amount), 0);

    document.getElementById('totalWithdrawn').textContent = `₹${fNum(totalWithdrawn)}`;
    document.getElementById('pendingWithdrawals').textContent = `₹${fNum(pendingAmt)}`;

    renderWithdrawals(withdrawals);
    updateBankPreview();
  } catch (err) {
    console.error('Failed to load withdrawal data:', err);
  }
}

function updateBankPreview() {
  const method = document.getElementById('withdrawMethod').value;
  const previewEl = document.getElementById('bankPreviewText');

  if (!userProfile) {
    previewEl.textContent = '⚠️ No bank details saved — add them in Profile';
    return;
  }

  if (method === 'bank') {
    const acct = userProfile.bank_account_number;
    const bank = userProfile.bank_name;
    if (acct && bank) {
      const masked = '••••' + acct.slice(-4);
      previewEl.textContent = `${bank} — A/C ${masked} (${userProfile.bank_ifsc || ''})`;
    } else {
      previewEl.textContent = '⚠️ Bank account not set — add it in Profile';
    }
  } else {
    const upi = userProfile.upi_id;
    previewEl.textContent = upi ? `UPI: ${upi}` : '⚠️ UPI ID not set — add it in Profile';
  }
}

function renderWithdrawals(withdrawals) {
  const list = document.getElementById('withdrawalsList');
  if (withdrawals.length === 0) {
    list.innerHTML = '<div class="no-transactions">No withdrawals yet</div>';
    return;
  }

  list.innerHTML = withdrawals.map(w => {
    const statusColor = w.status === 'approved' ? 'mining' : w.status === 'rejected' ? 'purchase' : 'bonus';
    const statusIcon = w.status === 'approved' ? '✅' : w.status === 'rejected' ? '❌' : '⏳';
    return `
      <div class="transaction-item">
        <div class="tx-info">
          <div class="tx-description">
            ${statusIcon} Withdrawal via ${w.method.toUpperCase()}
            <span class="tx-type-badge tx-type-${statusColor}">${w.status}</span>
          </div>
          <div class="tx-date">${formatDate(w.created_at)}${w.admin_note ? ` · ${w.admin_note}` : ''}</div>
        </div>
        <div class="tx-amount negative">-₹${fNum(w.amount)}</div>
      </div>
    `;
  }).join('');
}

// Update preview when method changes
document.getElementById('withdrawMethod').addEventListener('change', updateBankPreview);

// Withdrawal form submit
document.getElementById('withdrawForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('withdrawMsg');
  const okEl = document.getElementById('withdrawSuccess');
  errEl.style.display = 'none';
  okEl.style.display = 'none';

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
      okEl.textContent = data.message;
      okEl.style.display = 'block';
      showToast(data.message, 'success');
      document.getElementById('withdrawAmount').value = '';
      loadWithdrawalData();
    } else {
      errEl.textContent = data.error;
      errEl.style.display = 'block';
    }
  } catch {
    errEl.textContent = 'Failed to submit withdrawal. Please try again.';
    errEl.style.display = 'block';
  }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

(async () => {
  const authed = await checkAuth();
  if (authed) {
    startWithdrawNews();
    loadWithdrawalData();
  }
})();
