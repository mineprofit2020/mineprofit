async function lnAuth() {
  const r = await fetch('/api/auth/me');
  const d = await r.json();
  if (!d.user) { window.location.href = '/login.html'; return null; }
  document.getElementById('ln_balance').textContent = `₹${d.user.balance.toFixed(2)}`;
  return d.user;
}

function initNumbers() {
  const grid = document.getElementById('numbersGrid');
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('div');
    btn.className = 'number-btn';
    if (i === 7) btn.classList.add('selected'); // Default pick
    btn.textContent = i;
    btn.onclick = () => {
      document.querySelectorAll('.number-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('ln_pick').value = i;
    };
    grid.appendChild(btn);
  }
}

async function lnPlay() {
  const bet = parseInt(document.getElementById('ln_bet').value) || 0;
  const pick = parseInt(document.getElementById('ln_pick').value);
  const msg = document.getElementById('ln_msg');
  const resultVal = document.getElementById('ln_result_val');
  const btn = document.getElementById('playBtn');

  if (bet < 10) {
    msg.className = 'error-msg';
    msg.textContent = 'Minimum bet is ₹10';
    msg.style.display = 'block';
    return;
  }

  msg.style.display = 'none';
  btn.disabled = true;
  resultVal.textContent = '?';
  
  // Animation effect
  let count = 0;
  const interval = setInterval(() => {
    resultVal.textContent = Math.floor(Math.random() * 10) + 1;
    count++;
    if (count > 15) clearInterval(interval);
  }, 100);

  await new Promise(resolve => setTimeout(resolve, 1600));

  try {
    const res = await fetch('/api/games/lucky/play', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ bet, pick }) 
    });
    const data = await res.json();
    
    if (!data.success) { 
      msg.className = 'error-msg'; 
      msg.textContent = data.error || 'Failed'; 
      msg.style.display = 'block'; 
      resultVal.textContent = '?';
    } else {
      resultVal.textContent = data.drawn;
      document.getElementById('ln_balance').textContent = `₹${data.newBalance.toFixed(2)}`;
      
      msg.style.display = 'block';
      if (data.win) {
        msg.className = 'success-msg';
        msg.innerHTML = `🎯 <strong>MATCHED!</strong> You won <strong>₹${data.payout}</strong>!`;
        // Highlight the winning button
        document.querySelectorAll('.number-btn').forEach(b => {
          if (parseInt(b.textContent) === data.drawn) b.classList.add('winning');
        });
      } else {
        msg.className = 'error-msg';
        msg.textContent = `Better luck next time! The number was ${data.drawn}.`;
      }
    }
  } catch { 
    msg.className = 'error-msg'; 
    msg.textContent = 'Failed'; 
    msg.style.display = 'block'; 
  }
  btn.disabled = false;
}

(async () => { 
  await lnAuth(); 
  initNumbers();
})();
