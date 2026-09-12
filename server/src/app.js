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
app.use('/api/training', require('./routes/training'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/achievements', require('./routes/achievements'));
app.use('/api/media', require('./routes/media'));
app.use('/api/admin', require('./routes/admin'));
// Cricket-only Ludimos-style additions: benchmarks, drill library, digital
// groups and messaging. /api/showcase is public (no requireAuth) by design —
// it is the shareable read-only athlete resume link.
app.use('/api/benchmarks', require('./routes/benchmarks'));
app.use('/api/drills', require('./routes/drills'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/showcase', require('./routes/showcase'));
app.use('/api', require('./routes/analytics'));         // /dashboard, /search, /rankings, /reports, /export

// Serve the built web app in production; the API keeps its own 404 handler.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
}

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
