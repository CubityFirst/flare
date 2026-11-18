-- All timestamps are Unix epoch milliseconds.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  oidc_iss      TEXT NOT NULL,
  oidc_sub      TEXT NOT NULL,
  email         TEXT,
  name          TEXT,
  picture       TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  UNIQUE (oidc_iss, oidc_sub)
);
CREATE INDEX users_email ON users (email COLLATE NOCASE);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- SHA-256 of the cookie token
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'webpush',
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  last_push_at INTEGER,
  last_error   TEXT
);
CREATE INDEX devices_user ON devices (user_id);

CREATE TABLE apps (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  default_sound    TEXT,
  default_priority INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX apps_user ON apps (user_id);

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  label        TEXT,
  prefix       TEXT NOT NULL,             -- first characters, shown in the UI
  hash         TEXT NOT NULL UNIQUE,      -- SHA-256 of the full key
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX api_keys_app ON api_keys (app_id);

CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE group_members (
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  muted      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members (user_id);

CREATE TABLE sounds (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, slug)
);

CREATE TABLE messages (
  id             TEXT PRIMARY KEY,
  app_id         TEXT REFERENCES apps (id) ON DELETE SET NULL,
  app_name       TEXT,                    -- denormalised so history survives app deletion
  sender_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  title          TEXT,
  body           TEXT NOT NULL,
  html           INTEGER NOT NULL DEFAULT 0,
  priority       INTEGER NOT NULL DEFAULT 0,
  sound          TEXT,
  sound_url      TEXT,
  url            TEXT,
  url_title      TEXT,
  targets        TEXT NOT NULL,           -- JSON array of the recipient specs as sent
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER                  -- from ttl; hidden from the feed afterwards
);
CREATE INDEX messages_created ON messages (created_at);
CREATE INDEX messages_app ON messages (app_id, created_at);

CREATE TABLE deliveries (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id    TEXT REFERENCES groups (id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  notify      INTEGER NOT NULL DEFAULT 1, -- 0 when the recipient muted the group (feed only)
  pushed      INTEGER NOT NULL DEFAULT 0, -- number of devices the push was accepted for
  read_at     INTEGER,
  deleted_at  INTEGER,
  UNIQUE (message_id, user_id)
);
CREATE INDEX deliveries_feed ON deliveries (user_id, created_at DESC);

CREATE TABLE receipts (
  id               TEXT PRIMARY KEY,
  message_id       TEXT NOT NULL UNIQUE REFERENCES messages (id) ON DELETE CASCADE,
  retry_seconds    INTEGER NOT NULL,
  expire_at        INTEGER NOT NULL,
  callback_url     TEXT,
  created_at       INTEGER NOT NULL,
  last_sent_at     INTEGER,
  sent_count       INTEGER NOT NULL DEFAULT 1,
  acknowledged_at  INTEGER,
  acknowledged_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  cancelled_at     INTEGER,
  expired_at       INTEGER,
  called_back_at   INTEGER
);
