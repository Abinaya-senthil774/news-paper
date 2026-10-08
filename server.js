require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');


const auth = require('./src/auth');
const api = require('./src/api');
const migrate = require('./src/migrate');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render/Railway/Vercel-style proxies: trust X-Forwarded-* so
// req.protocol is "https" (used in email links) and secure cookies work.
app.set('trust proxy', 1);

app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// API
app.use('/api/auth', auth.router);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// PDF libraries served straight from node_modules (no CDN needed)
app.get('/vendor/html2canvas.min.js', (req, res) =>
  res.sendFile(require.resolve('html2canvas/dist/html2canvas.min.js'))
);
app.get('/vendor/jspdf.umd.min.js', (req, res) => res.sendFile(require.resolve('jspdf/dist/jspdf.umd.min.js')));

// Frontend
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Errors
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large to save' });
  res.status(500).json({ error: 'Something went wrong on the server' });
});

migrate()
  .catch((err) => {
    // Don't refuse to start: the old features still work without the new tables.
    console.error('⚠ Could not update the database schema:', err.message);
  })
  .finally(() => {
    app.listen(PORT, () => console.log(`☕ dʌmi News running at http://localhost:${PORT}`));
  });
