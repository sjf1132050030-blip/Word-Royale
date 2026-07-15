const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db/database');
const { authRequired } = require('../middleware/auth');
const {
  ensureStats,
  ensureDailyQuests,
  bumpQuest,
  updateStreak,
  applySrs,
  buildQuestions,
  calcSettlement,
  publicUser,
  xpToLevel,
  weekKey,
  DEFAULT_HEARTS,
} = require('../services/game');
const {
  calcRoyaleLive,
  calcRoyaleFinish,
  dropZoneName,
  ROYALE_START_PLAYERS,
} = require('../services/royale');


const router = express.Router();

router.use(authRequired);

router.get('/wordbooks', (_req, res) => {
  const { all, get } = getDb();
  const books = all(
    `SELECT wb.*,
      (SELECT COUNT(*) FROM wordbook_words ww WHERE ww.wordbook_id = wb.id) AS word_count,
      (SELECT COUNT(*) FROM lessons l WHERE l.wordbook_id = wb.id) AS lesson_count
     FROM wordbooks wb
     ORDER BY wb.sort_order`
  );
  res.json({ wordbooks: books });
});

router.get('/today', (req, res) => {
  const userId = req.user.id;
  const stats = ensureStats(userId);
  const quests = ensureDailyQuests(userId);
  const { all, get } = getDb();

  const user = publicUser(userId);
  const bookCode = user.settings?.wordbook_code || 'cet4';
  let book = get('SELECT * FROM wordbooks WHERE code = ?', [bookCode]);
  if (!book) book = get('SELECT * FROM wordbooks ORDER BY sort_order LIMIT 1');

  const lessons = all(
    `SELECT l.*,
       COALESCE(ulp.stars, 0) AS stars,
       COALESCE(ulp.times_played, 0) AS times_played,
       ulp.completed_at
     FROM lessons l
     LEFT JOIN user_lesson_progress ulp
       ON ulp.lesson_id = l.id AND ulp.user_id = ?
     WHERE (? IS NULL OR l.wordbook_id = ?)
     ORDER BY l.sort_order`,
    [userId, book?.id ?? null, book?.id ?? null]
  ).map((l, idx) => ({
    ...l,
    unlocked: stats.total_xp >= l.unlock_xp || idx === 0 || l.sort_order === 1,
  }));

  const dueReview = get(
    `SELECT COUNT(*) AS c FROM user_word_progress
     WHERE user_id = ? AND next_review_at IS NOT NULL AND next_review_at <= datetime('now')`,
    [userId]
  );

  const mastered = get(
    `SELECT COUNT(*) AS c FROM user_word_progress uwp
     WHERE uwp.user_id = ? AND uwp.status = 'mastered'
       AND (? IS NULL OR uwp.word_id IN (SELECT word_id FROM wordbook_words WHERE wordbook_id = ?))`,
    [userId, book?.id ?? null, book?.id ?? null]
  );

  const wordTotal = book
    ? get(`SELECT COUNT(*) AS c FROM wordbook_words WHERE wordbook_id = ?`, [book.id])
    : get(`SELECT COUNT(*) AS c FROM words`);

  const learned = book
    ? get(
        `SELECT COUNT(*) AS c FROM user_word_progress uwp
         JOIN wordbook_words ww ON ww.word_id = uwp.word_id
         WHERE uwp.user_id = ? AND uwp.correct_count > 0 AND ww.wordbook_id = ?`,
        [userId, book.id]
      )
    : get(
        `SELECT COUNT(*) AS c FROM user_word_progress WHERE user_id = ? AND correct_count > 0`,
        [userId]
      );

  const wordbooks = all(
    `SELECT wb.*,
      (SELECT COUNT(*) FROM wordbook_words ww WHERE ww.wordbook_id = wb.id) AS word_count
     FROM wordbooks wb ORDER BY wb.sort_order`
  );

  res.json({
    user,
    quests,
    lessons,
    wordbooks,
    active_wordbook: book
      ? {
          code: book.code,
          name_zh: book.name_zh,
          name_en: book.name_en,
          description: book.description,
          word_count: wordTotal?.c || 0,
        }
      : null,
    due_review: dueReview?.c || 0,
    mastered: mastered?.c || 0,
    word_total: wordTotal?.c || 0,
    words_seen: learned?.c || 0,
  });
});

router.get('/leaderboard', (req, res) => {
  const { all } = getDb();
  const wk = weekKey();
  // ensure week keys are current for listed users is soft; query by week_key
  const rows = all(
    `SELECT u.id, u.nickname, s.weekly_xp, s.total_xp, s.level, s.current_streak
     FROM user_stats s
     JOIN users u ON u.id = s.user_id
     WHERE s.week_key = ?
     ORDER BY s.weekly_xp DESC, s.total_xp DESC
     LIMIT 30`,
    [wk]
  );
  const meIdx = rows.findIndex((r) => r.id === req.user.id);
  res.json({
    week_key: wk,
    leaderboard: rows.map((r, i) => ({
      rank: i + 1,
      user_id: r.id,
      nickname: r.nickname,
      weekly_xp: r.weekly_xp,
      total_xp: r.total_xp,
      level: r.level,
      streak: r.current_streak,
      is_me: r.id === req.user.id,
    })),
    my_rank: meIdx >= 0 ? meIdx + 1 : null,
  });
});

router.post('/lessons/:id/start', (req, res) => {
  const lessonId = Number(req.params.id);
  const userId = req.user.id;
  const { get, run, lastInsertRowid } = getDb();
  const lesson = get('SELECT * FROM lessons WHERE id = ?', [lessonId]);
  if (!lesson) return res.status(404).json({ error: '关卡不存在' });

  // optional: lesson must match user's selected book
  const user = publicUser(userId);
  if (lesson.wordbook_id) {
    const book = get('SELECT * FROM wordbooks WHERE id = ?', [lesson.wordbook_id]);
    if (book && user.settings?.wordbook_code && book.code !== user.settings.wordbook_code) {
      return res.status(403).json({
        error: `当前词库是「${user.settings.wordbook_code}」，请先切换词库或选择对应关卡`,
      });
    }
  }

  const stats = ensureStats(userId);
  if (stats.total_xp < lesson.unlock_xp && lesson.sort_order !== 1) {
    return res.status(403).json({ error: `需要 ${lesson.unlock_xp} XP 才能解锁` });
  }

  const questions = buildQuestions(lessonId);
  if (!questions.length) return res.status(400).json({ error: '关卡暂无题目' });

  // strip correctness for client; keep display text only until answered
  const clientQuestions = questions.map((q, idx) => {
    if (q.type === 'sentence_order') {
      return {
        index: idx,
        type: q.type,
        prompt: q.prompt,
        sub: q.sub,
        tokens: q.tokens,
      };
    }
    return {
      index: idx,
      type: q.type,
      prompt: q.prompt,
      sub: q.sub,
      options: q.options.map((o) => ({ key: o.key, text: o.text })),
    };
  });

  run(
    `INSERT INTO study_sessions
     (user_id, lesson_id, status, questions_json, answers_json)
     VALUES (?, ?, 'active', ?, '[]')`,
    [userId, lessonId, JSON.stringify(questions)]
  );
  const sessionId = lastInsertRowid();

  const zone = dropZoneName(lesson.title || '');
  res.json({
    session_id: sessionId,
    lesson: { id: lesson.id, title: lesson.title },
    hearts: DEFAULT_HEARTS,
    total: clientQuestions.length,
    questions: clientQuestions,
    royale: {
      mode: 'royale',
      start_players: ROYALE_START_PLAYERS,
      alive: ROYALE_START_PLAYERS,
      kills: 0,
      circle_phase: 1,
      circle_name_zh: '热身空降',
      circle_name_en: 'Drop zone',
      circle_radius: 100,
      drop_zone_zh: zone.zh,
      drop_zone_en: zone.en,
      live_rank: ROYALE_START_PLAYERS,
      feed: [
        {
          type: 'drop',
          text_zh: `🪂 空降「${zone.zh}」· 100 人局开始`,
          text_en: `🪂 Dropped at ${zone.en} · 100 players`,
        },
      ],
    },
  });
});

const answerSchema = z.object({
  session_id: z.number().int(),
  question_index: z.number().int().min(0),
  // multiple choice: key A/B/C/D ; sentence_order: array of tokens
  answer: z.union([z.string(), z.array(z.string())]),
  combo: z.number().int().min(0).optional(),
});

router.post('/answer', async (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '参数错误' });

  const userId = req.user.id;
  const { session_id, question_index, answer } = parsed.data;
  const lang = req.body.lang === 'en' ? 'en' : 'zh';
  const { get, run } = getDb();

  const session = get('SELECT * FROM study_sessions WHERE id = ? AND user_id = ?', [session_id, userId]);
  if (!session || session.status !== 'active') {
    return res.status(400).json({ error: '对局无效或已结束' });
  }

  const questions = JSON.parse(session.questions_json);
  const answers = JSON.parse(session.answers_json || '[]');
  if (question_index >= questions.length) {
    return res.status(400).json({ error: '题目索引越界' });
  }
  if (answers.some((a) => a.question_index === question_index)) {
    return res.status(400).json({ error: '该题已作答' });
  }

  const q = questions[question_index];
  let correct = false;
  let correctAnswer = null;

  if (q.type === 'sentence_order') {
    const expected = q.correct_order;
    correct =
      Array.isArray(answer) &&
      answer.length === expected.length &&
      answer.every((t, i) => t === expected[i]);
    correctAnswer = expected;
  } else {
    const opt = q.options.find((o) => o.key === answer);
    correct = !!(opt && opt.correct);
    correctAnswer = q.options.find((o) => o.correct)?.key;
  }

  let correctCount = session.correct_count;
  let wrongCount = session.wrong_count;
  let comboMax = session.combo_max;
  const prevCombo = answers.length
    ? answers[answers.length - 1].combo_after || 0
    : 0;
  const comboAfter = correct ? prevCombo + 1 : 0;
  if (comboAfter > comboMax) comboMax = comboAfter;
  if (correct) correctCount += 1;
  else wrongCount += 1;

  answers.push({
    question_index,
    answer,
    correct,
    combo_after: comboAfter,
  });

  run(
    `UPDATE study_sessions
     SET correct_count = ?, wrong_count = ?, combo_max = ?, answers_json = ?
     WHERE id = ?`,
    [correctCount, wrongCount, comboMax, JSON.stringify(answers), session_id]
  );

  if (q.word_id) applySrs(userId, q.word_id, correct);

  // Reveal ALL option meanings after choice (AI is manual — not auto-called)
  let optionsReveal = null;
  if (q.options && q.options.length) {
    optionsReveal = q.options.map((o) => ({
      key: o.key,
      text: o.text,
      word: o.word,
      meaning_zh: o.meaning_zh,
      meaning_en: o.meaning_en,
      phonetic: o.phonetic,
      pos: o.pos,
      correct: !!o.correct,
      selected: o.key === answer,
    }));
  }

  const heartsLeft = Math.max(0, DEFAULT_HEARTS - wrongCount);
  const royale = calcRoyaleLive({
    correct: correctCount,
    wrong: wrongCount,
    combo: comboAfter,
    comboMax,
    qIndex: question_index,
    totalQ: questions.length,
  });

  res.json({
    correct,
    correct_answer: correctAnswer,
    combo: comboAfter,
    combo_max: comboMax,
    hearts_left: heartsLeft,
    hearts_max: DEFAULT_HEARTS,
    correct_count: correctCount,
    wrong_count: wrongCount,
    // continue match even at 0 hearts — only finishes when questions end
    can_continue: question_index < questions.length - 1,
    explanation:
      q.type === 'sentence_order'
        ? Array.isArray(correctAnswer)
          ? correctAnswer.join(' ')
          : ''
        : q.options?.find((o) => o.correct)?.text,
    full_sentence: q.full_sentence || null,
    options_reveal: optionsReveal,
    key_word: q.key_word || null,
    royale,
  });
});

router.post('/finish', (req, res) => {
  const sessionId = Number(req.body.session_id);
  if (!sessionId) return res.status(400).json({ error: '缺少 session_id' });

  const userId = req.user.id;
  const { get, run } = getDb();
  const session = get('SELECT * FROM study_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!session) return res.status(404).json({ error: '对局不存在' });
  if (session.status === 'finished') {
    return res.json({
      already_finished: true,
      stars: session.stars,
      xp_earned: session.xp_earned,
      coins_earned: session.coins_earned,
      combo_max: session.combo_max,
      user: publicUser(userId),
    });
  }

  const questions = JSON.parse(session.questions_json);
  const answers = JSON.parse(session.answers_json || '[]');
  // auto-count unanswered as wrong for star calc
  const answeredCorrect = session.correct_count;
  const answeredWrong = session.wrong_count + (questions.length - answers.length);
  const total = questions.length;

  const royale = calcRoyaleFinish({
    correct: answeredCorrect,
    wrong: answeredWrong,
    comboMax: session.combo_max,
    total,
  });

  const settlement = calcSettlement({
    correct: answeredCorrect,
    wrong: answeredWrong,
    comboMax: session.combo_max,
    total,
    royale,
  });

  run(
    `UPDATE study_sessions
     SET status = 'finished', xp_earned = ?, coins_earned = ?, stars = ?, ended_at = datetime('now')
     WHERE id = ?`,
    [settlement.xp, settlement.coins, settlement.stars, sessionId]
  );

  const stats = ensureStats(userId);
  const newTotalXp = stats.total_xp + settlement.xp;
  const newWeekly = stats.weekly_xp + settlement.xp;
  const newCoins = stats.coins + settlement.coins;
  const newLevel = xpToLevel(newTotalXp);

  run(
    `UPDATE user_stats
     SET total_xp = ?, weekly_xp = ?, coins = ?, level = ?, week_key = ?
     WHERE user_id = ?`,
    [newTotalXp, newWeekly, newCoins, newLevel, weekKey(), userId]
  );

  const streak = updateStreak(userId);

  // lesson progress
  const prev = get(
    `SELECT * FROM user_lesson_progress WHERE user_id = ? AND lesson_id = ?`,
    [userId, session.lesson_id]
  );
  if (!prev) {
    run(
      `INSERT INTO user_lesson_progress (user_id, lesson_id, stars, best_score, times_played, completed_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))`,
      [userId, session.lesson_id, settlement.stars, settlement.xp]
    );
  } else {
    const stars = Math.max(prev.stars || 0, settlement.stars);
    const best = Math.max(prev.best_score || 0, settlement.xp);
    run(
      `UPDATE user_lesson_progress
       SET stars = ?, best_score = ?,
           times_played = times_played + 1, completed_at = datetime('now')
       WHERE user_id = ? AND lesson_id = ?`,
      [stars, best, userId, session.lesson_id]
    );
  }

  bumpQuest(userId, 'play_1', 1);
  bumpQuest(userId, 'correct_8', answeredCorrect);
  bumpQuest(userId, 'combo_5', session.combo_max, true);

  // auto-claim completed quest rewards once
  const { todayKey } = require('../services/game');
  const quests = ensureDailyQuests(userId);
  let questBonusXp = 0;
  let questBonusCoins = 0;
  for (const q of quests) {
    if (q.done && !q.claimed) {
      run(
        `UPDATE user_daily_quest SET claimed = 1
         WHERE user_id = ? AND quest_id = ? AND day_key = ?`,
        [userId, q.id, todayKey()]
      );
      questBonusXp += q.reward_xp;
      questBonusCoins += q.reward_coins;
    }
  }
  if (questBonusXp || questBonusCoins) {
    const s2 = ensureStats(userId);
    run(
      `UPDATE user_stats SET total_xp = ?, weekly_xp = ?, coins = ?, level = ? WHERE user_id = ?`,
      [
        s2.total_xp + questBonusXp,
        s2.weekly_xp + questBonusXp,
        s2.coins + questBonusCoins,
        xpToLevel(s2.total_xp + questBonusXp),
        userId,
      ]
    );
  }

  res.json({
    stars: settlement.stars,
    grade: settlement.grade,
    accuracy: settlement.accuracy,
    xp_earned: settlement.xp + questBonusXp,
    coins_earned: settlement.coins + questBonusCoins,
    combo_max: session.combo_max,
    correct_count: answeredCorrect,
    wrong_count: answeredWrong,
    streak,
    quest_bonus: { xp: questBonusXp, coins: questBonusCoins },
    royale,
    user: publicUser(userId),
    quests: ensureDailyQuests(userId),
  });
});

module.exports = router;
