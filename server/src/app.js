'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { authenticate } = require('./middleware/auth');
const { errorHandler, notFound } = require('./middleware/error');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(authenticate);

app.get('/api/health', (req, res) => res.json({
  ok: true,
  platform: config.club.platform,
  club: config.club.name,
  time: new Date().toISOString(),
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/players', require('./routes/players'));
app.use('/api/sports', require('./routes/sports'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/coaches', require('./routes/coaches'));
app.use('/api', require('./routes/competitions'));      // /tournaments, /matches
app.use('/api', require('./routes/match-events'));      // ball-by-ball capture and analysis
app.use('/api', require('./routes/academy'));          // drills, session plans, benchmarks, announcements
app.use('/api', require('./routes/tracking'));         // ball tracking, fitness, templates, selection
app.use('/api', require('./routes/athlete'));          // athlete portal — separate credentials, own record only
app.use('/api', require('./routes/booking'));          // grounds, coaches and bookings — mostly public
app.use('/api/training', require('./routes/training'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/achievements', require('./routes/achievements'));
app.use('/api/media', require('./routes/media'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/analytics'));         // /dashboard, /search, /rankings, /reports, /export

// Serve the built web app in production; the API keeps its own 404 handler.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
}

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
