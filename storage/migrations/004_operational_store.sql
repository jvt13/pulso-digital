CREATE TABLE operational_state (
  namespace TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE operational_records (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE operational_assets (
  path TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  topic_id TEXT,
  media_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  sha256 TEXT NOT NULL,
  content BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE operational_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  namespace TEXT,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_operational_records_state ON operational_records(state);
CREATE INDEX idx_operational_assets_scope ON operational_assets(scope);
CREATE INDEX idx_operational_assets_topic ON operational_assets(topic_id);
CREATE INDEX idx_operational_events_at ON operational_events(at);

CREATE VIEW v_operational_backend AS
SELECT key, value
FROM storage_meta
WHERE key LIKE 'operational_%' OR key IN ('backend', 'source_fingerprint', 'created_at');

CREATE VIEW v_operational_assets AS
SELECT scope, coalesce(topic_id, '') AS topic_id, count(*) AS files, coalesce(sum(bytes), 0) AS bytes
FROM operational_assets
GROUP BY scope, coalesce(topic_id, '');

CREATE VIEW v_operational_events AS
SELECT action, count(*) AS total
FROM operational_events
GROUP BY action;
