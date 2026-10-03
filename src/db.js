// SQLite database setup. The DB file lives in ./data (git-ignored).
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(DATA_DIR, 'chronicle.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    display_name  TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
  );

  -- One newspaper = one month for one owner
  CREATE TABLE IF NOT EXISTS newspapers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    year       INTEGER NOT NULL,
    month      INTEGER NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    UNIQUE (owner_id, year, month)
  );

  -- One page = one day. content is JSON: { elements: [...] }
  CREATE TABLE IF NOT EXISTS pages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    newspaper_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
    day          INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL,
    updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (newspaper_id, day)
  );

  -- Sharing: role is 'view' or 'edit'
  CREATE TABLE IF NOT EXISTS shares (
    newspaper_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT    NOT NULL CHECK (role IN ('view', 'edit')),
    created_at   TEXT    NOT NULL,
    PRIMARY KEY (newspaper_id, user_id)
  );
`);

module.exports = db;
