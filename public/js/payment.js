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

let gateways = [];
let tokens = [];
let cryptoAddresses = {};

function startDepositNews() {
  const el = document.getElementById('depositNewsBar');
  if (!el) return;

  const names = ['Amit', 'Rohit', 'Neha', 'Priya', 'Sahil', 'Kiran', 'Ankit', 'Simran', 'Vikas', 'Pooja'];
  const methods = ['UPI', 'BANK', 'CRYPTO'];
  const amounts = [100, 200, 300, 500, 800, 1000, 1500, 2000, 2500, 3000];

  const tick = () => {
    const n = names[Math.floor(Math.random() * names.length)];
    const m = methods[Math.floor(Math.random() * methods.length)];
    const a = amounts[Math.floor(Math.random() * amounts.length)];
    const mins = Math.floor(Math.random() * 25) + 1;
    el.innerHTML = `<div>📥 <strong>${n}</strong> deposited <strong>₹${a}</strong> via <strong>${m}</strong></div><div class="news-meta">${mins} min ago</div>`;
  };

  tick();
  if (window.__depositNewsTimer) clearInterval(window.__depositNewsTimer);
  window.__depositNewsTimer = setInterval(tick, 10000);
}

function renderDepositInstructions(mode) {
  const box = document.getElementById('depositInstructions');
  if (!box) return;

  const title = mode === 'upi' ? '📱 UPI Deposit Instructions'
    : mode === 'bank' ? '🏦 Bank Deposit Instructions'
    : '🪙 Crypto Deposit Instructions';

  const steps = mode === 'upi'
    ? [
        ['Step 1', 'Scan the QR code or copy the UPI ID.'],
        ['Step 2', 'Send the amount from your UPI app.'],
        ['Step 3', 'After payment, enter the amount and UTR/Transaction ID in the form.'],
        ['Step 4', 'Click Confirm Payment and wait for approval.']
      ]
    : mode === 'bank'
    ? [
        ['Step 1', 'Select a bank gateway and note the account details.'],
        ['Step 2', 'Transfer money using NEFT/IMPS/RTGS.'],
        ['Step 3', 'Enter the amount and UTR/Reference number in the form.'],
        ['Step 4', 'Click Confirm Payment and wait for approval.']
      ]
    : [
        ['Step 1', 'Select the token and copy the wallet address (or scan QR).'],
        ['Step 2', 'Send crypto from your wallet/exchange.'],
        ['Step 3', 'Paste the TXID/Transaction Hash in the form and enter the USDT amount sent.'],
        ['Step 4', 'Click Confirm Payment and wait for approval.']
      ];

  box.innerHTML = `
    <div class="admin-item-header">${title}</div>
    <div class="instruction-steps">
      ${steps.map(([k, v]) => `<div class="instruction-step"><strong>${k}:</strong> <span>${v}</span></div>`).join('')}
    </div>
  `;
}

let usdtRate = 101; // Default fallback

function switchCrypto(symbol, btn) {
  document.querySelectorAll('.crypto-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('cryptoAddr').textContent = cryptoAddresses[symbol] || '';
  document.getElementById('cryptoToken').value = symbol;
  try {
    if (Array.isArray(tokens) && tokens.length) {
      const tok = tokens.find(t => t.symbol === symbol);
      const cryptoQrBox = document.querySelector('.crypto-address-section .qr-box');
      if (cryptoQrBox) cryptoQrBox.innerHTML = tok && tok.qr_url ? `<img src="${tok.qr_url}" style="max-width:160px;max-height:160px;border-radius:8px;">` : '<div style="font-size:4rem;margin-bottom:8px;">🪙</div>';
    }
  } catch {}
}

function calculateCryptoINR() {
  const usdt = parseFloat(document.getElementById('cryptoUSDT').value) || 0;
  const inr = Math.floor(usdt * usdtRate);
  document.getElementById('cryptoAmount').value = inr > 0 ? inr : '';
  document.getElementById('cryptoPreview').textContent = `≈ ₹${inr}`;
}

function copyText(elementId) {
  const text = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied!', 'success');
  });
}

async function submitPayment(type) {
  let amount, method, transaction_ref, gateway_id = null, token_symbol = null;

  if (type === 'upi') {
    amount = parseFloat(document.getElementById('upiAmount').value);
    method = 'upi';
    gateway_id = parseInt(document.getElementById('upiGatewayId').value) || null;
    transaction_ref = document.getElementById('upiRef').value.trim();
  } else if (type === 'bank') {
    amount = parseFloat(document.getElementById('bankAmount').value);
    method = 'bank';
    gateway_id = parseInt(document.getElementById('bankGatewayId').value) || null;
    transaction_ref = document.getElementById('bankRef').value.trim();
  } else {
    // For crypto, ensure we calculate INR correctly
    calculateCryptoINR();
    amount = parseFloat(document.getElementById('cryptoAmount').value);
    method = 'crypto';
    token_symbol = document.getElementById('cryptoToken').value;
    transaction_ref = document.getElementById('cryptoRef').value.trim();
  }

  if (!amount || amount < 100) {
    showToast('Minimum deposit is ₹100', 'error');
    return;
  }

  if (!transaction_ref || transaction_ref.length < 4) {
    showToast('Please enter a valid transaction reference', 'error');
    return;
  }

  // Auto-select first gateway if none selected (UX fix)
  if ((type === 'upi' || type === 'bank') && !gateway_id) {
    const sel = document.getElementById(type === 'upi' ? 'upiGateway' : 'bankGateway');
    if (sel && sel.options.length > 0) {
      gateway_id = parseInt(sel.value);
    } else {
      showToast('No payment gateway available', 'error');
      return;
    }
  }

  const submitBtn = document.querySelector(`.payment-method-card[data-tab="${type}"] button`);
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/payment/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method, transaction_ref, gateway_id, token_symbol })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      if (type === 'upi') {
        document.getElementById('upiAmount').value = '';
        document.getElementById('upiRef').value = '';
      } else if (type === 'bank') {
        document.getElementById('bankAmount').value = '';
        document.getElementById('bankRef').value = '';
      } else {
        document.getElementById('cryptoAmount').value = '';
        document.getElementById('cryptoRef').value = '';
      }
      loadPaymentData();
    } else {
      showToast(data.error, 'error');
    }
  } catch {
    showToast('Payment submission failed', 'error');
  }
  if (submitBtn) submitBtn.disabled = false;
}

async function loadPaymentData() {
  try {
    const res = await fetch('/api/payment/info');
    const data = await res.json();

    if (res.status === 401) { window.location.href = '/login.html'; return; }
    document.getElementById('paymentBalance').textContent = `₹${fNum(data.balance)}`;
    renderPayments(data.payments);  gateways = data.gateways || [];
    tokens = data.tokens || [];
    if (data.settings && data.settings.usdt_inr_rate) {
      usdtRate = parseFloat(data.settings.usdt_inr_rate) || 101;
      const rateEl = document.getElementById('usdtRateDisplay');
      if (rateEl) rateEl.textContent = `1 USDT = ₹${usdtRate} INR`;
    }

    const modeSel = document.getElementById('payMode');
    const upiGateSel = document.getElementById('upiGateway');
    const bankGateSel = document.getElementById('bankGateway');
    const upiGateways = gateways.filter(g => g.method === 'upi');
    const bankGateways = gateways.filter(g => g.method === 'bank');
    upiGateSel.innerHTML = upiGateways.map(g => `<option value="${g.id}">${g.label} — ${g.upi_id||''}</option>`).join('');
    bankGateSel.innerHTML = bankGateways.map(g => `<option value="${g.id}">${g.label} — ${g.bank_name||''}</option>`).join('');

    function setUpiFromSelect() {
      const id = parseInt(upiGateSel.value);
      const gw = upiGateways.find(x => x.id === id) || upiGateways[0];
      if (!gw) return;
      document.getElementById('upiId').textContent = gw.upi_id || '';
      const nm = document.getElementById('upiName');
      if (nm) nm.textContent = gw.upi_name || '';
      const upiQrBox = document.querySelector('.payment-qr-section .qr-box');
      if (upiQrBox) upiQrBox.innerHTML = gw.qr_url ? `<img src="${gw.qr_url}" style="max-width:160px;max-height:160px;border-radius:8px;">` : '<div style="font-size:4rem;margin-bottom:8px;">📱</div>';
      document.getElementById('upiGatewayId').value = gw.id;
    }
    function setBankFromSelect() {
      const id = parseInt(bankGateSel.value);
      const gw = bankGateways.find(x => x.id === id) || bankGateways[0];
      if (!gw) return;
      document.getElementById('bankAccName').textContent = gw.bank_account_name || '';
      document.getElementById('bankAccNo').textContent = gw.bank_account_number || '';
      document.getElementById('bankIFSC').textContent = gw.bank_ifsc || '';
      document.getElementById('bankName').textContent = gw.bank_name || '';
      document.getElementById('bankGatewayId').value = gw.id;
    }
    upiGateSel.onchange = setUpiFromSelect;
    bankGateSel.onchange = setBankFromSelect;
    setUpiFromSelect();
    setBankFromSelect();
    renderDepositInstructions(modeSel.value);

    const cryptoTabs = document.getElementById('cryptoTabs');
    cryptoAddresses = {};
    cryptoTabs.innerHTML = tokens.map((t, i) => `<button class="crypto-tab ${i===0?'active':''}" onclick="switchCrypto('${t.symbol}', this)">${t.symbol}</button>`).join('');
    tokens.forEach(tok => { cryptoAddresses[tok.symbol] = tok.address; });
    if (tokens.length > 0) {
      switchCrypto(tokens[0].symbol);
      const cryptoQrBox = document.querySelector('.crypto-address-section .qr-box');
      if (cryptoQrBox) cryptoQrBox.innerHTML = tokens[0].qr_url ? `<img src="${tokens[0].qr_url}" style="max-width:160px;max-height:160px;border-radius:8px;">` : '<div style="font-size:4rem;margin-bottom:8px;">🪙</div>';
    }

    const list = document.getElementById('paymentHistory');
    if (data.payments.length === 0) {
      list.innerHTML = '<div class="no-transactions">No deposits yet</div>';
    } else {
      list.innerHTML = data.payments.map(p => `
        <div class="transaction-item">
          <div class="tx-info">
            <div class="tx-description">
              Deposit via ${p.method.toUpperCase()} — Ref: ${p.transaction_ref}
              <span class="tx-type-badge tx-type-${p.status === 'approved' ? 'mining' : p.status === 'rejected' ? 'purchase' : 'bonus'}">${p.status}</span>
            </div>
            <div class="tx-date">${formatDate(p.created_at)}</div>
          </div>
          <div class="tx-amount positive">+₹${fNum(p.amount)}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load payment data:', err);
  }
}

function selectMode(mode) {
  document.getElementById('payMode').value = mode;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
  document.getElementById('mode-' + mode).classList.add('active');
  
  const upi = document.getElementById('upiCard');
  const bank = document.getElementById('bankCard');
  const crypto = document.getElementById('cryptoCard');
  if (upi) upi.style.display = mode === 'upi' ? 'block' : 'none';
  if (bank) bank.style.display = mode === 'bank' ? 'block' : 'none';
  if (crypto) crypto.style.display = mode === 'crypto' ? 'block' : 'none';
  renderDepositInstructions(mode);
  updateBonusBanner(mode);
}

function updateBonusBanner(mode) {
  const banner = document.getElementById('bonusBanner');
  const txt = document.getElementById('bonusText');
  if (!banner || !txt) return;

  if (mode === 'crypto') {
    banner.style.display = 'block';
    txt.innerHTML = `
      Get <strong>1% Bonus</strong> on $100+ deposits<br>
      Get <strong>2% Bonus</strong> on $200+ deposits<br>
      Get <strong>5% Bonus</strong> on $500+ deposits!
    `;
  } else {
    // UPI or Bank
    banner.style.display = 'block';
    txt.innerHTML = `
      Get <strong>1% Extra</strong> on ₹10,000+<br>
      Get <strong>2% Extra</strong> on ₹20,000+<br>
      Get <strong>5% Extra</strong> on ₹50,000+!
    `;
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
    startDepositNews();
    loadPaymentData();
    const m = document.getElementById('payMode').value;
    renderDepositInstructions(m);
    updateBonusBanner(m);
  }
})();
