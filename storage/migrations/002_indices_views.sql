CREATE INDEX idx_radar_topics_status ON radar_topics(status);
CREATE INDEX idx_radar_topics_category ON radar_topics(category);
CREATE INDEX idx_radar_signals_topic ON radar_signals(topic_id);
CREATE INDEX idx_radar_signals_organization ON radar_signals(organization);
CREATE INDEX idx_dossier_sources_topic ON dossier_sources(topic_id);
CREATE INDEX idx_evidence_topic ON evidence(topic_id);
CREATE INDEX idx_evidence_source ON evidence(source_id);
CREATE INDEX idx_ai_calls_topic ON ai_calls(topic_id);
CREATE INDEX idx_ai_calls_at ON ai_calls(at);
CREATE INDEX idx_editorial_events_record ON editorial_events(record_id);
CREATE INDEX idx_publications_category ON publications(category);
CREATE INDEX idx_operational_errors_source ON operational_errors(source);

CREATE VIEW v_radar_status AS
SELECT status, count(*) AS total
FROM radar_topics
GROUP BY status;

CREATE VIEW v_editorial_pipeline AS
SELECT state, count(*) AS total
FROM editorial_records
GROUP BY state;

CREATE VIEW v_ai_usage AS
SELECT
  provider,
  model,
  count(*) AS calls,
  sum(CASE WHEN status <> 'complete' THEN 1 ELSE 0 END) AS incomplete,
  coalesce(sum(input_tokens), 0) AS input_tokens,
  coalesce(sum(output_tokens), 0) AS output_tokens,
  coalesce(sum(charged_tokens), 0) AS charged_tokens
FROM ai_calls
GROUP BY provider, model;

CREATE VIEW v_image_inventory AS
SELECT scope, status, count(*) AS total, coalesce(sum(bytes), 0) AS bytes
FROM image_assets
LEFT JOIN images ON images.topic_id = image_assets.topic_id
GROUP BY scope, status;
