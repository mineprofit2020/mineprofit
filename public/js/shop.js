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

// Load machines
async function loadMachines() {
  try {
    const res = await fetch('/api/shop/machines');
    const data = await res.json();

    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }

    document.getElementById('shopBalance').textContent = `₹${data.balance.toFixed(2)}`;

    const grid = document.getElementById('shopGrid');
    grid.innerHTML = data.machines.map(m => {
      const isFree = m.price === 0;
      const priceToUse = m.effective_price !== undefined ? m.effective_price : m.price;
      const canAfford = data.balance >= priceToUse;

      return `
        <div class="shop-card ${isFree ? 'free-card' : ''}">
          <div class="card-icon">${m.icon}</div>
          <div class="card-name">${m.name}</div>
          <div class="card-description">${m.description}</div>
          <div class="card-stats">
            <div class="card-stat-item">
              <span class="card-stat-label">Price</span>
              <span class="card-stat-value price">
                ${isFree ? 'FREE' : (m.effective_price && m.effective_price !== m.price
                  ? `<span style="text-decoration:line-through;color:#888;margin-right:6px;">₹${m.price.toLocaleString()}</span> ₹${m.effective_price.toLocaleString()}`
                  : '₹' + m.price.toLocaleString()
                )}
              </span>
            </div>
            <div class="card-stat-item">
              <span class="card-stat-label">Earning</span>
              <span class="card-stat-value earning">₹${m.earning_per_hour}/hr</span>
            </div>
          </div>
          <div class="card-owned">You own: ${m.owned} ${m.discount && m.discount > 0 ? `<span class="tx-type-badge tx-type-bonus" style="margin-left:8px;">-${Math.round(m.discount*100)}%</span>` : ''}</div>
          ${isFree
            ? `<button class="btn btn-buy" disabled>Signup Bonus Only</button>`
            : `<button class="btn btn-buy" ${!canAfford ? 'disabled' : ''}
                onclick="openBuyModal(${m.id}, '${m.name}', ${priceToUse}, '${m.icon}', ${m.earning_per_hour})">
                ${canAfford ? `Buy for ₹${priceToUse.toLocaleString()}` : 'Insufficient Balance'}
              </button>`
          }
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load machines:', err);
    document.getElementById('shopGrid').innerHTML = '<div class="loading">Failed to load. Please refresh.</div>';
  }
}

// Modal handling
let pendingMachineId = null;

function openBuyModal(id, name, price, icon, earning) {
  pendingMachineId = id;
  document.getElementById('modalText').innerHTML = `
    Buy <strong>${icon} ${name}</strong> for <strong style="color:#f4c430;">₹${price.toLocaleString()}</strong>?<br>
    This will earn you <strong style="color:#00d26a;">₹${earning}/hr</strong> additional income.
  `;
  document.getElementById('buyModal').style.display = 'flex';
}

function closeBuyModal() {
  pendingMachineId = null;
  document.getElementById('buyModal').style.display = 'none';
}

// Confirm purchase
document.getElementById('confirmBuyBtn').addEventListener('click', async () => {
  if (!pendingMachineId) return;

  const btn = document.getElementById('confirmBuyBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    const res = await fetch('/api/shop/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId: pendingMachineId })
    });

    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      closeBuyModal();
      loadMachines(); // Refresh
    } else {
      showToast(data.error, 'error');
    }
  } catch (err) {
    showToast('Purchase failed. Try again.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Buy Now';
});

// Close modal on overlay click
document.getElementById('buyModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('buyModal')) {
    closeBuyModal();
  }
});

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
    loadMachines();
  }
})();
