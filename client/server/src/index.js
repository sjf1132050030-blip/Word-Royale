require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db/database');
const { seed } = require('./db/seed');
const authRoutes = require('./routes/auth');
const learnRoutes = require('./routes/learn');
const aiRoutes = require('./routes/ai');
const adminRoutes = require('./routes/admin');

const PORT = process.env.PORT || 3001;
const CLIENT_DIST = path.resolve(__dirname, '../../dist');

async function ensureBootstrapAdmin() {
  const bcrypt = require('bcryptjs');
  const { getDb } = require('./db/database');
  const { ensureStats } = require('./services/game');
  const { get, run } = getDb();

  const email = process.env.ADMIN_EMAIL || 'admin@wordroyale.local';
  const password = process.env.ADMIN_PASSWORD || 'admin123456';
  const nickname = process.env.ADMIN_NICKNAME || 'Admin';

  const existing = get('SELECT id, is_admin FROM users WHERE email = ?', [email]);
  if (existing) {
    if (!existing.is_admin) {
      run('UPDATE users SET is_admin = 1 WHERE id = ?', [existing.id]);
      console.log(`Promoted existing user to admin: ${email}`);
    }
    return;
  }

  const anyAdmin = get('SELECT id FROM users WHERE is_admin = 1');
  if (anyAdmin) return;

  const hash = bcrypt.hashSync(password, 10);
  run(
    `INSERT INTO users (email, password_hash, nickname, is_admin) VALUES (?, ?, ?, 1)`,
    [email, hash, nickname]
  );
  const row = get('SELECT id FROM users WHERE email = ?', [email]);
  if (row) ensureStats(row.id);
  console.log(`Bootstrap admin created: ${email} / ${password}`);
}

async function main() {
  await initDb();
  await seed();
  await ensureBootstrapAdmin();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'Word Royale API',
      ai: {
        gemini: !!process.env.GEMINI_API_KEY,
        agnes: !!process.env.AGNES_API_KEY,
        qwen: process.env.OLLAMA_MODEL || 'qwen2.5:0.5b',
        ollama_base: process.env.OLLAMA_BASE_URL || 'http://117.72.54.166:11434',
        ollama_endpoint: process.env.OLLAMA_ENDPOINT || '/api/chat',
      },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', learnRoutes);

  // Serve built frontend (client/dist) and SPA fallback for Vue Router history mode
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || '服务器错误' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Word Royale http://localhost:${PORT} (API + frontend)`);
    console.log(`  static: ${CLIENT_DIST}`);
  });
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
