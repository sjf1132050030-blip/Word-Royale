const { initDb, getDb } = require('./database');
const path = require('path');
const fs = require('fs');

const BOOK_CODES = ['gaokao', 'cet4', 'cet6', 'game'];

function loadBook(code) {
  const p = path.join(__dirname, 'wordbooks', `${code}.js`);
  if (!fs.existsSync(p)) return null;
  return require(p);
}

function autoSentence(w) {
  const word = w.word;
  const zh = (w.meaning_zh || '').split('；')[0] || word;
  if (w.pos === 'v') {
    return {
      text_en: `Students should ${word} carefully in exams.`,
      text_zh: `学生在考试中应该仔细地${zh}。`,
      blank_word: word,
    };
  }
  if (w.pos === 'adj') {
    return {
      text_en: `This is a ${word} example for learners.`,
      text_zh: `这对学习者来说是一个${zh}的例子。`,
      blank_word: word,
    };
  }
  if (w.pos === 'adv') {
    return {
      text_en: `She answered the question ${word}.`,
      text_zh: `她${zh}地回答了问题。`,
      blank_word: word,
    };
  }
  return {
    text_en: `The word "${word}" is important in English tests.`,
    text_zh: `单词 ${word}（${zh}）在英语考试中很重要。`,
    blank_word: word,
  };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function seed(force = false) {
  await initDb();
  const { get, run, all, lastInsertRowid, persist, setDeferPersist } = getDb();

  const packs = BOOK_CODES.map((c) => loadBook(c)).filter(Boolean);
  if (!packs.length) {
    console.error('No wordbooks found under src/db/wordbooks');
    return;
  }

  const totalTarget = packs.reduce((s, p) => s + (p.words?.length || 0), 0);
  const existing = get('SELECT COUNT(*) AS c FROM words');
  const booksExist = get('SELECT COUNT(*) AS c FROM wordbooks');
  const cet6Count = get(
    `SELECT COUNT(*) AS c FROM wordbook_words ww
     JOIN wordbooks wb ON wb.id = ww.wordbook_id WHERE wb.code = 'cet6'`
  );

  // auto-upgrade if packs grew (e.g. 2458 -> 6000)
  if (
    !force &&
    existing &&
    existing.c >= 4000 &&
    booksExist?.c >= 3 &&
    (cet6Count?.c || 0) >= 5500
  ) {
    console.log('Seed skipped: words=', existing.c, 'wordbooks=', booksExist.c, 'cet6=', cet6Count?.c);
    return;
  }

  console.log('Reseeding exam wordbooks… target entries', totalTarget);
  setDeferPersist(true);

  run('DELETE FROM lesson_words');
  run('DELETE FROM lessons');
  run('DELETE FROM wordbook_words');
  run('DELETE FROM wordbooks');
  run('DELETE FROM sentences');
  run('DELETE FROM words');
  run('DELETE FROM daily_quests');
  run('DELETE FROM user_word_progress');
  run('DELETE FROM user_lesson_progress');
  run('DELETE FROM study_sessions');

  // global unique word map
  const global = new Map();
  for (const pack of packs) {
    for (const w of pack.words || []) {
      const k = String(w.word).toLowerCase();
      if (!global.has(k)) global.set(k, w);
    }
  }

  for (const w of global.values()) {
    run(
      `INSERT INTO words (word, phonetic, meaning_zh, meaning_en, pos, difficulty)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        w.word,
        w.phonetic || '',
        w.meaning_zh || w.word,
        w.meaning_en || w.word,
        w.pos || 'n',
        w.difficulty || 1,
      ]
    );
  }

  const wordRows = all('SELECT id, word FROM words');
  const wordMap = Object.fromEntries(wordRows.map((r) => [String(r.word).toLowerCase(), r.id]));

  // sentences for all unique words (one each)
  for (const w of global.values()) {
    const s = autoSentence(w);
    const wid = wordMap[String(w.word).toLowerCase()];
    if (!wid) continue;
    run(
      `INSERT INTO sentences (text_en, text_zh, word_id, blank_word, difficulty)
       VALUES (?, ?, ?, ?, ?)`,
      [s.text_en, s.text_zh, wid, s.blank_word, w.difficulty || 1]
    );
  }

  let bookSort = 1;
  for (const pack of packs) {
    const meta = pack.meta || { code: 'unknown', name_zh: '词库' };
    run(
      `INSERT INTO wordbooks (code, name_zh, name_en, description, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [meta.code, meta.name_zh, meta.name_en || meta.code, meta.description || '', bookSort++]
    );
    const book = get('SELECT id FROM wordbooks WHERE code = ?', [meta.code]);
    const bookId = book?.id;
    if (!bookId) continue;

    const ids = [];
    for (const w of pack.words || []) {
      const wid = wordMap[String(w.word).toLowerCase()];
      if (!wid) continue;
      run(`INSERT OR IGNORE INTO wordbook_words (wordbook_id, word_id) VALUES (?, ?)`, [bookId, wid]);
      ids.push(wid);
    }

    // lessons: 20 words per lesson
    const parts = chunk(ids, 20);
    parts.forEach((slice, i) => {
      const title = `${meta.name_zh} · 第 ${i + 1} 关 / ${meta.name_en || meta.code} #${i + 1}`;
      const unlock = i === 0 ? 0 : i * 25;
      run(
        `INSERT INTO lessons (unit_id, wordbook_id, title, sort_order, unlock_xp)
         VALUES (1, ?, ?, ?, ?)`,
        [bookId, title, i + 1, unlock]
      );
      const lesson = get('SELECT id FROM lessons WHERE wordbook_id = ? AND sort_order = ?', [
        bookId,
        i + 1,
      ]);
      const lid = lesson?.id ?? lastInsertRowid();
      for (const wid of slice) {
        run(`INSERT OR IGNORE INTO lesson_words (lesson_id, word_id) VALUES (?, ?)`, [lid, wid]);
      }
    });

    console.log('book', meta.code, 'words', ids.length, 'lessons', parts.length);
  }

  const quests = [
    { code: 'play_1', title: '完成 1 场对局 / Play 1 match', target: 1, reward_xp: 20, reward_coins: 15 },
    { code: 'correct_8', title: '累计答对 12 题 / Get 12 correct', target: 12, reward_xp: 35, reward_coins: 25 },
    { code: 'combo_5', title: '单局连击达到 6 / Combo x6', target: 6, reward_xp: 45, reward_coins: 30 },
  ];
  for (const q of quests) {
    run(
      `INSERT INTO daily_quests (code, title, target, reward_xp, reward_coins) VALUES (?, ?, ?, ?, ?)`,
      [q.code, q.title, q.target, q.reward_xp, q.reward_coins]
    );
  }

  setDeferPersist(false);
  persist();

  const wc = get('SELECT COUNT(*) AS c FROM words');
  const bc = get('SELECT COUNT(*) AS c FROM wordbooks');
  const lc = get('SELECT COUNT(*) AS c FROM lessons');
  console.log('Seed complete: words', wc?.c, 'books', bc?.c, 'lessons', lc?.c);
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  seed(force).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { seed };
