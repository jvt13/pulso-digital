CREATE TABLE editorial_reviews (
  id TEXT PRIMARY KEY,
  topic_id TEXT,
  sample_id TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  task_id TEXT,
  content_hash TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  model_result TEXT,
  effective_result TEXT,
  human_review_required INTEGER NOT NULL DEFAULT 1,
  findings_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  major_count INTEGER NOT NULL DEFAULT 0,
  minor_count INTEGER NOT NULL DEFAULT 0,
  informational_count INTEGER NOT NULL DEFAULT 0,
  findings_json TEXT NOT NULL DEFAULT '[]',
  assessments_json TEXT NOT NULL DEFAULT '[]',
  limitations_json TEXT NOT NULL DEFAULT '[]',
  comparison_json TEXT,
  usage_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_editorial_reviews_topic ON editorial_reviews(topic_id);
CREATE INDEX idx_editorial_reviews_status ON editorial_reviews(status);
CREATE INDEX idx_editorial_reviews_result ON editorial_reviews(effective_result);
CREATE INDEX idx_editorial_reviews_created ON editorial_reviews(created_at);

CREATE VIEW v_review_summary AS
SELECT status, effective_result, count(*) AS total
FROM editorial_reviews
GROUP BY status, effective_result;

CREATE VIEW v_review_severity AS
SELECT
  coalesce(sum(critical_count), 0) AS critical,
  coalesce(sum(major_count), 0) AS major,
  coalesce(sum(minor_count), 0) AS minor,
  coalesce(sum(informational_count), 0) AS informational,
  coalesce(sum(stale), 0) AS stale
FROM editorial_reviews;
