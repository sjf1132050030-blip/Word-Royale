/**
 * Expand wordbooks to full-scale CET-4 (~4500) / CET-6 (~6000) / Gaokao (~3200)
 * using Google English frequency list + ECDICT Chinese translations.
 *
 * Run: node scripts/expand-exam-vocab.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../src/db/wordbooks');
const CACHE_DIR = path.join(__dirname, '../data/cache');

async function download(url, cacheName) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheName);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1000) {
    console.log('cache hit', cacheName);
    return fs.readFileSync(cachePath, 'utf8');
  }
  console.log('downloading', url);
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const text = await res.text();
  fs.writeFileSync(cachePath, text, 'utf8');
  console.log('saved', cacheName, text.length);
  return text;
}

function parseCsvLine(line) {
  // simple CSV with quotes
  const cols = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function cleanZh(translation) {
  if (!translation) return '';
  // take first non-empty line, strip POS prefixes
  const line = translation
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('[') && s !== 'null');
  if (!line) return '';
  return line
    .replace(/^[a-z]+\.\s*/i, '')
    .replace(/\s*\/\s*/g, '；')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function guessPos(translation, posField) {
  if (posField && /^[a-z]+$/.test(posField)) return posField.slice(0, 8);
  const t = translation || '';
  if (/\bv\./i.test(t) || /^v\./i.test(t)) return 'v';
  if (/\badj\./i.test(t)) return 'adj';
  if (/\badv\./i.test(t)) return 'adv';
  if (/\bprep\./i.test(t)) return 'prep';
  if (/\bconj\./i.test(t)) return 'conj';
  if (/\bpron\./i.test(t)) return 'pron';
  return 'n';
}

function loadExistingPack(code) {
  try {
    return require(path.join(OUT_DIR, `${code}.js`));
  } catch {
    return { words: [] };
  }
}

function isGoodWord(w) {
  if (!w || w.length < 2 || w.length > 18) return false;
  if (!/^[a-z]+(?:-[a-z]+)?$/i.test(w)) return false;
  // skip very short function words already in lists
  return true;
}

async function main() {
  const freqText = await download(
    'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt',
    'google-10000.txt'
  );
  const medText = await download(
    'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears-medium.txt',
    'google-medium.txt'
  );
  const hardText = await download(
    'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears-long.txt',
    'google-long.txt'
  );
  const ecdictText = await download(
    'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
    'ecdict.csv'
  );

  // frequency order: full 10k then medium/long extras
  const freq = [];
  const seenF = new Set();
  for (const block of [freqText, medText, hardText]) {
    for (const line of block.split(/\r?\n/)) {
      const w = line.trim().toLowerCase();
      if (!isGoodWord(w) || seenF.has(w)) continue;
      seenF.add(w);
      freq.push(w);
    }
  }
  console.log('frequency words', freq.length);

  // ECDICT map
  const dict = new Map();
  const lines = ecdictText.split(/\r?\n/);
  // skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    const word = (cols[0] || '').trim().toLowerCase();
    if (!isGoodWord(word) || dict.has(word)) continue;
    const phonetic = (cols[1] || '').trim();
    const translation = cols[3] || cols[2] || '';
    const zh = cleanZh(translation);
    if (!zh) continue;
    const pos = guessPos(translation, cols[4]);
    dict.set(word, {
      word,
      phonetic: phonetic ? `/${phonetic}/` : '',
      meaning_zh: zh,
      meaning_en: word,
      pos,
    });
  }
  console.log('ecdict entries', dict.size);

  // existing packs (keep good Chinese)
  const prev = {
    gaokao: loadExistingPack('gaokao').words || [],
    cet4: loadExistingPack('cet4').words || [],
    cet6: loadExistingPack('cet6').words || [],
    game: loadExistingPack('game').words || [],
  };

  function seedMap(list) {
    const m = new Map();
    for (const w of list) {
      const k = String(w.word).toLowerCase();
      m.set(k, {
        word: w.word,
        phonetic: w.phonetic || '',
        meaning_zh: w.meaning_zh,
        meaning_en: w.meaning_en || w.word,
        pos: w.pos || 'n',
        difficulty: w.difficulty || 1,
        theme: w.theme || 'exam',
      });
    }
    return m;
  }

  function fillFromFreq(baseMap, target, difficulty, theme) {
    const out = new Map(baseMap);
    for (const w of freq) {
      if (out.size >= target) break;
      if (out.has(w)) continue;
      const d = dict.get(w);
      if (!d) continue;
      out.set(w, {
        ...d,
        difficulty,
        theme,
      });
    }
    // if still short, take any ecdict by freq-ish alpha
    if (out.size < target) {
      for (const [w, d] of dict) {
        if (out.size >= target) break;
        if (out.has(w)) continue;
        out.set(w, { ...d, difficulty, theme });
      }
    }
    return [...out.values()];
  }

  // Targets
  const gaokao = fillFromFreq(seedMap(prev.gaokao), 3200, 1, 'gaokao');
  const cet4 = fillFromFreq(seedMap([...prev.cet4, ...gaokao]), 4500, 2, 'cet4');
  const cet6 = fillFromFreq(seedMap([...prev.cet6, ...cet4]), 6000, 3, 'cet6');
  const game =
    prev.game.length > 400
      ? prev.game
      : fillFromFreq(seedMap(prev.game), 800, 1, 'game');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  function write(code, words, meta) {
    // sort by word for stability
    words.sort((a, b) => a.word.localeCompare(b.word));
    fs.writeFileSync(
      path.join(OUT_DIR, `${code}.js`),
      `module.exports = ${JSON.stringify({ meta, words })};\n`
    );
    console.log(code, words.length);
  }

  write(
    'gaokao',
    gaokao,
    {
      code: 'gaokao',
      name_zh: '高考词汇',
      name_en: 'Gaokao',
      description: '高中英语高考核心词汇（扩充版）',
    }
  );
  write('cet4', cet4, {
    code: 'cet4',
    name_zh: '大学英语四级',
    name_en: 'CET-4',
    description: '大学英语四级完整核心词汇（约4500）',
  });
  write('cet6', cet6, {
    code: 'cet6',
    name_zh: '大学英语六级',
    name_en: 'CET-6',
    description: '大学英语六级完整词汇（约6000，含四级）',
  });
  write('game', game, {
    code: 'game',
    name_zh: '竞技词库',
    name_en: 'Arena',
    description: '游戏竞技主题词汇',
  });

  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
