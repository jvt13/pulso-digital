import {
  importEditorial,
  importImageAssets,
  importNewsroom,
  importRadar,
  importReviews,
} from './importer.mjs';

function payload(db, namespace) {
  const row = db.prepare('SELECT payload_json FROM operational_state WHERE namespace = ?').get(namespace);
  return row ? JSON.parse(row.payload_json) : null;
}

export function projectOperationalDatabase(db) {
  const radar = payload(db, 'radar');
  const newsroom = payload(db, 'newsroom');
  const records = db.prepare('SELECT id, payload_json FROM operational_records ORDER BY id').all();
  const assets = db.prepare('SELECT path, bytes, sha256, content FROM operational_assets ORDER BY path').all();

  db.exec(`
    DELETE FROM radar_signals;
    DELETE FROM radar_history;
    DELETE FROM radar_topics;
    DELETE FROM radar_runs;
    DELETE FROM research_cache;
    DELETE FROM dossier_sources;
    DELETE FROM evidence;
    DELETE FROM dossiers;
    DELETE FROM draft_sections;
    DELETE FROM draft_claims;
    DELETE FROM drafts;
    DELETE FROM newsroom_history;
    DELETE FROM images;
    DELETE FROM image_assets;
    DELETE FROM ai_calls;
    DELETE FROM editorial_reviews;
    DELETE FROM editorial_events;
    DELETE FROM editorial_records;
    DELETE FROM operational_errors;
  `);

  if (radar) importRadar(db, radar);
  if (newsroom) {
    importNewsroom(db, newsroom);
    importReviews(db, newsroom);
  }
  if (records.length) {
    importEditorial(db, records.map((record) => ({
      path: `editorial/data/records/${record.id}.json`,
      content: Buffer.from(record.payload_json, 'utf8'),
    })));
  }
  if (assets.length) importImageAssets(db, assets);
  return {
    radar: Boolean(radar),
    newsroom: Boolean(newsroom),
    records: records.length,
    assets: assets.length,
  };
}
