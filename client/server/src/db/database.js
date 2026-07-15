const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/word_royale.db');
const DATA_DIR = path.dirname(DB_PATH);

let db = null;
/** Cached because db.export() resets SQLite last_insert_rowid to 0 */
let cachedLastInsertId = null;

function persist() {
  if (!db) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Convert ? placeholders + array params into a bound statement safely */
function prepare(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params && params.length > 0) {
    // sql.js expects 1-based binding for some versions; array form works for ?
    stmt.bind(params);
  }
  return stmt;
}

function captureLastInsertId() {
  const res = db.exec('SELECT last_insert_rowid()');
  if (res?.[0]?.values?.[0]?.[0] != null) {
    cachedLastInsertId = Number(res[0].values[0][0]);
  }
  return cachedLastInsertId;
}

/** When true, run() does not flush to disk (seed batching). Call persist() manually. */
let deferPersist = false;

function setDeferPersist(v) {
  deferPersist = !!v;
}

function run(sql, params = []) {
  if (!params || params.length === 0) {
    db.run(sql);
  } else {
    db.run(sql, params);
  }
  // Must capture BEFORE persist/export (export zeroes last_insert_rowid)
  const id = captureLastInsertId();
  if (!deferPersist) persist();
  return id;
}

function get(sql, params = []) {
  const stmt = prepare(sql, params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function all(sql, params = []) {
  const stmt = prepare(sql, params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function exec(sql) {
  db.run(sql);
  captureLastInsertId();
  persist();
}

function lastInsertRowid() {
  return cachedLastInsertId;
}

function initSchema() {
  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      ai_provider TEXT NOT NULL DEFAULT 'gemini',
      ai_fallback INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_stats (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      total_xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      coins INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      last_study_date TEXT,
      weekly_xp INTEGER NOT NULL DEFAULT 0,
      week_key TEXT,
      hearts INTEGER NOT NULL DEFAULT 5
    );

    CREATE TABLE IF NOT EXISTS wordbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name_zh TEXT NOT NULL,
      name_en TEXT,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      phonetic TEXT,
      meaning_zh TEXT NOT NULL,
      meaning_en TEXT,
      pos TEXT,
      difficulty INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS wordbook_words (
      wordbook_id INTEGER NOT NULL REFERENCES wordbooks(id) ON DELETE CASCADE,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      PRIMARY KEY (wordbook_id, word_id)
    );

    CREATE TABLE IF NOT EXISTS sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text_en TEXT NOT NULL,
      text_zh TEXT NOT NULL,
      word_id INTEGER REFERENCES words(id),
      blank_word TEXT,
      difficulty INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER NOT NULL DEFAULT 1,
      wordbook_id INTEGER REFERENCES wordbooks(id),
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      unlock_xp INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS lesson_words (
      lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      PRIMARY KEY (lesson_id, word_id)
    );

    CREATE TABLE IF NOT EXISTS user_word_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'new',
      ease REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      next_review_at TEXT,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      last_result_at TEXT,
      PRIMARY KEY (user_id, word_id)
    );

    CREATE TABLE IF NOT EXISTS user_lesson_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      stars INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      times_played INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      PRIMARY KEY (user_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS study_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id INTEGER NOT NULL REFERENCES lessons(id),
      status TEXT NOT NULL DEFAULT 'active',
      combo_max INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      coins_earned INTEGER NOT NULL DEFAULT 0,
      stars INTEGER NOT NULL DEFAULT 0,
      questions_json TEXT NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      target INTEGER NOT NULL,
      reward_xp INTEGER NOT NULL DEFAULT 30,
      reward_coins INTEGER NOT NULL DEFAULT 20
    );

    CREATE TABLE IF NOT EXISTS user_daily_quest (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quest_id INTEGER NOT NULL REFERENCES daily_quests(id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      claimed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, quest_id, day_key)
    );
  `);
  // migrations for existing DBs
  try {
    db.run(`ALTER TABLE users ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'gemini'`);
  } catch (_) {
    /* column exists */
  }
  try {
    db.run(`ALTER TABLE users ADD COLUMN ai_fallback INTEGER NOT NULL DEFAULT 1`);
  } catch (_) {
    /* column exists */
  }
  try {
    db.run(`ALTER TABLE users ADD COLUMN wordbook_code TEXT NOT NULL DEFAULT 'cet4'`);
  } catch (_) {
    /* column exists */
  }
  try {
    db.run(`ALTER TABLE lessons ADD COLUMN wordbook_id INTEGER`);
  } catch (_) {
    /* column exists */
  }
  try {
    db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
  } catch (_) {
    /* column exists */
  }
  persist();
}

async function initDb() {
  if (db) return db;
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    initSchema();
  }
  // ensure schema on existing files (idempotent)
  initSchema();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return { run, get, all, exec, lastInsertRowid, persist, setDeferPersist, raw: db };
}

module.exports = { initDb, getDb, DB_PATH };
