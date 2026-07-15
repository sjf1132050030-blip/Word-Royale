const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { getDb } = require('../db/database');
const { adminRequired } = require('../middleware/auth');
const { ensureStats, publicUser } = require('../services/game');

const router = express.Router();
router.use(adminRequired);

function parsePaging(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function userListRow(row) {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    is_admin: !!row.is_admin,
    created_at: row.created_at,
    wordbook_code: row.wordbook_code || 'cet4',
    ai_provider: row.ai_provider || 'gemini',
    stats: {
      total_xp: row.total_xp || 0,
      level: row.level || 1,
      coins: row.coins || 0,
      current_streak: row.current_streak || 0,
      longest_streak: row.longest_streak || 0,
      weekly_xp: row.weekly_xp || 0,
      hearts: row.hearts ?? 5,
      last_study_date: row.last_study_date || null,
    },
    activity: {
      sessions: row.session_count || 0,
      words_seen: row.words_seen || 0,
      words_mastered: row.words_mastered || 0,
      last_session_at: row.last_session_at || null,
    },
  };
}

/** Dashboard overview */
router.get('/overview', (_req, res) => {
  const { get, all } = getDb();
  const users = get('SELECT COUNT(*) AS c FROM users')?.c || 0;
  const admins = get('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1')?.c || 0;
  const sessions = get('SELECT COUNT(*) AS c FROM study_sessions')?.c || 0;
  const finished = get(`SELECT COUNT(*) AS c FROM study_sessions WHERE status = 'finished'`)?.c || 0;
  const words = get('SELECT COUNT(*) AS c FROM words')?.c || 0;
  const progressRows = get('SELECT COUNT(*) AS c FROM user_word_progress')?.c || 0;
  const activeToday =
    get(
      `SELECT COUNT(DISTINCT user_id) AS c FROM study_sessions
       WHERE date(started_at) = date('now')`
    )?.c || 0;
  const topXp = all(
    `SELECT u.id, u.nickname, u.email, s.total_xp, s.level, s.weekly_xp
     FROM users u
     LEFT JOIN user_stats s ON s.user_id = u.id
     ORDER BY COALESCE(s.total_xp, 0) DESC
     LIMIT 10`
  );
  const recentSessions = all(
    `SELECT ss.id, ss.user_id, u.nickname, u.email, ss.lesson_id, l.title AS lesson_title,
            ss.status, ss.correct_count, ss.wrong_count, ss.xp_earned, ss.stars,
            ss.started_at, ss.ended_at
     FROM study_sessions ss
     JOIN users u ON u.id = ss.user_id
     LEFT JOIN lessons l ON l.id = ss.lesson_id
     ORDER BY ss.id DESC
     LIMIT 15`
  );

  res.json({
    overview: {
      users,
      admins,
      sessions,
      finished_sessions: finished,
      words,
      word_progress_rows: progressRows,
      active_today: activeToday,
    },
    top_xp: topXp,
    recent_sessions: recentSessions,
  });
});

/** List users */
router.get('/users', (req, res) => {
  const { all, get } = getDb();
  const { page, pageSize, offset } = parsePaging(req.query);
  const q = String(req.query.q || '').trim();
  const params = [];
  let where = '1=1';
  if (q) {
    where += ' AND (u.email LIKE ? OR u.nickname LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  const total =
    get(`SELECT COUNT(*) AS c FROM users u WHERE ${where}`, params)?.c || 0;

  const rows = all(
    `SELECT u.id, u.email, u.nickname, u.is_admin, u.created_at, u.wordbook_code, u.ai_provider,
            s.total_xp, s.level, s.coins, s.current_streak, s.longest_streak, s.weekly_xp,
            s.hearts, s.last_study_date,
            (SELECT COUNT(*) FROM study_sessions ss WHERE ss.user_id = u.id) AS session_count,
            (SELECT COUNT(*) FROM user_word_progress uwp WHERE uwp.user_id = u.id) AS words_seen,
            (SELECT COUNT(*) FROM user_word_progress uwp
              WHERE uwp.user_id = u.id AND uwp.status = 'mastered') AS words_mastered,
            (SELECT MAX(started_at) FROM study_sessions ss WHERE ss.user_id = u.id) AS last_session_at
     FROM users u
     LEFT JOIN user_stats s ON s.user_id = u.id
     WHERE ${where}
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({
    page,
    pageSize,
    total,
    users: rows.map(userListRow),
  });
});

/** Create user */
router.post('/users', (req, res) => {
  const schema = z.object({
    email: z.string().email('邮箱格式不正确'),
    password: z.string().min(6, '密码至少 6 位'),
    nickname: z.string().min(1).max(24).optional(),
    is_admin: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { email, password, nickname, is_admin } = parsed.data;
  const { get, run } = getDb();
  if (get('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: '该邮箱已注册' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const name = nickname || email.split('@')[0];
  run(
    `INSERT INTO users (email, password_hash, nickname, is_admin) VALUES (?, ?, ?, ?)`,
    [email, hash, name, is_admin ? 1 : 0]
  );
  const row = get('SELECT * FROM users WHERE email = ?', [email]);
  ensureStats(row.id);
  res.status(201).json({ user: publicUser(row.id) });
});

/** User detail + learning profile */
router.get('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: '无效用户 ID' });

  const { get, all } = getDb();
  const row = get(
    `SELECT u.*, s.total_xp, s.level, s.coins, s.current_streak, s.longest_streak,
            s.weekly_xp, s.hearts, s.last_study_date, s.week_key
     FROM users u
     LEFT JOIN user_stats s ON s.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );
  if (!row) return res.status(404).json({ error: '用户不存在' });

  const sessionStats = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
            COALESCE(SUM(correct_count), 0) AS correct_total,
            COALESCE(SUM(wrong_count), 0) AS wrong_total,
            COALESCE(SUM(xp_earned), 0) AS xp_from_sessions,
            COALESCE(AVG(CASE WHEN status = 'finished' THEN stars END), 0) AS avg_stars,
            MAX(started_at) AS last_session_at
     FROM study_sessions WHERE user_id = ?`,
    [userId]
  );

  const wordStats = get(
    `SELECT COUNT(*) AS seen,
            SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END) AS mastered,
            SUM(CASE WHEN status = 'learning' THEN 1 ELSE 0 END) AS learning,
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_words,
            COALESCE(SUM(correct_count), 0) AS correct_answers,
            COALESCE(SUM(wrong_count), 0) AS wrong_answers
     FROM user_word_progress WHERE user_id = ?`,
    [userId]
  );

  const weakWords = all(
    `SELECT w.id, w.word, w.phonetic, w.meaning_zh, w.meaning_en,
            uwp.status, uwp.correct_count, uwp.wrong_count, uwp.last_result_at, uwp.next_review_at
     FROM user_word_progress uwp
     JOIN words w ON w.id = uwp.word_id
     WHERE uwp.user_id = ? AND uwp.wrong_count > 0
     ORDER BY uwp.wrong_count DESC, uwp.last_result_at DESC
     LIMIT 30`,
    [userId]
  );

  const recentWords = all(
    `SELECT w.id, w.word, w.phonetic, w.meaning_zh, uwp.status,
            uwp.correct_count, uwp.wrong_count, uwp.last_result_at
     FROM user_word_progress uwp
     JOIN words w ON w.id = uwp.word_id
     WHERE uwp.user_id = ?
     ORDER BY COALESCE(uwp.last_result_at, '') DESC
     LIMIT 30`,
    [userId]
  );

  const lessons = all(
    `SELECT l.id, l.title, l.sort_order, ulp.stars, ulp.best_score, ulp.times_played, ulp.completed_at
     FROM user_lesson_progress ulp
     JOIN lessons l ON l.id = ulp.lesson_id
     WHERE ulp.user_id = ?
     ORDER BY ulp.completed_at DESC, l.sort_order ASC
     LIMIT 50`,
    [userId]
  );

  const sessions = all(
    `SELECT ss.id, ss.lesson_id, l.title AS lesson_title, ss.status,
            ss.combo_max, ss.correct_count, ss.wrong_count, ss.xp_earned, ss.coins_earned,
            ss.stars, ss.started_at, ss.ended_at
     FROM study_sessions ss
     LEFT JOIN lessons l ON l.id = ss.lesson_id
     WHERE ss.user_id = ?
     ORDER BY ss.id DESC
     LIMIT 50`,
    [userId]
  );

  const quests = all(
    `SELECT udq.day_key, dq.code, dq.title, udq.progress, dq.target, udq.claimed
     FROM user_daily_quest udq
     JOIN daily_quests dq ON dq.id = udq.quest_id
     WHERE udq.user_id = ?
     ORDER BY udq.day_key DESC, dq.id ASC
     LIMIT 40`,
    [userId]
  );

  const correct = Number(sessionStats?.correct_total || 0);
  const wrong = Number(sessionStats?.wrong_total || 0);
  const answered = correct + wrong;

  res.json({
    user: publicUser(userId),
    is_admin: !!row.is_admin,
    profile: {
      sessions: {
        total: sessionStats?.total || 0,
        finished: sessionStats?.finished || 0,
        active: sessionStats?.active || 0,
        correct_total: correct,
        wrong_total: wrong,
        accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
        xp_from_sessions: sessionStats?.xp_from_sessions || 0,
        avg_stars: Math.round(Number(sessionStats?.avg_stars || 0) * 10) / 10,
        last_session_at: sessionStats?.last_session_at || null,
      },
      words: {
        seen: wordStats?.seen || 0,
        mastered: wordStats?.mastered || 0,
        learning: wordStats?.learning || 0,
        new_words: wordStats?.new_words || 0,
        correct_answers: wordStats?.correct_answers || 0,
        wrong_answers: wordStats?.wrong_answers || 0,
      },
    },
    weak_words: weakWords,
    recent_words: recentWords,
    lessons,
    sessions,
    quests,
  });
});

/** Update user fields / stats */
router.patch('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: '无效用户 ID' });

  const schema = z.object({
    nickname: z.string().min(1).max(24).optional(),
    email: z.string().email('邮箱格式不正确').optional(),
    is_admin: z.boolean().optional(),
    ai_provider: z.enum(['gemini', 'agnes', 'qwen']).optional(),
    ai_fallback: z.boolean().optional(),
    wordbook_code: z.enum(['gaokao', 'cet4', 'cet6', 'game']).optional(),
    total_xp: z.number().int().min(0).optional(),
    coins: z.number().int().min(0).optional(),
    hearts: z.number().int().min(0).max(20).optional(),
    current_streak: z.number().int().min(0).optional(),
    weekly_xp: z.number().int().min(0).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || '参数错误' });
  }

  const { get, run } = getDb();
  const row = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!row) return res.status(404).json({ error: '用户不存在' });

  const data = parsed.data;

  if (data.email && data.email !== row.email) {
    const exists = get('SELECT id FROM users WHERE email = ? AND id != ?', [data.email, userId]);
    if (exists) return res.status(409).json({ error: '该邮箱已被占用' });
  }

  // prevent removing the last admin
  if (data.is_admin === false && row.is_admin) {
    const adminCount = get('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1')?.c || 0;
    if (adminCount <= 1) {
      return res.status(400).json({ error: '不能取消最后一个管理员' });
    }
    if (req.user.id === userId) {
      return res.status(400).json({ error: '不能取消自己的管理员权限' });
    }
  }

  if (data.wordbook_code) {
    const book = get('SELECT code FROM wordbooks WHERE code = ?', [data.wordbook_code]);
    if (!book) return res.status(400).json({ error: '词库不存在' });
  }

  const nickname = data.nickname ?? row.nickname;
  const email = data.email ?? row.email;
  const is_admin = data.is_admin === undefined ? !!row.is_admin : data.is_admin;
  const ai_provider = data.ai_provider ?? row.ai_provider ?? 'gemini';
  const ai_fallback =
    data.ai_fallback === undefined
      ? row.ai_fallback === undefined || row.ai_fallback === null
        ? 1
        : row.ai_fallback
          ? 1
          : 0
      : data.ai_fallback
        ? 1
        : 0;
  const wordbook_code = data.wordbook_code ?? row.wordbook_code ?? 'cet4';

  run(
    `UPDATE users SET nickname = ?, email = ?, is_admin = ?, ai_provider = ?, ai_fallback = ?, wordbook_code = ?
     WHERE id = ?`,
    [nickname, email, is_admin ? 1 : 0, ai_provider, ai_fallback, wordbook_code, userId]
  );

  ensureStats(userId);
  const stats = get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
  const { xpToLevel } = require('../services/game');
  const total_xp = data.total_xp ?? stats.total_xp;
  const coins = data.coins ?? stats.coins;
  const hearts = data.hearts ?? stats.hearts;
  const current_streak = data.current_streak ?? stats.current_streak;
  const weekly_xp = data.weekly_xp ?? stats.weekly_xp;
  const level = xpToLevel(total_xp);
  const longest = Math.max(stats.longest_streak || 0, current_streak);

  run(
    `UPDATE user_stats SET total_xp = ?, level = ?, coins = ?, hearts = ?,
      current_streak = ?, longest_streak = ?, weekly_xp = ?
     WHERE user_id = ?`,
    [total_xp, level, coins, hearts, current_streak, longest, weekly_xp, userId]
  );

  res.json({ user: publicUser(userId), is_admin });
});

/** Reset password */
router.post('/users/:id/reset-password', (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: '无效用户 ID' });

  const schema = z.object({
    password: z.string().min(6, '密码至少 6 位').optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { get, run } = getDb();
  const row = get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!row) return res.status(404).json({ error: '用户不存在' });

  const password = parsed.data.password || `Wr${Math.random().toString(36).slice(2, 8)}!`;
  const hash = bcrypt.hashSync(password, 10);
  run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, userId]);

  res.json({ ok: true, password, message: '密码已重置' });
});

/** Delete user */
router.delete('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: '无效用户 ID' });
  if (req.user.id === userId) {
    return res.status(400).json({ error: '不能删除当前登录的管理员账号' });
  }

  const { get, run } = getDb();
  const row = get('SELECT id, is_admin FROM users WHERE id = ?', [userId]);
  if (!row) return res.status(404).json({ error: '用户不存在' });

  if (row.is_admin) {
    const adminCount = get('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1')?.c || 0;
    if (adminCount <= 1) {
      return res.status(400).json({ error: '不能删除最后一个管理员' });
    }
  }

  // explicit cleanup for older DBs without cascade reliability
  run(`DELETE FROM user_daily_quest WHERE user_id = ?`, [userId]);
  run(`DELETE FROM study_sessions WHERE user_id = ?`, [userId]);
  run(`DELETE FROM user_lesson_progress WHERE user_id = ?`, [userId]);
  run(`DELETE FROM user_word_progress WHERE user_id = ?`, [userId]);
  run(`DELETE FROM user_stats WHERE user_id = ?`, [userId]);
  run(`DELETE FROM users WHERE id = ?`, [userId]);

  res.json({ ok: true });
});

/** Session detail (browse record) */
router.get('/sessions/:id', (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) return res.status(400).json({ error: '无效对局 ID' });

  const { get } = getDb();
  const ss = get(
    `SELECT ss.*, u.nickname, u.email, l.title AS lesson_title
     FROM study_sessions ss
     JOIN users u ON u.id = ss.user_id
     LEFT JOIN lessons l ON l.id = ss.lesson_id
     WHERE ss.id = ?`,
    [sessionId]
  );
  if (!ss) return res.status(404).json({ error: '对局不存在' });

  let questions = [];
  let answers = [];
  try {
    questions = JSON.parse(ss.questions_json || '[]');
  } catch {
    questions = [];
  }
  try {
    answers = JSON.parse(ss.answers_json || '[]');
  } catch {
    answers = [];
  }

  res.json({
    session: {
      id: ss.id,
      user_id: ss.user_id,
      nickname: ss.nickname,
      email: ss.email,
      lesson_id: ss.lesson_id,
      lesson_title: ss.lesson_title,
      status: ss.status,
      combo_max: ss.combo_max,
      correct_count: ss.correct_count,
      wrong_count: ss.wrong_count,
      xp_earned: ss.xp_earned,
      coins_earned: ss.coins_earned,
      stars: ss.stars,
      started_at: ss.started_at,
      ended_at: ss.ended_at,
    },
    questions,
    answers,
  });
});

/** Global recent sessions */
router.get('/sessions', (req, res) => {
  const { all, get } = getDb();
  const { page, pageSize, offset } = parsePaging(req.query);
  const userId = req.query.user_id ? Number(req.query.user_id) : null;
  const params = [];
  let where = '1=1';
  if (userId) {
    where += ' AND ss.user_id = ?';
    params.push(userId);
  }

  const total =
    get(`SELECT COUNT(*) AS c FROM study_sessions ss WHERE ${where}`, params)?.c || 0;
  const rows = all(
    `SELECT ss.id, ss.user_id, u.nickname, u.email, ss.lesson_id, l.title AS lesson_title,
            ss.status, ss.correct_count, ss.wrong_count, ss.xp_earned, ss.coins_earned,
            ss.stars, ss.combo_max, ss.started_at, ss.ended_at
     FROM study_sessions ss
     JOIN users u ON u.id = ss.user_id
     LEFT JOIN lessons l ON l.id = ss.lesson_id
     WHERE ${where}
     ORDER BY ss.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({ page, pageSize, total, sessions: rows });
});

module.exports = router;
