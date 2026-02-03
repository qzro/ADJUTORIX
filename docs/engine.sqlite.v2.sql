-- ADJUTORIX ENGINE DB (SQLite) — FUTURE/V2 SCHEMA (steps + events).
-- NOT used by current runtime. v1 schema lives in adjutorix_agent/core/sqlite_ledger._create_schema_v1.
-- Kept for reference only. Do not execute against the agent's ledger.sqlite.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

-- ---------- meta ----------
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

INSERT OR IGNORE INTO meta(k, v) VALUES ('schema_version', '2');

-- ---------- jobs (v2: adds aborted, summary) ----------
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  finished_at_ms INTEGER,

  status TEXT NOT NULL CHECK (
    status IN ('queued','running','success','failed','canceled','aborted')
  ),

  job_name TEXT NOT NULL,
  action TEXT NOT NULL,
  confirm INTEGER NOT NULL DEFAULT 0 CHECK (confirm IN (0,1)),

  workspace_root TEXT NOT NULL,
  summary TEXT,
  context_json TEXT,
  result_json TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at_ms);

-- ---------- steps ----------
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  driver TEXT NOT NULL,

  status TEXT NOT NULL CHECK (
    status IN ('queued','running','success','failed','skipped')
  ),

  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  finished_at_ms INTEGER,

  exit_code INTEGER,
  error TEXT,

  spec_json TEXT NOT NULL,
  result_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_steps_job_idx ON steps(job_id, idx);
CREATE INDEX IF NOT EXISTS idx_steps_job ON steps(job_id);

-- ---------- events (append-only) ----------
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms INTEGER NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (
    type IN (
      'job.queued',
      'job.started',
      'job.finished',
      'job.canceled',
      'step.started',
      'step.log',
      'step.progress',
      'step.finished'
    )
  ),

  step_id TEXT REFERENCES steps(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_job_id_id ON events(job_id, id);
CREATE INDEX IF NOT EXISTS idx_events_step_id_id ON events(step_id, id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_ms);

-- ---------- logs (append-only per job; streamed by job.logs) ----------
CREATE TABLE IF NOT EXISTS logs (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  stream TEXT NOT NULL DEFAULT 'stdout',
  line TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_logs_job_seq ON logs(job_id, seq);

-- ---------- view for UI summary ----------
CREATE VIEW IF NOT EXISTS v_job_summary AS
SELECT
  j.id,
  j.created_at_ms,
  j.started_at_ms,
  j.finished_at_ms,
  j.status,
  j.job_name,
  j.action,
  j.confirm,
  j.workspace_root,
  j.error,
  (SELECT COUNT(1) FROM steps s WHERE s.job_id = j.id) AS step_count,
  (SELECT COUNT(1) FROM steps s WHERE s.job_id = j.id AND s.status = 'failed') AS step_failed_count,
  (SELECT MAX(e.id) FROM events e WHERE e.job_id = j.id) AS last_event_id
FROM jobs j;
