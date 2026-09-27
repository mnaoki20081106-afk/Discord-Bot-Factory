CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloudflare_accounts (
  alias TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  encrypted_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  ref TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  account_alias TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  workflow_run_id TEXT,
  workflow_run_url TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS deployments_created_at_idx
  ON deployments(created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
