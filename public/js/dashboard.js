// Utility: Show toast notification
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Utility: Format date
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

// Check auth
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.user) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  } catch {
    window.location.href = '/login.html';
    return false;
  }
}

// Load dashboard stats
async function loadStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const data = await res.json();

    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }

    document.getElementById('username').textContent = data.username;
    document.getElementById('balance').textContent = `₹${data.balance.toFixed(2)}`;
    document.getElementById('earningRate').textContent = `₹${data.totalPerHour}/hr`;
    document.getElementById('uncollected').textContent = `₹${data.uncollectedEarnings.toFixed(2)}`;
    document.getElementById('totalMachines').textContent = data.totalMachines;
    document.getElementById('referralCode').textContent = data.referralCode;
    document.getElementById('memberSince').textContent = formatDate(data.memberSince);

    // Referral link
    const baseUrl = window.location.origin;
    document.getElementById('referralLink').textContent = `${baseUrl}/register.html?ref=${data.referralCode}`;

    // Boost indicator
    if (data.boostMultiplier && data.boostMultiplier > 1) {
      const er = document.getElementById('earningRate');
      er.innerHTML = `₹${data.totalPerHour}/hr <span class="tx-type-badge tx-type-bonus" style="margin-left:6px;">x${data.boostMultiplier}</span>`;
    }

    // Render machines
    const machinesList = document.getElementById('machinesList');
    const counts = data.machineCounts;
    if (Object.keys(counts).length === 0) {
      machinesList.innerHTML = '<div class="no-transactions">No machines yet. Visit the shop!</div>';
    } else {
      machinesList.innerHTML = Object.entries(counts).map(([name, info]) => `
        <div class="machine-item">
          <div class="machine-icon">${info.icon}</div>
          <div class="machine-name">${name}</div>
          <div class="machine-count">x${info.count}</div>
          <div class="machine-earning">₹${info.earning_per_hour * info.count}/hr</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Collect earnings
async function collectEarnings() {
  const btn = document.getElementById('collectBtn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/dashboard/collect', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(`Collected ₹${data.collected.toFixed(2)}!`, 'success');
      loadStats();
      loadTransactions();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Failed to collect earnings', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Collect';
}

// Load referrals
async function loadReferrals() {
  try {
    const res = await fetch('/api/dashboard/referrals');
    const data = await res.json();

    document.getElementById('level1Count').textContent = data.level1.count;
    document.getElementById('level2Count').textContent = data.level2.count;
    document.getElementById('level3Count').textContent = data.level3.count;
    document.getElementById('totalReferrals').textContent = data.totalReferrals;
    document.getElementById('referralEarnings').textContent = `₹${data.totalReferralEarnings.toFixed(2)}`;

    renderLevelUsers('level1Users', data.level1.users);
    renderLevelUsers('level2Users', data.level2.users);
    renderLevelUsers('level3Users', data.level3.users);
  } catch (err) {
    console.error('Failed to load referrals:', err);
  }
}

function renderLevelUsers(elementId, users) {
  const container = document.getElementById(elementId);
  if (users.length === 0) {
    container.innerHTML = '<div class="no-referrals">No referrals at this level yet</div>';
    return;
  }
  container.innerHTML = users.map(u => `
    <div class="level-user">
      <span class="user-name">👤 ${u.username}</span>
      <span class="user-date">${formatDate(u.created_at)}</span>
    </div>
  `).join('');
}

// Load transactions
async function loadTransactions() {
  try {
    const res = await fetch('/api/dashboard/transactions');
    const data = await res.json();

    const list = document.getElementById('transactionsList');

    if (data.transactions.length === 0) {
      list.innerHTML = '<div class="no-transactions">No transactions yet</div>';
      return;
    }

    list.innerHTML = data.transactions.map(tx => {
      const isPositive = tx.amount >= 0 && tx.type !== 'purchase';
      const amountClass = isPositive ? 'positive' : 'negative';
      const amountPrefix = isPositive ? '+' : '';

      return `
        <div class="transaction-item">
          <div class="tx-info">
            <div class="tx-description">
              ${tx.description}
              <span class="tx-type-badge tx-type-${tx.type}">${tx.type}</span>
            </div>
            <div class="tx-date">${formatDate(tx.created_at)}</div>
          </div>
          <div class="tx-amount ${amountClass}">${amountPrefix}₹${Math.abs(tx.amount).toFixed(2)}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load transactions:', err);
  }
}

// Copy referral code
function copyReferralCode() {
  const code = document.getElementById('referralCode').textContent;
  const link = `${window.location.origin}/register.html?ref=${code}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('Referral link copied!', 'success');
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = link;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Referral link copied!', 'success');
  });
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// Initialize
(async () => {
  const authed = await checkAuth();
  if (authed) {
    loadStats();
    loadPromotions();
    loadReferrals();
    loadTransactions();

    // Auto-refresh uncollected earnings every 30 seconds
    setInterval(loadStats, 30000);
  }
})();

// Promotions and boosters
async function loadPromotions() {
  try {
    const res = await fetch('/api/dashboard/promotions');
    const data = await res.json();
    
    const promoBox = document.getElementById('promotionsBox');
    const boosterBox = document.getElementById('boostersBox');
    
    // Boosters
    if (data.boosters && data.boosters.length > 0) {
      boosterBox.style.display = 'block';
      document.getElementById('boostersList').innerHTML = data.boosters.map(b => `
        <div class="user-card" style="padding:16px; margin-bottom:10px; background:linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.05)); border-color:rgba(16, 185, 129, 0.3);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:700; color:#34d399;">⚡ ACTIVE BOOSTER</div>
            <span class="status-pill status-approved">ACTIVE</span>
          </div>
          <div style="margin-top:8px; font-size:0.95rem;">${b.type.toUpperCase()} +${Math.round(b.value * 100)}%</div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">Expires: ${b.expires_at ? formatDate(b.expires_at) : 'Never'}</div>
        </div>
      `).join('');
    } else {
        boosterBox.style.display = 'none';
    }

    // Messages
    if (data.notifications && data.notifications.length > 0) {
      promoBox.style.display = 'block';
      const renderCard = (n) => `
        <div class="user-card" style="padding:16px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-weight:700; display:flex; align-items:center; gap:8px;">
              <span>${n.type === 'promo' ? '🎁' : '📣'}</span>
              <span>${n.title}</span>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${formatDate(n.created_at)}</div>
          </div>
          <div style="color:var(--text-secondary); font-size:0.9rem; line-height:1.5;">${n.message}</div>
          ${(n.require_ack && !n.acked) ? `<button class="btn-link-sm" style="margin-top:12px;" onclick="ackNotification(${n.id})">Mark as Read</button>` : ''}
        </div>
      `;

      const top = data.notifications.slice(0, 3);
      const rest = data.notifications.slice(3);
      let html = top.map(renderCard).join('');
      if (rest.length > 0) {
        html += `
          <div style="max-height:340px; overflow-y:auto; padding-right:6px;">
            ${rest.map(renderCard).join('')}
          </div>
        `;
      }
      document.getElementById('promotionsList').innerHTML = html;
    } else {
        promoBox.style.display = 'none';
    }
  } catch (err) { console.error(err); }
}

async function ackNotification(id) {
  try {
    await fetch('/api/notify/ack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification_id: id })
    });
    loadPromotions();
  } catch {}
}
