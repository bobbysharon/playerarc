'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const root = path.join(__dirname, '..');

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  jwtSecret: process.env.JWT_SECRET || 'playerarc-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  databaseFile: path.resolve(root, process.env.DATABASE_FILE || './data/playerarc.db'),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  seedDemo: String(process.env.SEED_DEMO || 'true') === 'true',
  webDist: path.resolve(root, '..', 'web', 'dist'),
  club: {
    name: 'Karwan Sports Club',
    shortName: 'Karwan',
    athleteIdPrefix: 'KSC-PLY',
    platform: 'PlayerArc',
  },
};
