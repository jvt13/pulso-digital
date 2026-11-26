CREATE TABLE automation_schedules (
  id TEXT PRIMARY KEY,
  activity TEXT NOT NULL,
  interval_ms INTEGER NOT NULL CHECK (interval_ms > 0),
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  last_status TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT,
  activity TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  next_run_at TEXT,
  summary_json TEXT,
  error_json TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE automation_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  topic_id TEXT,
  status TEXT NOT NULL,
  stage TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE automation_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  finished_at TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE automation_events (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  job_id TEXT,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  canonical_json TEXT NOT NULL
);

CREATE TABLE automation_control (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_automation_schedules_next ON automation_schedules(next_run_at);
CREATE INDEX idx_automation_runs_started ON automation_runs(started_at);
CREATE INDEX idx_automation_runs_status ON automation_runs(status);
CREATE INDEX idx_automation_jobs_status ON automation_jobs(status);
CREATE INDEX idx_automation_jobs_topic ON automation_jobs(topic_id);
CREATE INDEX idx_automation_steps_job ON automation_steps(job_id);
CREATE INDEX idx_automation_events_at ON automation_events(at);

CREATE VIEW v_automation_status AS
SELECT
  (SELECT value FROM automation_control WHERE key = 'paused') AS paused,
  (SELECT value FROM automation_control WHERE key = 'last_tick_at') AS last_tick_at,
  (SELECT value FROM automation_control WHERE key = 'last_run_at') AS last_run_at,
  (SELECT min(next_run_at) FROM automation_schedules WHERE enabled = 1) AS next_run_at,
  (SELECT count(*) FROM automation_jobs WHERE status IN ('queued','running','recovery-required')) AS open_jobs;

CREATE VIEW v_automation_jobs AS
SELECT status, stage, count(*) AS total
FROM automation_jobs
GROUP BY status, stage;

CREATE VIEW v_automation_runs AS
SELECT activity, status, count(*) AS total
FROM automation_runs
GROUP BY activity, status;

CREATE VIEW v_automation_health AS
SELECT
  (SELECT count(*) FROM automation_jobs WHERE status = 'failed') AS failed_jobs,
  (SELECT count(*) FROM automation_jobs WHERE status = 'blocked') AS blocked_jobs,
  (SELECT count(*) FROM automation_jobs WHERE status = 'recovery-required') AS recovery_required,
  (SELECT count(*) FROM automation_events WHERE severity IN ('error','critical')) AS error_events,
  (SELECT max(at) FROM automation_runs WHERE activity = 'health' AND status = 'completed') AS last_health_at;
