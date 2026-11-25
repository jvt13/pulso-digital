CREATE TABLE storage_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE snapshot_versions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  format_version TEXT NOT NULL,
  database_sha256 TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  metrics_json TEXT NOT NULL
);

CREATE TABLE execution_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  host TEXT,
  pid INTEGER,
  git_commit TEXT,
  app_version TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE import_runs (
  fingerprint TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  counts_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE source_files (
  path TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  sha256 TEXT NOT NULL,
  modified_at TEXT,
  content BLOB NOT NULL
);

CREATE TABLE radar_topics (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  score REAL,
  first_seen_at TEXT,
  last_seen_at TEXT,
  collected_at TEXT,
  assessment_hash TEXT,
  candidate_type TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE radar_signals (
  topic_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  provider TEXT,
  organization TEXT,
  region TEXT,
  language TEXT,
  url TEXT,
  feed_published_at TEXT,
  observed_at TEXT,
  weight REAL,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (topic_id, signal_id)
);

CREATE TABLE radar_history (
  topic_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  at TEXT,
  action TEXT,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (topic_id, sequence)
);

CREATE TABLE radar_runs (
  run_id TEXT PRIMARY KEY,
  at TEXT,
  status TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE research_cache (
  url TEXT PRIMARY KEY,
  title TEXT,
  checked_at TEXT,
  content_hash TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE dossiers (
  topic_id TEXT PRIMARY KEY,
  schema_version TEXT,
  category TEXT,
  created_at TEXT,
  insufficient INTEGER NOT NULL DEFAULT 0,
  central_event TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE dossier_sources (
  source_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  organization TEXT,
  original_url TEXT,
  final_url TEXT,
  title TEXT,
  published_at TEXT,
  checked_at TEXT,
  content_hash TEXT,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (topic_id, source_id)
);

CREATE TABLE evidence (
  evidence_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  source_id TEXT,
  classification TEXT,
  checked_at TEXT,
  excerpt_hash TEXT,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (topic_id, evidence_id)
);

CREATE TABLE drafts (
  topic_id TEXT PRIMARY KEY,
  editorial_id TEXT,
  status TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  category TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0,
  verification_json TEXT,
  image_suggestion TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE draft_sections (
  topic_id TEXT NOT NULL,
  section_index INTEGER NOT NULL,
  title TEXT,
  paragraph_count INTEGER NOT NULL,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (topic_id, section_index)
);

CREATE TABLE draft_claims (
  topic_id TEXT NOT NULL,
  claim_index INTEGER NOT NULL,
  section_index INTEGER,
  paragraph_index INTEGER,
  classification TEXT,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (topic_id, claim_index)
);

CREATE TABLE newsroom_history (
  topic_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  at TEXT,
  action TEXT,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (topic_id, sequence)
);

CREATE TABLE ai_calls (
  attempt_id TEXT PRIMARY KEY,
  topic_id TEXT,
  provider TEXT,
  model TEXT,
  at TEXT,
  finished_at TEXT,
  status TEXT,
  error_code TEXT,
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  charged_tokens INTEGER NOT NULL DEFAULT 0,
  actual_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  duration_ms INTEGER,
  request_id TEXT,
  rate_limits_json TEXT,
  error_json TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE images (
  topic_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  reason TEXT,
  credit TEXT,
  source_url TEXT,
  license TEXT,
  license_url TEXT,
  checked_at TEXT,
  alt TEXT,
  caption TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE image_assets (
  path TEXT PRIMARY KEY,
  topic_id TEXT,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER
);

CREATE TABLE editorial_records (
  id TEXT PRIMARY KEY,
  record_version TEXT,
  state TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  category TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  approval_state TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE editorial_events (
  record_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  at TEXT,
  action TEXT,
  from_state TEXT,
  to_state TEXT,
  actor TEXT,
  canonical_json TEXT NOT NULL,
  PRIMARY KEY (record_id, sequence)
);

CREATE TABLE publications (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  published_at TEXT,
  updated_at TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE publication_images (
  image_key TEXT PRIMARY KEY,
  source TEXT,
  alt TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE configs (
  path TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  canonical_json TEXT NOT NULL
);

CREATE TABLE operational_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  code TEXT,
  message TEXT,
  at TEXT,
  canonical_json TEXT NOT NULL
);

CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  host TEXT NOT NULL,
  token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT,
  expires_at TEXT NOT NULL,
  canonical_json TEXT NOT NULL
);
