const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase } = require('./db');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const shopRoutes = require('./routes/shop');
const profileRoutes = require('./routes/profile');
const spinRoutes = require('./routes/spin');
const contactRoutes = require('./routes/contact');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');
const notifyRoutes = require('./routes/notify');
const partnerRoutes = require('./routes/partner');
const gamesRoutes = require('./routes/games');
const supportRoutes = require('./routes/support');
const superRoutes = require('./routes/super');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for production (Render)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'mining-app-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/spin', spinRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/partner', partnerRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/super', superRoutes);

// Redirect root to login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Server start
(async () => {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
