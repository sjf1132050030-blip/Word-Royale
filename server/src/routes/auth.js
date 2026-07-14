const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { getDb } = require('../db/database');
const { signToken, authRequired } = require('../middleware/auth');
const { ensureStats, publicUser } = require('../services/game');

const router = express.Router();

const credSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少 6 位'),
  nickname: z.string().min(1).max(24).optional(),
});

router.post('/register', (req, res) => {
  const parsed = credSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { email, password, nickname } = parsed.data;
  const { get, run } = getDb();

  if (get('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: '该邮箱已注册' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const name = nickname || email.split('@')[0];
  run(`INSERT INTO users (email, password_hash, nickname) VALUES (?, ?, ?)`, [email, hash, name]);
  const row = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!row) {
    return res.status(500).json({ error: '注册失败，请重试' });
  }
  ensureStats(row.id);

  const user = publicUser(row.id);
  const token = signToken(user);
  res.status(201).json({ token, user });
});

router.post('/login', (req, res) => {
  const parsed = credSchema.omit({ nickname: true }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { email, password } = parsed.data;
  const { get } = getDb();
  const row = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  ensureStats(row.id);
  const user = publicUser(row.id);
  const token = signToken(user);
  res.json({ token, user });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user.id) });
});

router.patch('/me/settings', authRequired, (req, res) => {
  const schema = z.object({
    nickname: z.string().min(1).max(24).optional(),
    ai_provider: z.enum(['gemini', 'agnes', 'qwen']).optional(),
    ai_fallback: z.boolean().optional(),
    wordbook_code: z.enum(['gaokao', 'cet4', 'cet6', 'game']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || '参数错误' });
  }

  const { get, run } = getDb();
  const { normalizeProvider } = require('../services/ai');
  const userId = req.user.id;
  const row = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!row) return res.status(404).json({ error: '用户不存在' });

  const nickname = parsed.data.nickname ?? row.nickname;
  const ai_provider = normalizeProvider(parsed.data.ai_provider ?? row.ai_provider);
  const ai_fallback =
    parsed.data.ai_fallback === undefined
      ? row.ai_fallback === undefined || row.ai_fallback === null
        ? 1
        : row.ai_fallback
        ? 1
        : 0
      : parsed.data.ai_fallback
        ? 1
        : 0;
  let wordbook_code = parsed.data.wordbook_code ?? row.wordbook_code ?? 'cet4';
  if (parsed.data.wordbook_code) {
    const book = get('SELECT code FROM wordbooks WHERE code = ?', [parsed.data.wordbook_code]);
    if (!book) return res.status(400).json({ error: '词库不存在' });
    wordbook_code = book.code;
  }

  run(
    `UPDATE users SET nickname = ?, ai_provider = ?, ai_fallback = ?, wordbook_code = ? WHERE id = ?`,
    [nickname, ai_provider, ai_fallback, wordbook_code, userId]
  );

  res.json({ user: publicUser(userId) });
});

module.exports = router;
