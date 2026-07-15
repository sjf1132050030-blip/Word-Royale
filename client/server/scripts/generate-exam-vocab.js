/**
 * Generate gaokao / cet4 / cet6 / game wordbook JSON modules.
 * Run: node scripts/generate-exam-vocab.js
 */
const fs = require('fs');
const path = require('path');

// Pull more words from existing bank + large compact lists
let ORIG = [];
try {
  ORIG = require('../src/db/wordbank.js');
} catch (_) {
  ORIG = [];
}

/** @type {string} word|zh|pos per line */
const LISTS = {
  // Common high-school + CET shared core (dense)
  core: require('./vocab-core-data.js'),
  adv: require('./vocab-adv-data.js'),
};

function parseLines(block, difficulty, theme) {
  const out = [];
  const seen = new Set();
  const lines = Array.isArray(block)
    ? block
    : String(block || '')
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean);
  for (const line of lines) {
    const t = String(line).trim();
    if (!t || t.startsWith('#')) continue;
    const [word, zh, pos = 'n'] = t.split('|');
    if (!word) continue;
    const k = word.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      word: word.trim(),
      meaning_zh: (zh || word).trim(),
      meaning_en: word.trim(),
      pos: (pos || 'n').trim(),
      phonetic: '',
      difficulty,
      theme,
    });
  }
  return out;
}

function merge(...lists) {
  const m = new Map();
  for (const list of lists) {
    for (const w of list) {
      const k = String(w.word).toLowerCase();
      if (!m.has(k)) m.set(k, w);
    }
  }
  return [...m.values()];
}

function fromOrig(filterFn, theme, difficulty) {
  return ORIG.filter(filterFn).map((w) => ({
    word: w.word,
    meaning_zh: w.meaning_zh,
    meaning_en: w.meaning_en || w.word,
    pos: w.pos || 'n',
    phonetic: w.phonetic || '',
    difficulty: difficulty ?? w.difficulty ?? 1,
    theme,
  }));
}

const core = parseLines(LISTS.core, 1, 'exam');
const adv = parseLines(LISTS.adv, 3, 'exam');
const origEasy = fromOrig((w) => (w.difficulty || 1) <= 2, 'gaokao', 1);
const origAll = fromOrig(() => true, 'exam', 2);

const gaokao = merge(core, origEasy);
const cet4 = merge(gaokao, core.map((w) => ({ ...w, difficulty: 2 })), origAll);
const cet6 = merge(cet4, adv);

const game = ORIG.length
  ? ORIG.map((w) => ({
      word: w.word,
      meaning_zh: w.meaning_zh,
      meaning_en: w.meaning_en || w.word,
      pos: w.pos || 'n',
      phonetic: w.phonetic || '',
      difficulty: w.difficulty || 1,
      theme: w.theme || 'game',
    }))
  : gaokao.slice(0, 500);

const outDir = path.join(__dirname, '../src/db/wordbooks');
fs.mkdirSync(outDir, { recursive: true });

function writePack(code, words, meta) {
  const payload = { meta, words };
  fs.writeFileSync(path.join(outDir, `${code}.js`), `module.exports = ${JSON.stringify(payload)};\n`);
  console.log(code, words.length);
}

writePack('gaokao', gaokao, {
  code: 'gaokao',
  name_zh: '高考词汇',
  name_en: 'Gaokao',
  description: '高中英语高考核心词汇',
});
writePack('cet4', cet4, {
  code: 'cet4',
  name_zh: '大学英语四级',
  name_en: 'CET-4',
  description: '大学英语四级核心词汇',
});
writePack('cet6', cet6, {
  code: 'cet6',
  name_zh: '大学英语六级',
  name_en: 'CET-6',
  description: '大学英语六级核心与提高词汇',
});
writePack('game', game, {
  code: 'game',
  name_zh: '竞技词库',
  name_en: 'Arena',
  description: '游戏竞技主题词汇',
});

console.log('total unique across packs', merge(gaokao, cet4, cet6, game).length);
