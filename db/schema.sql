-- Chai Chronicle / dʌmi News schema for PostgreSQL (Supabase).
-- Idempotent: every statement is "IF NOT EXISTS", so it is safe to run again.
-- The server runs this automatically on start (src/migrate.js).

-- ---------- Core tables (already exist on your Supabase project) ----------
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newspapers (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, year, month)
);

CREATE TABLE IF NOT EXISTS pages (
  id           BIGSERIAL PRIMARY KEY,
  newspaper_id BIGINT NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
  day          INTEGER NOT NULL,
  content      TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (newspaper_id, day)
);

CREATE TABLE IF NOT EXISTS shares (
  newspaper_id BIGINT NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (newspaper_id, user_id)
);

-- ---------- New: email on users ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email)) WHERE email IS NOT NULL;

-- ---------- New: reactions (one per person per day-page) ----------
CREATE TABLE IF NOT EXISTS reactions (
  page_id    BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id)
);

-- ---------- New: in-app notifications (the bell) ----------
CREATE TABLE IF NOT EXISTS notifications (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,              -- 'share' | 'role' | 'reaction'
  actor_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  newspaper_id BIGINT REFERENCES newspapers(id) ON DELETE CASCADE,
  day          INTEGER,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);
