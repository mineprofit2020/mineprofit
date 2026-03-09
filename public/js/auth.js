// Check if already logged in
fetch('/api/auth/me')
  .then(res => res.json())
  .then(data => {
    if (data.user) {
      window.location.href = '/dashboard.html';
    }
  })
  .catch(() => {});

// Login Form
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorMsg = document.getElementById('errorMsg');
    errorMsg.style.display = 'none';

    const identifier = document.getElementById('identifier').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });

      const data = await res.json();

      if (data.success) {
        window.location.href = '/dashboard.html';
      } else {
        errorMsg.textContent = data.error;
        errorMsg.style.display = 'block';
      }
    } catch (err) {
      errorMsg.textContent = 'Connection error. Please try again.';
      errorMsg.style.display = 'block';
    }
  });
}

// Register Form
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  // Pre-fill referral code from URL
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode) {
    document.getElementById('referralCode').value = refCode;
  }

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorMsg = document.getElementById('errorMsg');
    errorMsg.style.display = 'none';

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const referralCode = document.getElementById('referralCode').value.trim();

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, referralCode })
      });

      const data = await res.json();

      if (data.success) {
        window.location.href = '/dashboard.html';
      } else {
        errorMsg.textContent = data.error;
        errorMsg.style.display = 'block';
      }
    } catch (err) {
      errorMsg.textContent = 'Connection error. Please try again.';
      errorMsg.style.display = 'block';
    }
  });
}
