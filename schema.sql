-- Flowgram backend schema (PostgreSQL)
-- Соответствует архитектуре, обсуждённой ранее: один движок, JSON-сценарии, usage-based тарифы

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255),
  plan          VARCHAR(20) NOT NULL DEFAULT 'free', -- free | start | pro | business | enterprise
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bots (
  id              SERIAL PRIMARY KEY,
  owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  telegram_token  BYTEA NOT NULL,          -- зашифровано на уровне приложения (AES-256-GCM), см. src/crypto.js
  telegram_username VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | active | paused | deleted
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bots_owner ON bots(owner_id);

CREATE TABLE scenarios (
  bot_id      INTEGER PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,              -- текущий опубликованный сценарий (nodes+edges из builder.html)
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenario_versions (
  id          SERIAL PRIMARY KEY,
  bot_id      INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  data        JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_versions_bot ON scenario_versions(bot_id, version DESC);

-- конечные пользователи ботов (не путать с users — теми, кто владеет ботом)
CREATE TABLE bot_users (
  id          SERIAL PRIMARY KEY,
  bot_id      INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id     BIGINT NOT NULL,
  vars        JSONB NOT NULL DEFAULT '{}', -- переменные сценария для этого пользователя
  status      VARCHAR(20) NOT NULL DEFAULT 'active', -- active | blocked
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bot_id, chat_id)
);
CREATE INDEX idx_bot_users_bot ON bot_users(bot_id);

CREATE TABLE messages_log (
  id          BIGSERIAL PRIMARY KEY,
  bot_id      INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id     BIGINT NOT NULL,
  direction   VARCHAR(3) NOT NULL,         -- in | out
  node_id     VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_log_bot_time ON messages_log(bot_id, created_at DESC);

CREATE TABLE broadcasts (
  id          SERIAL PRIMARY KEY,
  bot_id      INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  audience    VARCHAR(50) NOT NULL DEFAULT 'all',
  status      VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued | sending | done | failed
  total       INTEGER NOT NULL DEFAULT 0,
  delivered   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE integrations (
  id          SERIAL PRIMARY KEY,
  bot_id      INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  type        VARCHAR(50) NOT NULL,        -- yookassa | robokassa | google_sheets | webhook | ...
  config      JSONB NOT NULL DEFAULT '{}', -- секреты внутри тоже шифруются на уровне приложения
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          VARCHAR(20) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active', -- active | canceled | past_due
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,            -- в копейках
  provider    VARCHAR(30) NOT NULL,        -- yookassa | robokassa | cloudpayments
  provider_payment_id VARCHAR(255),
  status      VARCHAR(20) NOT NULL,        -- succeeded | failed | pending
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- счётчики использования за текущий расчётный период — на них держатся лимиты тарифа
CREATE TABLE usage (
  bot_id          INTEGER PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  messages_count  INTEGER NOT NULL DEFAULT 0,
  broadcasts_count INTEGER NOT NULL DEFAULT 0,
  users_count     INTEGER NOT NULL DEFAULT 0
);
