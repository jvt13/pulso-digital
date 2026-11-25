import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import {StorageError, check, chmodBestEffort, ensureDirectory} from './common.mjs';

function configureEncryption(db, key) {
  db.pragma("cipher='sqlcipher'");
  db.pragma('legacy=4');
  db.key(key);
}

export function openEncryptedDatabase(file, key, {readonly = false, createParents = true} = {}) {
  check(Buffer.isBuffer(key) && key.length === 32, 'STORAGE_KEY_INVALID', 'Chave SQLCipher deve ter 32 bytes.');
  if (createParents && !readonly) ensureDirectory(path.dirname(file));
  let db;
  try {
    db = new Database(file, {readonly, fileMustExist: readonly, timeout: 5000});
    configureEncryption(db, key);
    if (!readonly) {
      db.pragma('journal_mode=DELETE');
      db.pragma('synchronous=FULL');
      db.pragma('temp_store=MEMORY');
      db.pragma('secure_delete=ON');
      db.pragma('foreign_keys=ON');
      try { db.pragma('cipher_memory_security=ON'); } catch {}
      chmodBestEffort(file, 0o600);
    } else {
      db.pragma('temp_store=MEMORY');
      db.pragma('foreign_keys=ON');
    }
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    return db;
  } catch (error) {
    try { db?.close(); } catch {}
    const code = /SQLITE_NOTADB|not a database|file is encrypted|wrong key|hmac|corrupt|notadb/i.test(`${error?.code || ''} ${error?.message || ''}`)
      ? 'KEY_MISMATCH'
      : 'DATABASE_OPEN';
    throw new StorageError(code, code === 'KEY_MISMATCH' ? 'Chave incorreta ou banco adulterado.' : 'Não foi possível abrir o banco criptografado.');
  }
}

export function withTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function integrityCheck(db) {
  const integrity = db.pragma('integrity_check').map((row) => row.integrity_check);
  const foreignKeys = db.pragma('foreign_key_check');
  let cipherIntegrity = null;
  try { cipherIntegrity = db.pragma('cipher_integrity_check'); } catch {}
  return {
    ok: integrity.length === 1 && integrity[0] === 'ok' && foreignKeys.length === 0,
    integrity,
    foreignKeys,
    cipherIntegrity,
  };
}

function scalar(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? Object.values(row)[0] : null;
}

function grouped(db, sql) {
  return Object.fromEntries(db.prepare(sql).all().map((row) => [row.key, row.total]));
}

export function queryMetrics(db) {
  const snapshotId = scalar(db, "SELECT value FROM storage_meta WHERE key='snapshot_id'");
  const createdAt = scalar(db, "SELECT value FROM storage_meta WHERE key='created_at'");
  const sourceFingerprint = scalar(db, "SELECT value FROM storage_meta WHERE key='source_fingerprint'");
  const ai = db.prepare(`SELECT
    count(*) AS calls,
    coalesce(sum(input_tokens), 0) AS input_tokens,
    coalesce(sum(output_tokens), 0) AS output_tokens,
    coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
    coalesce(sum(actual_tokens), 0) AS actual_tokens,
    coalesce(sum(charged_tokens), 0) AS charged_tokens,
    sum(CASE WHEN status <> 'complete' THEN 1 ELSE 0 END) AS incomplete
    FROM ai_calls`).get();
  const storage = db.prepare(`SELECT
    count(*) AS source_files,
    coalesce(sum(bytes), 0) AS source_bytes
    FROM source_files`).get();
  const imageAssets = db.prepare(`SELECT
    count(*) AS image_assets,
    coalesce(sum(bytes), 0) AS image_bytes
    FROM image_assets`).get();
  return {
    snapshotId,
    createdAt,
    sourceFingerprint,
    schemaVersion: Number(scalar(db, 'PRAGMA user_version')),
    counts: {
      radarTopics: scalar(db, 'SELECT count(*) FROM radar_topics'),
      radarSignals: scalar(db, 'SELECT count(*) FROM radar_signals'),
      radarHistory: scalar(db, 'SELECT count(*) FROM radar_history'),
      radarRuns: scalar(db, 'SELECT count(*) FROM radar_runs'),
      researchCache: scalar(db, 'SELECT count(*) FROM research_cache'),
      dossiers: scalar(db, 'SELECT count(*) FROM dossiers'),
      dossierSources: scalar(db, 'SELECT count(*) FROM dossier_sources'),
      evidence: scalar(db, 'SELECT count(*) FROM evidence'),
      drafts: scalar(db, 'SELECT count(*) FROM drafts'),
      draftSections: scalar(db, 'SELECT count(*) FROM draft_sections'),
      draftClaims: scalar(db, 'SELECT count(*) FROM draft_claims'),
      newsroomHistory: scalar(db, 'SELECT count(*) FROM newsroom_history'),
      editorialRecords: scalar(db, 'SELECT count(*) FROM editorial_records'),
      editorialEvents: scalar(db, 'SELECT count(*) FROM editorial_events'),
      publications: scalar(db, 'SELECT count(*) FROM publications'),
      publicationImages: scalar(db, 'SELECT count(*) FROM publication_images'),
      configs: scalar(db, 'SELECT count(*) FROM configs'),
      images: scalar(db, 'SELECT count(*) FROM images'),
      imageAssets: Number(imageAssets.image_assets),
      operationalErrors: scalar(db, 'SELECT count(*) FROM operational_errors'),
      aiCalls: Number(ai.calls),
    },
    statuses: {
      radarTopics: grouped(db, 'SELECT status AS key, count(*) AS total FROM radar_topics GROUP BY status ORDER BY status'),
      editorialRecords: grouped(db, 'SELECT state AS key, count(*) AS total FROM editorial_records GROUP BY state ORDER BY state'),
      images: grouped(db, 'SELECT status AS key, count(*) AS total FROM images GROUP BY status ORDER BY status'),
    },
    ai: {
      calls: Number(ai.calls),
      incomplete: Number(ai.incomplete),
      inputTokens: Number(ai.input_tokens),
      outputTokens: Number(ai.output_tokens),
      reasoningTokens: Number(ai.reasoning_tokens),
      actualTokens: Number(ai.actual_tokens),
      chargedTokens: Number(ai.charged_tokens),
    },
    storage: {
      sourceFiles: Number(storage.source_files),
      sourceBytes: Number(storage.source_bytes),
      imageAssets: Number(imageAssets.image_assets),
      imageBytes: Number(imageAssets.image_bytes),
    },
  };
}

export function closeQuietly(db) {
  try { db?.close(); } catch {}
}

export function assertNoPlainSqliteFile(file) {
  if (!fs.existsSync(file)) return;
  const bytes = fs.readFileSync(file).subarray(0, 16);
  check(bytes.toString('utf8') !== 'SQLite format 3\u0000', 'PLAINTEXT_DATABASE', 'O arquivo SQLite não está criptografado.');
}
