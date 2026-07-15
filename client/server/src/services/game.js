const { getDb } = require('../db/database');

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function xpToLevel(totalXp) {
  return Math.floor(Math.sqrt(totalXp / 50)) + 1;
}

function ensureStats(userId) {
  const { get, run } = getDb();
  let stats = get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
  if (!stats) {
    run(
      `INSERT INTO user_stats (user_id, total_xp, level, coins, current_streak, longest_streak, weekly_xp, week_key)
       VALUES (?, 0, 1, 0, 0, 0, 0, ?)`,
      [userId, weekKey()]
    );
    stats = get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
  }
  // reset weekly if needed
  const wk = weekKey();
  if (stats.week_key !== wk) {
    run(`UPDATE user_stats SET weekly_xp = 0, week_key = ? WHERE user_id = ?`, [wk, userId]);
    stats = get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
  }
  return stats;
}

function ensureDailyQuests(userId) {
  const { all, get, run } = getDb();
  const day = todayKey();
  const quests = all('SELECT * FROM daily_quests');
  return quests.map((q) => {
    let row = get(
      `SELECT * FROM user_daily_quest WHERE user_id = ? AND quest_id = ? AND day_key = ?`,
      [userId, q.id, day]
    );
    if (!row) {
      run(
        `INSERT INTO user_daily_quest (user_id, quest_id, day_key, progress, claimed)
         VALUES (?, ?, ?, 0, 0)`,
        [userId, q.id, day]
      );
      row = get(
        `SELECT * FROM user_daily_quest WHERE user_id = ? AND quest_id = ? AND day_key = ?`,
        [userId, q.id, day]
      );
    }
    return {
      id: q.id,
      code: q.code,
      title: q.title,
      target: q.target,
      progress: Math.min(row.progress, q.target),
      claimed: !!row.claimed,
      reward_xp: q.reward_xp,
      reward_coins: q.reward_coins,
      done: row.progress >= q.target,
    };
  });
}

function bumpQuest(userId, code, amount = 1, setMax = false) {
  const { get, run } = getDb();
  const day = todayKey();
  const quest = get('SELECT * FROM daily_quests WHERE code = ?', [code]);
  if (!quest) return;
  ensureDailyQuests(userId);
  const row = get(
    `SELECT * FROM user_daily_quest WHERE user_id = ? AND quest_id = ? AND day_key = ?`,
    [userId, quest.id, day]
  );
  if (!row || row.claimed) return;
  const next = setMax ? Math.max(row.progress, amount) : row.progress + amount;
  run(
    `UPDATE user_daily_quest SET progress = ? WHERE user_id = ? AND quest_id = ? AND day_key = ?`,
    [next, userId, quest.id, day]
  );
}

function updateStreak(userId) {
  const { get, run } = getDb();
  const stats = ensureStats(userId);
  const today = todayKey();
  const last = stats.last_study_date;

  if (last === today) {
    return stats.current_streak;
  }

  let streak = 1;
  if (last) {
    const lastDate = new Date(last + 'T00:00:00Z');
    const todayDate = new Date(today + 'T00:00:00Z');
    const diffDays = Math.round((todayDate - lastDate) / 86400000);
    if (diffDays === 1) streak = (stats.current_streak || 0) + 1;
  }

  const longest = Math.max(stats.longest_streak || 0, streak);
  run(
    `UPDATE user_stats SET current_streak = ?, longest_streak = ?, last_study_date = ? WHERE user_id = ?`,
    [streak, longest, today, userId]
  );
  return streak;
}

function applySrs(userId, wordId, correct) {
  const { get, run } = getDb();
  let p = get(
    `SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ?`,
    [userId, wordId]
  );
  const now = new Date().toISOString();
  if (!p) {
    run(
      `INSERT INTO user_word_progress
       (user_id, word_id, status, ease, interval_days, repetitions, next_review_at, correct_count, wrong_count, last_result_at)
       VALUES (?, ?, 'learning', 2.5, 0, 0, ?, 0, 0, ?)`,
      [userId, wordId, now, now]
    );
    p = get(`SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ?`, [userId, wordId]);
  }

  let ease = p.ease;
  let interval = p.interval_days;
  let reps = p.repetitions;
  let correctCount = p.correct_count;
  let wrongCount = p.wrong_count;
  let status = p.status;

  if (correct) {
    correctCount += 1;
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.max(1, Math.round(interval * ease));
    ease = Math.min(3.0, ease + 0.05);
    status = interval >= 21 ? 'mastered' : 'review';
  } else {
    wrongCount += 1;
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    status = 'learning';
  }

  const next = new Date();
  next.setDate(next.getDate() + (correct ? interval : 0));
  if (!correct) next.setHours(next.getHours() + 4);

  run(
    `UPDATE user_word_progress
     SET status = ?, ease = ?, interval_days = ?, repetitions = ?,
         next_review_at = ?, correct_count = ?, wrong_count = ?, last_result_at = ?
     WHERE user_id = ? AND word_id = ?`,
    [status, ease, interval, reps, next.toISOString(), correctCount, wrongCount, now, userId, wordId]
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function packOption(wordRow, correct, displayMode) {
  // displayMode: 'meaning' shows Chinese meaning as choice text; 'word' shows English word
  const text = displayMode === 'meaning' ? wordRow.meaning_zh : wordRow.word;
  return {
    word_id: wordRow.id,
    word: wordRow.word,
    text,
    meaning_zh: wordRow.meaning_zh,
    meaning_en: wordRow.meaning_en || '',
    phonetic: wordRow.phonetic || '',
    pos: wordRow.pos || '',
    correct: !!correct,
  };
}

function withKeys(options) {
  return options.map((o, i) => ({
    ...o,
    key: String.fromCharCode(65 + i),
  }));
}

/** Per-match question target — round length stays comfortable */
const QUESTIONS_PER_MATCH = 16;
/** How many lesson words to sample into one match (word bank can be huge) */
const WORDS_PER_MATCH = 10;

/**
 * Build one match from a large lesson word pool.
 * Round length is capped; variety comes from sampling + mixed types.
 */
function buildQuestions(lessonId) {
  const { all } = getDb();
  let words = all(
    `SELECT w.* FROM words w
     JOIN lesson_words lw ON lw.word_id = w.id
     WHERE lw.lesson_id = ?
     ORDER BY w.id`,
    [lessonId]
  );
  if (!words.length) return [];

  // Sample subset so huge lessons (scramble) don't create 100+ Q matches
  words = shuffle(words).slice(0, Math.min(WORDS_PER_MATCH, words.length));

  const allWords = all('SELECT * FROM words');
  // Prefer distractors from same difficulty band when possible
  const distractorPool = allWords.length > 80 ? allWords : allWords;
  const questions = [];

  // en->zh
  for (const w of words) {
    const wrongs = shuffle(distractorPool.filter((x) => x.id !== w.id)).slice(0, 3);
    const options = withKeys(
      shuffle([
        packOption(w, true, 'meaning'),
        ...wrongs.map((x) => packOption(x, false, 'meaning')),
      ])
    );
    questions.push({
      type: 'en_to_zh',
      word_id: w.id,
      prompt: w.word,
      sub: w.phonetic || '',
      prompt_meaning_zh: w.meaning_zh,
      prompt_meaning_en: w.meaning_en || '',
      options,
    });
  }

  // zh->en (half of sampled words)
  for (const w of shuffle(words).slice(0, Math.ceil(words.length / 2))) {
    const wrongs = shuffle(distractorPool.filter((x) => x.id !== w.id)).slice(0, 3);
    const options = withKeys(
      shuffle([
        packOption(w, true, 'word'),
        ...wrongs.map((x) => packOption(x, false, 'word')),
      ])
    );
    questions.push({
      type: 'zh_to_en',
      word_id: w.id,
      prompt: w.meaning_zh,
      sub: 'Choose the correct English word',
      prompt_en: w.meaning_en || '',
      options,
    });
  }

  const wordIds = words.map((w) => w.id);
  const sentences = all(
    `SELECT s.* FROM sentences s
     WHERE s.word_id IN (${wordIds.map(() => '?').join(',')})`,
    wordIds
  );

  for (const s of shuffle(sentences).slice(0, 4)) {
    const blank = s.blank_word;
    const target =
      distractorPool.find((x) => x.word.toLowerCase() === blank.toLowerCase()) ||
      words.find((x) => x.id === s.word_id);
    if (!target) continue;
    const display = s.text_en.replace(new RegExp(`\\b${blank}\\b`, 'i'), '______');
    const wrongs = shuffle(distractorPool.filter((x) => x.id !== target.id)).slice(0, 3);
    const options = withKeys(
      shuffle([
        packOption(target, true, 'word'),
        ...wrongs.map((x) => packOption(x, false, 'word')),
      ])
    );
    questions.push({
      type: 'cloze',
      word_id: target.id,
      prompt: display,
      sub: s.text_zh,
      full_sentence: s.text_en,
      options,
    });
  }

  for (const s of shuffle(sentences).slice(0, 2)) {
    const tokens = s.text_en.replace(/[.,!?"]/g, '').split(/\s+/).filter(Boolean);
    if (tokens.length < 3 || tokens.length > 12) continue;
    const shuffled = shuffle(tokens);
    const keyWord = distractorPool.find((w) => w.id === s.word_id);
    questions.push({
      type: 'sentence_order',
      word_id: s.word_id,
      prompt: 'Rebuild the sentence in correct order',
      sub: s.text_zh,
      tokens: shuffled,
      correct_order: tokens,
      full_sentence: s.text_en,
      options: null,
      key_word: keyWord
        ? {
            word: keyWord.word,
            meaning_zh: keyWord.meaning_zh,
            meaning_en: keyWord.meaning_en,
            phonetic: keyWord.phonetic,
          }
        : null,
    });
  }

  for (const w of shuffle(words).slice(0, 3)) {
    const traps = makeSpellingTraps(w.word);
    const fakeRows = traps.map((t, idx) => ({
      id: -1000 - idx,
      word: t,
      meaning_zh: '（干扰拼写）',
      meaning_en: '(spelling distractor)',
      phonetic: '',
      pos: w.pos,
    }));
    const options = withKeys(
      shuffle([
        packOption(w, true, 'word'),
        ...fakeRows.map((x) => packOption(x, false, 'word')),
      ])
    );
    options.forEach((o) => {
      if (!o.correct) {
        o.meaning_zh = '干扰项 · 错误拼写';
        o.meaning_en = 'Distractor · wrong spelling';
      }
    });
    questions.push({
      type: 'spelling',
      word_id: w.id,
      prompt: w.meaning_zh,
      sub: w.phonetic || 'Pick the correct spelling',
      options,
    });
  }

  return shuffle(questions).slice(0, QUESTIONS_PER_MATCH);
}

function makeSpellingTraps(word) {
  const traps = new Set();
  if (word.length >= 4) {
    // swap two letters
    const arr = word.split('');
    const i = Math.floor(word.length / 3);
    const j = Math.min(word.length - 1, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
    traps.add(arr.join(''));
    // double a vowel-ish
    traps.add(word.replace(/([aeiou])/i, '$1$1'));
    // drop a letter
    traps.add(word.slice(0, -1) + (word.endsWith('e') ? '' : 'e'));
    traps.add(word + (word.endsWith('s') ? 'es' : 's'));
  }
  const list = [...traps].filter((t) => t && t !== word);
  while (list.length < 3) list.push(word + 'e');
  return list.slice(0, 3);
}

const DEFAULT_HEARTS = 8;

function calcSettlement({ correct, wrong, comboMax, total, royale }) {
  const accuracy = total ? correct / total : 0;
  let stars = 0;
  if (accuracy >= 0.9 && wrong === 0) stars = 3;
  else if (accuracy >= 0.75) stars = 2;
  else if (accuracy >= 0.5) stars = 1;

  const baseXp = correct * 12;
  const comboBonus = Math.min(comboMax, 12) * 3;
  const perfectBonus = wrong === 0 && correct > 0 ? 40 : 0;
  const starBonus = stars * 15;
  const placeXp = royale?.place_xp || 0;
  const killXp = Math.min(80, (royale?.kills || 0) * 2);
  const xp = baseXp + comboBonus + perfectBonus + starBonus + placeXp + killXp;
  const coins =
    correct * 2 + stars * 5 + (comboMax >= 5 ? 10 : 0) + (royale?.place_coins || 0);

  return {
    stars,
    xp,
    coins,
    accuracy,
    grade: stars === 3 ? 'S' : stars === 2 ? 'A' : stars === 1 ? 'B' : 'C',
  };
}

function publicUser(userId) {
  const { get } = getDb();
  const user = get(
    `SELECT id, email, nickname, created_at, ai_provider, ai_fallback, wordbook_code FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) {
    throw new Error(`用户不存在: ${userId}`);
  }
  const stats = ensureStats(userId);
  const { normalizeProvider } = require('./ai');
  const provider = normalizeProvider(user.ai_provider);
  const bookCode = user.wordbook_code || 'cet4';
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    created_at: user.created_at,
    settings: {
      ai_provider: provider,
      ai_fallback: user.ai_fallback === undefined || user.ai_fallback === null ? true : !!user.ai_fallback,
      wordbook_code: bookCode,
    },
    stats: {
      total_xp: stats.total_xp,
      level: stats.level,
      coins: stats.coins,
      current_streak: stats.current_streak,
      longest_streak: stats.longest_streak,
      weekly_xp: stats.weekly_xp,
      hearts: stats.hearts,
      last_study_date: stats.last_study_date,
    },
  };
}

module.exports = {
  todayKey,
  weekKey,
  xpToLevel,
  ensureStats,
  ensureDailyQuests,
  bumpQuest,
  updateStreak,
  applySrs,
  buildQuestions,
  calcSettlement,
  DEFAULT_HEARTS,
  QUESTIONS_PER_MATCH,
  WORDS_PER_MATCH,
  publicUser,
  shuffle,
};
