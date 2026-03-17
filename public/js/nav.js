// Mobile Navigation: Bottom Tab Bar + Slide Drawer + Hamburger
(function() {
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

  // Determine active tab
  function isActive(page) { return currentPage === page ? 'active' : ''; }

  // ===== Bottom Tab Bar (5 key tabs) =====
  if (!document.querySelector('.bottom-nav')) {
    const bottomNav = document.createElement('div');
    bottomNav.className = 'bottom-nav';
    bottomNav.innerHTML = `
      <div class="bottom-nav-inner">
        <a href="/dashboard.html" class="${isActive('dashboard.html')}">
          <span class="bnav-icon">🏠</span>Home
        </a>
        <a href="/shop.html" class="${isActive('shop.html')}">
          <span class="bnav-icon">🛒</span>Shop
        </a>
        <a href="/spin.html" class="${isActive('spin.html')}">
          <span class="bnav-icon">🎡</span>Spin
        </a>
        <a href="/payment.html" class="${isActive('payment.html')}">
          <span class="bnav-icon">💳</span>Deposit
        </a>
        <a href="/profile.html" class="${isActive('profile.html')}">
          <span class="bnav-icon">👤</span>Profile
        </a>
      </div>
    `;
    document.body.appendChild(bottomNav);
  }

  // Desktop nav: ensure About Us link exists and add emojis to all links
  const navLinks = document.querySelector('.nav-links');
  if (navLinks) {
    // Ensure About Us link
    if (!Array.from(navLinks.querySelectorAll('a')).some(a => a.getAttribute('href') === '/datacenter.html')) {
      const dcLink = document.createElement('a');
      dcLink.href = '/datacenter.html';
      dcLink.textContent = 'About Us';
      const logout = Array.from(navLinks.querySelectorAll('a')).find(a => a.id === 'logoutBtn' || /logout/i.test(a.textContent));
      if (logout) navLinks.insertBefore(dcLink, logout); else navLinks.appendChild(dcLink);
    }

    // Add emojis/icons to desktop nav links
    const iconMap = {
      '/dashboard.html': '🏠',
      '/shop.html': '🛒',
      '/spin.html': '🎡',
      '/games.html': '🎮',
      '/payment.html': '💳',
      '/withdrawal.html': '💸',
      '/contact.html': '📞',
      '/profile.html': '👤',
      '/datacenter.html': 'ℹ️'
    };
    Array.from(navLinks.querySelectorAll('a')).forEach(a => {
      if (a.id === 'logoutBtn' || /logout/i.test(a.textContent)) {
        a.textContent = '🚪 Logout';
        return;
      }
      const href = a.getAttribute('href') || '';
      const icon = iconMap[href];
      if (icon) {
        // Strip any leading emoji/punctuation and extra spaces before adding our icon
        const plain = a.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim();
        a.textContent = `${icon} ${plain}`;
      }
    });
  }

  // ===== Hamburger Button =====
  const navbar = document.querySelector('.navbar');
  if (navbar && !navbar.querySelector('.nav-hamburger')) {
    const hamburger = document.createElement('button');
    hamburger.className = 'nav-hamburger';
    hamburger.innerHTML = '☰';
    hamburger.setAttribute('aria-label', 'Menu');
    hamburger.addEventListener('click', () => openDrawer());
    navbar.appendChild(hamburger);
  }

  // ===== Slide Drawer =====
  const overlay = document.createElement('div');
  overlay.className = 'mobile-drawer-overlay';
  overlay.addEventListener('click', () => closeDrawer());

  const drawer = document.createElement('div');
  drawer.className = 'mobile-drawer';
  drawer.innerHTML = `
    <div class="drawer-header">⛏️ MineProfit</div>
    <a href="/dashboard.html" class="${isActive('dashboard.html')}"><span class="drawer-icon">🏠</span> Dashboard</a>
    <a href="/shop.html" class="${isActive('shop.html')}"><span class="drawer-icon">🛒</span> Shop</a>
    <a href="/spin.html" class="${isActive('spin.html')}"><span class="drawer-icon">🎡</span> Spin Wheel</a>
    <a href="/games.html" class="${isActive('games.html')}"><span class="drawer-icon">🎮</span> Games</a>
    <div class="drawer-divider"></div>
    <a href="/payment.html" class="${isActive('payment.html')}"><span class="drawer-icon">💳</span> Deposit</a>
    <a href="/withdrawal.html" class="${isActive('withdrawal.html')}"><span class="drawer-icon">💸</span> Withdraw</a>
    <a href="/profile.html" class="${isActive('profile.html')}"><span class="drawer-icon">👤</span> Profile</a>
    <div class="drawer-divider"></div>
    <a href="/download.html" class="${isActive('download.html')}"><span class="drawer-icon">📲</span> Download App</a>
    <a href="/contact.html" class="${isActive('contact.html')}"><span class="drawer-icon">📞</span> Help & Support</a>
    <a href="/datacenter.html" class="${isActive('datacenter.html')}"><span class="drawer-icon">ℹ️</span> About Us</a>
    <div class="drawer-divider"></div>
    <a href="#" id="drawerLogoutBtn"><span class="drawer-icon">🚪</span> Logout</a>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  // Drawer logout
  const drawerLogout = document.getElementById('drawerLogoutBtn');
  if (drawerLogout) {
    drawerLogout.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }

  function openDrawer() {
    overlay.classList.add('open');
    drawer.classList.add('open');
  }

  function closeDrawer() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
  }
})();
