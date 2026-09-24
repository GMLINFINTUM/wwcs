-- WWCS database schema.
-- Run with: npm run migrate   (needs DATABASE_URL set)

CREATE TABLE IF NOT EXISTS spotters (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  county        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  spotter_id INTEGER NOT NULL REFERENCES spotters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE TABLE IF NOT EXISTS observations (
  id           SERIAL PRIMARY KEY,
  spotter_id   INTEGER NOT NULL REFERENCES spotters(id) ON DELETE CASCADE,
  location     TEXT NOT NULL,
  zip          TEXT,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  weather_type TEXT NOT NULL,
  temperature_f NUMERIC,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id         SERIAL PRIMARY KEY,
  spotter_id INTEGER NOT NULL REFERENCES spotters(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           SERIAL PRIMARY KEY,
  spotter_id   INTEGER REFERENCES spotters(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  body         TEXT NOT NULL,
  flagged      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_created        ON blog_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_created        ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires    ON sessions(expires_at);
