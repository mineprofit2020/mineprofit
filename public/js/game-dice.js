async function drAuth() {
  const r = await fetch('/api/auth/me');
  const d = await r.json();
  if (!d.user) { window.location.href = '/login.html'; return null; }
  document.getElementById('dr_balance').textContent = `₹${d.user.balance.toFixed(2)}`;
  return d.user;
}

const diceFaces = ['🎲', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function getDiceHtml(n, large = false) {
  const dots = '<div class="dot"></div>'.repeat(9);
  return `<div class="dice-face ${large ? 'large' : ''} side-${n}">${dots}</div>`;
}

function pickDice(val) {
  document.querySelectorAll('.dice-btn').forEach((btn, idx) => {
    if (idx + 1 === val) btn.classList.add('selected');
    else btn.classList.remove('selected');
  });
  document.getElementById('dr_pick').value = val;
}

async function drPlay() {
  const bet = parseInt(document.getElementById('dr_bet').value) || 0;
  const pick = parseInt(document.getElementById('dr_pick').value);
  const msg = document.getElementById('dr_msg');
  const diceEl = document.getElementById('d');
  const btn = document.getElementById('rollBtn');

  if (bet < 10) {
    msg.className = 'error-msg';
    msg.textContent = 'Minimum bet is ₹10';
    msg.style.display = 'block';
    return;
  }

  msg.style.display = 'none';
  btn.disabled = true;
  diceEl.classList.add('rolling');

  // Animation
  let count = 0;
  const interval = setInterval(() => {
    const randomFace = Math.floor(Math.random() * 6) + 1;
    diceEl.innerHTML = getDiceHtml(randomFace, true);
    count++;
    if (count > 15) clearInterval(interval);
  }, 100);

  await new Promise(resolve => setTimeout(resolve, 1600));

  try {
    const res = await fetch('/api/games/dice/play', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ bet, pick }) 
    });
    const data = await res.json();
    
    diceEl.classList.remove('rolling');

    if (!data.success) { 
      msg.className = 'error-msg'; 
      msg.textContent = data.error || 'Failed'; 
      msg.style.display = 'block'; 
      diceEl.innerHTML = getDiceHtml(1, true);
    } else {
      diceEl.innerHTML = getDiceHtml(data.roll, true);
      document.getElementById('dr_balance').textContent = `₹${data.newBalance.toFixed(2)}`;
      
      msg.style.display = 'block';
      if (data.win) {
        msg.className = 'success-msg';
        msg.innerHTML = `🎉 <strong>WINNER!</strong> The dice rolled ${data.roll}. You won <strong>₹${data.payout}</strong>!`;
        diceEl.style.transform = 'scale(1.1)';
        setTimeout(() => diceEl.style.transform = 'scale(1)', 500);
      } else {
        msg.className = 'error-msg';
        msg.textContent = `Hard luck! The dice rolled ${data.roll}.`;
      }
    }
  } catch { 
    diceEl.classList.remove('rolling');
    msg.className = 'error-msg'; 
    msg.textContent = 'Failed to connect'; 
    msg.style.display = 'block'; 
  }
  btn.disabled = false;
}