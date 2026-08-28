// server/index.js
// Entry point for the Synapse backend.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const promptsRoutes = require('./routes/prompts');
const branchesRoutes = require('./routes/branches');
const testRunsRoutes = require('./routes/testRuns');
const teamRoutes = require('./routes/team');
const onboardingRoutes = require('./routes/onboarding');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_ORIGIN || `http://localhost:${PORT}` }));
app.use(express.json({ limit: '256kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// Serve the frontend (public/) as static files.
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
});
app.use('/api/prompts', promptsRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/test-runs', testRunsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/chat', chatRoutes);

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'synapse-backend' });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

// Fallback: send index.html for any non-API route (so refreshing works nicely)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Synapse backend running at http://localhost:${PORT}`);
});
