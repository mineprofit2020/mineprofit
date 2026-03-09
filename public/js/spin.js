function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
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

let spinCost = 200;
let prizes = [];
let isSpinning = false;
let currentRotation = 0; // Persistent rotation state

async function initSpin() {
  try {
    const res = await fetch('/api/spin/status');
    const data = await res.json();
    if (data.error) return;

    spinCost = data.spinCost;
    const costEl = document.getElementById('spinCostDisplay') || document.getElementById('spinCost');
    if (costEl) costEl.textContent = spinCost;
    
    // Update Bundles with prices
    const bundleGrid = document.getElementById('bundleGrid');
    if (bundleGrid) {
        const b5 = Math.round(5 * spinCost * 0.95);
        const b10 = Math.round(10 * spinCost * 0.90);
        const b20 = Math.round(20 * spinCost * 0.85);
        
        bundleGrid.innerHTML = `
          <button class="bundle-btn" onclick="buyBundle(5, ${b5})">
            <div class="bundle-count">5 SPINS</div>
            <div class="bundle-price">₹${b5}</div>
            <div class="bundle-badge">-5%</div>
          </button>
          <button class="bundle-btn" onclick="buyBundle(10, ${b10})">
            <div class="bundle-count">10 SPINS</div>
            <div class="bundle-price">₹${b10}</div>
            <div class="bundle-badge">-10%</div>
          </button>
          <button class="bundle-btn" onclick="buyBundle(20, ${b20})">
            <div class="bundle-count">20 SPINS</div>
            <div class="bundle-price">₹${b20}</div>
            <div class="bundle-badge">-15%</div>
          </button>
        `;
    }
    
    // Sync prizes from backend
    prizes = data.prizes || [];
    drawWheel(currentRotation);
    
    renderHistory(data.history);
    renderRecentWins(data.recentWins);
    
    // Update duplicate IDs if they exist (spinBalance/freeSpins are used in 2 places in old HTML, but we removed one set)
    // Use querySelectorAll to be safe or just standard ID which picks first
    const balEls = document.querySelectorAll('#spinBalance');
    balEls.forEach(el => el.textContent = `₹${data.balance.toFixed(2)}`);
    
    const spinEls = document.querySelectorAll('#freeSpins');
    spinEls.forEach(el => el.textContent = data.freeSpins);

  } catch (err) { console.error(err); }
}

function renderRecentWins(wins) {
    const winnersEl = document.getElementById('recentWinners');
    if (!winnersEl) return;
    if (!wins || wins.length === 0) {
      winnersEl.innerHTML = '<div class="no-transactions">No winners yet — be the first!</div>';
    } else {
      winnersEl.innerHTML = wins.map(w => `
        <div class="winner-card">
          <div class="winner-name">🏆 ${w.username}</div>
          <div class="winner-prize">Won <strong>${w.prize_value}</strong></div>
          <div class="winner-date">${formatDate(w.created_at)}</div>
        </div>
      `).join('');
    }
}

function renderHistory(history) {
    const historyEl = document.getElementById('spinHistory');
    if (!historyEl) return;
    if (!history || history.length === 0) {
      historyEl.innerHTML = '<div class="no-transactions">No spins yet — try your luck!</div>';
    } else {
      historyEl.innerHTML = history.map(h => `
        <div class="transaction-item">
          <div class="tx-info">
            <div class="tx-description">
              Won: ${h.prize_value}
              <span class="tx-type-badge tx-type-${h.prize_type === 'machine' ? 'mining' : 'bonus'}">${h.prize_type}</span>
            </div>
            <div class="tx-date">${formatDate(h.created_at)}</div>
          </div>
        </div>
      `).join('');
    }
}

// Draw wheel dynamically based on prizes
function drawWheel(rotation = 0) {
  const canvas = document.getElementById('wheelCanvas');
  const ctx = canvas.getContext('2d');
  const count = prizes.length > 0 ? prizes.length : 8;
  const arc = Math.PI * 2 / count;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = cx; // Use full radius
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const colors = ['#e94560', '#16213e', '#0f3460', '#533483', '#e94560', '#16213e', '#0f3460', '#533483'];

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);

  for (let i = 0; i < count; i++) {
    const angle = i * arc;
    ctx.fillStyle = prizes.length > 0 && prizes[i].color ? prizes[i].color : colors[i % colors.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + arc);
    ctx.lineTo(cx, cy);
    ctx.fill();
    ctx.stroke();

    if (prizes.length > 0) {
        ctx.save();
        ctx.translate(cx + Math.cos(angle + arc / 2) * (radius * 0.75), cy + Math.sin(angle + arc / 2) * (radius * 0.75));
        ctx.rotate(angle + arc / 2 + Math.PI / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Poppins';
        const text = prizes[i].label.split(' ');
        text.forEach((line, n) => {
          ctx.fillText(line, -ctx.measureText(line).width / 2, n * 14);
        });
        ctx.restore();
    }
  }
  ctx.restore();
}

async function spinWheel(type) {
  if (isSpinning) return;
  
  // Logic based on type
  const endpoint = type === 'free' ? '/api/spin/play' : '/api/spin/buy';
  
  if (type === 'paid') {
     // Check balance (optional client side check)
     // ...
     if (!confirm(`Spend ₹${spinCost} for a spin?`)) return;
  } else {
     // Check free spins
     const freeSpins = parseInt(document.getElementById('freeSpins').textContent || '0');
     if (freeSpins <= 0) {
       alert('No free spins available!');
       return;
     }
  }

  isSpinning = true;
  document.querySelectorAll('.action-btn').forEach(b => b.disabled = true);

  try {
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();

    if (data.error) {
      alert(data.error);
      isSpinning = false;
      document.querySelectorAll('.action-btn').forEach(b => b.disabled = false);
      return;
    }

    const prizeIndex = prizes.findIndex(p => p.label === data.prize.label);
    // If prize not found, default to 0
    const targetIndex = prizeIndex === -1 ? 0 : prizeIndex;
    
    const count = prizes.length > 0 ? prizes.length : 8;
    const arc = Math.PI * 2 / count;
    // Rotate so the segment is at the top (3*PI/2)
    // Segment i is from i*arc to (i+1)*arc
    // Center of segment is (i+0.5)*arc
    // We want (currentRotation + targetRotation) + center = 3*PI/2 + 2*PI*N
    const targetRotation = 3 * Math.PI / 2 - (targetIndex + 0.5) * arc + Math.PI * 2 * 5;
    const startRotation = currentRotation;
    const totalSpin = targetRotation;
    
    const duration = 5000;
    const start = performance.now();
    
    function animate(time) {
      const elapsed = time - start;
      if (elapsed < duration) {
        const t = elapsed / duration;
        const ease = 1 - Math.pow(1 - t, 3);
        currentRotation = startRotation + totalSpin * ease;
        
        drawWheel(currentRotation);
        
        requestAnimationFrame(animate);
      } else {
        currentRotation = startRotation + totalSpin;
        drawWheel(currentRotation);
        
        isSpinning = false;
        document.querySelectorAll('.action-btn').forEach(b => b.disabled = false);
        // Show result
        const prizeRes = document.getElementById('prizeResult');
        document.getElementById('prizeValue').textContent = data.prize.label;
        prizeRes.style.display = 'block';
        setTimeout(() => { prizeRes.style.display = 'none'; }, 3000);
        
        initSpin();
      }
    }
    requestAnimationFrame(animate);

  } catch (err) {
    console.error(err);
    isSpinning = false;
    document.querySelectorAll('.action-btn').forEach(b => b.disabled = false);
  }
}

// Remove old listener
const spinBtn = document.getElementById('spinBtn');
if (spinBtn) {
    // No op, we use onclick in HTML
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
    initSpin();
  }
})();

async function buyBundle(count, price) {
  if (!confirm(`Buy ${count} spins bundle for ₹${price}?`)) return;
  
  try {
    const res = await fetch('/api/spin/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count })
    });
    const data = await res.json();
    
    if (data.error) {
      alert(data.error);
      return;
    }
    
    // Animate wheel briefly for bundle
    let bundleAngle = 0;
    const startRotation = currentRotation;
    
    const animateBundle = () => {
      bundleAngle += 0.2;
      currentRotation = startRotation + bundleAngle;
      drawWheel(currentRotation);
      if (document.getElementById('bundleModal').style.display === 'none') {
        requestAnimationFrame(animateBundle);
      }
    };
    // Start animation before showing result
    document.getElementById('bundleModal').style.display = 'none'; // Ensure hidden initially
    requestAnimationFrame(animateBundle);
    
    // Simulate delay
    setTimeout(() => {
        // Note: the animation continues until modal is shown
        const container = document.getElementById('bundleResults');
        if (container) {
            container.innerHTML = data.results.map(r => `
              <div class="user-card" style="padding:16px; border:${r.type === 'lose' ? '1px solid #ef4444' : '1px solid #10b981'}; text-align:center;">
                <div style="font-size:2.5rem; margin-bottom:8px;">${r.type === 'machine' ? '🏭' : r.type === 'balance' ? '💰' : '💣'}</div>
                <div style="font-weight:bold; color:var(--text-primary);">${r.label || r.desc}</div>
                <div style="font-size:0.85rem; color:var(--text-secondary);">${r.desc}</div>
              </div>
            `).join('');
        }
        
        const modal = document.getElementById('bundleModal');
        if (modal) modal.style.display = 'block';
    }, 1500); // 1.5s spin animation
    
  } catch (err) { console.error(err); }
}

function closeBundleModal() {
  const modal = document.getElementById('bundleModal');
  if (modal) modal.style.display = 'none';
  initSpin();
}