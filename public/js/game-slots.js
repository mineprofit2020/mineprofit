function fNum(val, decimals = 2) {
  const num = Number(val);
  return isNaN(num) ? (0).toFixed(decimals) : num.toFixed(decimals);
}

function updateBalance(d) {
  document.getElementById('cs_balance').textContent = `₹${fNum(d.user.balance)}`;
}

async function csAuth() {
  const r = await fetch('/api/auth/me');
  const d = await r.json();
  if (!d.user) { window.location.href = '/login.html'; return null; }
  updateBalance(d);
  return d.user;
}

function setReels(reels) {
  document.getElementById('s1').textContent = reels[0];
  document.getElementById('s2').textContent = reels[1];
  document.getElementById('s3').textContent = reels[2];
}

function toggleSpinning(isSpinning) {
  const reels = [document.getElementById('s1'), document.getElementById('s2'), document.getElementById('s3')];
  reels.forEach(r => {
    if (isSpinning) {
      r.classList.add('spinning');
      r.classList.remove('winner');
    } else {
      r.classList.remove('spinning');
    }
  });
}

async function csSpin() {
  const betInput = document.getElementById('cs_bet');
  const bet = parseInt(betInput.value) || 0;
  const msg = document.getElementById('cs_msg');
  const btn = document.getElementById('spinBtn');
  
  if (bet < 10) {
    msg.className = 'error-msg';
    msg.textContent = 'Minimum bet is ₹10';
    msg.style.display = 'block';
    return;
  }

  msg.style.display = 'none';
  btn.disabled = true;
  toggleSpinning(true);

  // Fake delay for excitement
  await new Promise(resolve => setTimeout(resolve, 1500));

  try {
    const res = await fetch('/api/games/slots/spin', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ bet }) 
    });
    const data = await res.json();
    
    toggleSpinning(false);

    if (!data.success) { 
      msg.className = 'error-msg'; 
      msg.textContent = data.error || 'Failed to spin'; 
      msg.style.display = 'block'; 
    } else {
      setReels(data.reels);
      document.getElementById('cs_balance').textContent = `₹${data.newBalance.toFixed(2)}`;
      
      msg.style.display = 'block';
      if (data.win) {
        msg.className = 'success-msg';
        msg.innerHTML = `🎊 <strong>BIG WIN!</strong> You won <strong>₹${data.payout}</strong>!`;
        // Add winner class if 3 symbols match
        if (data.reels[0] === data.reels[1] && data.reels[1] === data.reels[2]) {
          [document.getElementById('s1'), document.getElementById('s2'), document.getElementById('s3')].forEach(r => r.classList.add('winner'));
        }
      } else {
        msg.className = 'error-msg';
        msg.textContent = 'Better luck next time!';
      }
    }
  } catch (err) { 
    toggleSpinning(false);
    msg.className = 'error-msg'; 
    msg.textContent = 'Connection error. Please try again.'; 
    msg.style.display = 'block'; 
  }
  btn.disabled = false;
}

(async () => { await csAuth(); })();
