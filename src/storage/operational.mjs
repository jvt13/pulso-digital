import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  StorageError,
  canonicalJson,
  check,
  jsonBytes,
  mediaTypeFor,
  readJson,
  safeRelativePath,
  sha256,
  toPosix,
} from './common.mjs';
import {closeQuietly, integrityCheck, openEncryptedDatabase, queryMetrics, withTransaction} from './database.mjs';
import {loadStorageKey, storageKeyFingerprint} from './env.mjs';
import {encryptedHeaderCheck, verifyManifestSignature, withManifestSignature} from './integrity.mjs';
import {collectSourceFiles} from './importer.mjs';
import {projectOperationalDatabase} from './operational-projector.mjs';

export const OPERATIONAL_FORMAT = 'pulso-digital-operational-backend';
export const OPERATIONAL_FORMAT_VERSION = '1.0';

const DEFAULTS = {
  filename: 'operational.sqlcipher',
  markerFilename: 'operational.json',
  migrationReceipt: 'operational-migration.json',
  schemaVersion: 4,
};

export function loadOperationalConfig(root) {
  const file = path.join(root, 'storage/config.json');
  const config = fs.existsSync(file) ? readJson(file, 65536) : {};
  return {...DEFAULTS, ...(config.operational || {})};
}

export function operationalPaths(root, config = loadOperationalConfig(root)) {
  const data = path.join(root, 'storage/data');
  return {
    data,
    database: path.join(data, config.filename),
    marker: path.join(data, config.markerFilename),
    receipt: path.join(data, config.migrationReceipt),
  };
}

export function operationalActive(root, config = loadOperationalConfig(root)) {
  return fs.existsSync(operationalPaths(root, config).marker);
}

export function operationalDatabaseExists(root, config = loadOperationalConfig(root)) {
  return fs.existsSync(operationalPaths(root, config).database);
}

export function readOperationalMarker(root, config = loadOperationalConfig(root), {key = null, verify = true} = {}) {
  const file = operationalPaths(root, config).marker;
  if (!fs.existsSync(file)) return null;
  const marker = readJson(file, 65536);
  check(marker.format === OPERATIONAL_FORMAT && marker.formatVersion === OPERATIONAL_FORMAT_VERSION && marker.backend === 'sqlite', 'BACKEND_MARKER', 'Marcador do backend operacional inválido.');
  check(marker.database === `storage/data/${config.filename}` && marker.key?.env === 'PULSO_STORAGE_KEY', 'BACKEND_MARKER', 'Marcador do backend aponta para banco inesperado.');
  if (verify) {
    check(key, 'STORAGE_KEY_MISSING', 'Chave necessária para autenticar o marcador operacional.');
    verifyManifestSignature(marker, key);
  }
  return marker;
}

export function writeOperationalMarker(root, config, key, details) {
  const paths = operationalPaths(root, config);
  const body = {
    format: OPERATIONAL_FORMAT,
    formatVersion: OPERATIONAL_FORMAT_VERSION,
    backend: 'sqlite',
    database: `storage/data/${config.filename}`,
    schemaVersion: config.schemaVersion,
    key: {env: 'PULSO_STORAGE_KEY', bytes: 32, fingerprint: storageKeyFingerprint(key)},
    ...details,
  };
  const marker = withManifestSignature(body, key);
  fs.mkdirSync(path.dirname(paths.marker), {recursive: true, mode: 0o700});
  fs.writeFileSync(paths.marker, jsonBytes(marker), {mode: 0o600});
  try { fs.chmodSync(paths.marker, 0o600); } catch {}
  return marker;
}

function loadKey(root, key) {
  return key || loadStorageKey(root, {required: true}).key;
}

function openOperational(root, config, key, {readonly = true, file = null} = {}) {
  return openEncryptedDatabase(file || operationalPaths(root, config).database, loadKey(root, key), {readonly});
}

function stateRow(db, namespace) {
  const row = db.prepare('SELECT schema_version, payload_json, payload_sha256, updated_at FROM operational_state WHERE namespace = ?').get(namespace);
  check(row, 'OPERATIONAL_STATE', `Estado operacional ausente: ${namespace}.`);
  const state = JSON.parse(row.payload_json);
  check(sha256(canonicalJson(state)) === row.payload_sha256, 'OPERATIONAL_HASH', `Hash do estado operacional diverge: ${namespace}.`);
  return {...row, state};
}

function writeStateRow(db, namespace, state, updatedAt) {
  const payload = jsonBytes(state).toString('utf8');
  const digest = sha256(canonicalJson(state));
  db.prepare(`INSERT INTO operational_state (namespace, schema_version, payload_json, payload_sha256, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(namespace) DO UPDATE SET schema_version = excluded.schema_version,
      payload_json = excluded.payload_json, payload_sha256 = excluded.payload_sha256, updated_at = excluded.updated_at`)
    .run(namespace, '1.0', payload, digest, updatedAt);
  return digest;
}

function recordRows(db) {
  return db.prepare('SELECT id, state, payload_json, payload_sha256, updated_at FROM operational_records ORDER BY id').all();
}

function recordRow(db, id) {
  return db.prepare('SELECT id, state, payload_json, payload_sha256, updated_at FROM operational_records WHERE id = ?').get(id);
}

function writeRecordRow(db, record, updatedAt) {
  const id = record.input?.id;
  check(typeof id === 'string' && id.length > 0, 'OPERATIONAL_RECORD', 'Registro editorial sem identificador.');
  const payload = jsonBytes(record).toString('utf8');
  const digest = sha256(canonicalJson(record));
  db.prepare(`INSERT INTO operational_records (id, state, payload_json, payload_sha256, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state = excluded.state, payload_json = excluded.payload_json,
      payload_sha256 = excluded.payload_sha256, updated_at = excluded.updated_at`)
    .run(id, record.state || 'unknown', payload, digest, updatedAt);
  return digest;
}

function deleteRecordRow(db, id) {
  db.prepare('DELETE FROM operational_records WHERE id = ?').run(id);
}

function assetRows(db) {
  return db.prepare('SELECT path, scope, topic_id, media_type, bytes, sha256, content, updated_at FROM operational_assets ORDER BY path').all();
}

function writeAssetRow(db, file, updatedAt) {
  const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
  const relative = safeRelativePath(file.path);
  const scope = relative.startsWith('newsroom/data/images/') ? 'newsroom-image' : relative.startsWith('editorial/data/incoming/') ? 'editorial-incoming' : 'private';
  const topicId = relative.startsWith('newsroom/data/images/') ? relative.split('/')[3] : relative.startsWith('editorial/data/incoming/') ? relative.split('/')[3] : null;
  db.prepare(`INSERT INTO operational_assets (path, scope, topic_id, media_type, bytes, sha256, content, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET scope = excluded.scope, topic_id = excluded.topic_id,
      media_type = excluded.media_type, bytes = excluded.bytes, sha256 = excluded.sha256,
      content = excluded.content, updated_at = excluded.updated_at`)
    .run(relative, scope, topicId, mediaTypeFor(relative), content.length, sha256(content), content, updatedAt);
}

function event(db, at, action, namespace, entityId, details = {}) {
  db.prepare('INSERT INTO operational_events (at, action, namespace, entity_id, details_json) VALUES (?, ?, ?, ?, ?)')
    .run(at, action, namespace || null, entityId || null, canonicalJson(details));
}

function meta(db, key, value) {
  db.prepare('INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

function project(db) {
  projectOperationalDatabase(db);
  meta(db, 'operational_projected_at', new Date().toISOString());
}

export function readOperationalState(root, namespace, {key = null, config = loadOperationalConfig(root)} = {}) {
  const loadedKey = loadKey(root, key);
  const marker = readOperationalMarker(root, config, {key: loadedKey});
  check(marker, 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: true});
    return stateRow(db, namespace).state;
  } finally {
    closeQuietly(db);
  }
}

export function populateOperationalDatabase(db, {states = {}, records = [], assets = [], metadata = {}, action = 'operational-import'} = {}) {
  return withTransaction(db, () => {
    const at = new Date().toISOString();
    for (const [namespace, state] of Object.entries(states)) writeStateRow(db, namespace, state, at);
    for (const record of records) writeRecordRow(db, record, at);
    for (const asset of assets) writeAssetRow(db, asset, at);
    for (const [name, value] of Object.entries(metadata)) meta(db, name, value);
    project(db);
    event(db, at, action, 'operational', null, {states: Object.keys(states), records: records.length, assets: assets.length});
    return {states: Object.keys(states), records: records.length, assets: assets.length};
  });
}

export function readOperationalStateWithHash(root, namespace, {key = null, config = loadOperationalConfig(root)} = {}) {
  const loadedKey = loadKey(root, key);
  const marker = readOperationalMarker(root, config, {key: loadedKey});
  check(marker, 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: true});
    const row = stateRow(db, namespace);
    return {state: row.state, hash: row.payload_sha256, updatedAt: row.updated_at};
  } finally {
    closeQuietly(db);
  }
}

export function writeOperationalState(root, namespace, state, {expectedHash = null, key = null, config = loadOperationalConfig(root), action = 'write'} = {}) {
  const loadedKey = loadKey(root, key);
  const marker = readOperationalMarker(root, config, {key: loadedKey});
  check(marker, 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: false});
    const result = withTransaction(db, () => {
      const current = db.prepare('SELECT payload_sha256 FROM operational_state WHERE namespace = ?').get(namespace);
      if (expectedHash) {
        check(current?.payload_sha256 === expectedHash, 'OPERATIONAL_CONFLICT', `Estado ${namespace} mudou desde a leitura.`);
      }
      const at = new Date().toISOString();
      const hash = writeStateRow(db, namespace, state, at);
      project(db);
      event(db, at, action, namespace, null, {hash});
      meta(db, 'operational_last_write_at', at);
      return hash;
    });
    return result;
  } finally {
    closeQuietly(db);
  }
}

export async function withOperationalLease(root, {id, ttlMs = 900000, owner = process.pid, key = null, config = loadOperationalConfig(root)} = {}, callback) {
  const loadedKey = loadKey(root, key);
  check(readOperationalMarker(root, config, {key: loadedKey}), 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  check(typeof id === 'string' && id.length > 0 && Number.isInteger(ttlMs) && ttlMs > 0, 'LEASE', 'Lease inválida.');
  let db;
  const token = crypto.randomUUID();
  const acquiredAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  try {
    db = openOperational(root, config, loadedKey, {readonly: false});
    withTransaction(db, () => {
      const current = db.prepare('SELECT token, expires_at FROM leases WHERE id = ?').get(id);
      if (current && Date.parse(current.expires_at) > Date.now()) throw new StorageError('LEASE_BUSY', 'Outro processo possui lease ativa.');
      if (current) db.prepare('DELETE FROM leases WHERE id = ?').run(id);
      db.prepare('INSERT INTO leases (id, owner, host, token, acquired_at, heartbeat_at, expires_at, canonical_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, String(owner), os.hostname(), token, acquiredAt, acquiredAt, expiresAt, canonicalJson({id, owner, host: os.hostname(), token, acquiredAt, expiresAt}));
    });
    return await callback({id, token, acquiredAt, expiresAt});
  } finally {
    try {
      if (db) {
        withTransaction(db, () => {
          db.prepare('DELETE FROM leases WHERE id = ? AND token = ?').run(id, token);
        });
      }
    } catch {}
    closeQuietly(db);
  }
}

export function readOperationalRecords(root, {key = null, config = loadOperationalConfig(root)} = {}) {
  const loadedKey = loadKey(root, key);
  check(readOperationalMarker(root, config, {key: loadedKey}), 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: true});
    return Object.fromEntries(recordRows(db).map((row) => {
      const record = JSON.parse(row.payload_json);
      check(sha256(canonicalJson(record)) === row.payload_sha256, 'OPERATIONAL_HASH', `Hash do registro editorial diverge: ${row.id}.`);
      return [row.id, record];
    }));
  } finally {
    closeQuietly(db);
  }
}

export function readOperationalRecord(root, id, {key = null, config = loadOperationalConfig(root)} = {}) {
  const records = readOperationalRecords(root, {key, config});
  return records[id] || null;
}

export function writeOperationalRecords(root, records, {expectedHashes = null, key = null, config = loadOperationalConfig(root), action = 'editorial-write'} = {}) {
  const loadedKey = loadKey(root, key);
  check(readOperationalMarker(root, config, {key: loadedKey}), 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: false});
    return withTransaction(db, () => {
      const at = new Date().toISOString();
      const hashes = {};
      for (const record of records) {
        const id = record.input?.id;
        const current = recordRow(db, id);
        if (expectedHashes && Object.hasOwn(expectedHashes, id)) {
          check((current?.payload_sha256 || null) === expectedHashes[id], 'OPERATIONAL_CONFLICT', `Registro editorial mudou: ${id}.`);
        }
        hashes[id] = writeRecordRow(db, record, at);
      }
      project(db);
      event(db, at, action, 'editorial', records.map((record) => record.input?.id).filter(Boolean).join(','), {hashes});
      meta(db, 'operational_last_write_at', at);
      return hashes;
    });
  } finally {
    closeQuietly(db);
  }
}

export function deleteOperationalRecord(root, id, {key = null, config = loadOperationalConfig(root), action = 'editorial-recovery'} = {}) {
  const loadedKey = loadKey(root, key);
  check(readOperationalMarker(root, config, {key: loadedKey}), 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: false});
    withTransaction(db, () => {
      deleteRecordRow(db, id);
      const at = new Date().toISOString();
      project(db);
      event(db, at, action, 'editorial', id);
    });
  } finally {
    closeQuietly(db);
  }
}

export function syncOperationalAssets(root, relativeDirectory, {key = null, config = loadOperationalConfig(root)} = {}) {
  if (!operationalActive(root, config)) return {synced: 0, active: false};
  const base = path.resolve(root, relativeDirectory);
  check(base === root || base.startsWith(root + path.sep), 'PATH_INVALID', 'Diretório de assets fora da raiz.');
  if (!fs.existsSync(base)) return {synced: 0, active: true};
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      check(!stat.isSymbolicLink(), 'PATH_INVALID', 'Link simbólico não permitido em assets.');
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) files.push(absolute);
    }
  };
  walk(base);
  const loadedKey = loadKey(root, key);
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: false});
    withTransaction(db, () => {
      const at = new Date().toISOString();
      for (const absolute of files) {
        const relative = safeRelativePath(toPosix(path.relative(root, absolute)));
        writeAssetRow(db, {path: relative, content: fs.readFileSync(absolute)}, at);
      }
      project(db);
      event(db, at, 'assets-sync', 'assets', relativeDirectory, {files: files.length});
    });
  } finally {
    closeQuietly(db);
  }
  return {synced: files.length, active: true};
}

export function readOperationalAssets(root, {key = null, config = loadOperationalConfig(root)} = {}) {
  const loadedKey = loadKey(root, key);
  check(readOperationalMarker(root, config, {key: loadedKey}), 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: true});
    return assetRows(db).map((row) => ({...row, content: Buffer.from(row.content)}));
  } finally {
    closeQuietly(db);
  }
}

export function operationalMetrics(root, {key = null, config = loadOperationalConfig(root)} = {}) {
  const loadedKey = loadKey(root, key);
  const marker = readOperationalMarker(root, config, {key: loadedKey});
  check(marker, 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: true});
    const metrics = queryMetrics(db);
    const assets = db.prepare('SELECT count(*) AS files, coalesce(sum(bytes),0) AS bytes FROM operational_assets').get();
    return {
      ...metrics,
      backend: 'sqlite',
      databaseBytes: fs.statSync(operationalPaths(root, config).database).size,
      activation: {
        activatedAt: marker.activatedAt,
        migrationId: marker.migrationId,
        sourceFingerprint: marker.sourceFingerprint,
        appVersion: marker.appVersion,
        gitCommit: marker.gitCommit,
      },
      operationalAssets: {files: Number(assets.files), bytes: Number(assets.bytes)},
    };
  } finally {
    closeQuietly(db);
  }
}

export function verifyOperationalDatabase(root, {key = null, config = loadOperationalConfig(root)} = {}) {
  const loadedKey = loadKey(root, key);
  const marker = readOperationalMarker(root, config, {key: loadedKey});
  check(marker, 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  const paths = operationalPaths(root, config);
  const stat = fs.lstatSync(paths.database);
  check(stat.isFile() && !stat.isSymbolicLink(), 'TAMPERED', 'Banco operacional ausente ou inválido.');
  const actualDatabaseSha256 = sha256(fs.readFileSync(paths.database));
  const databaseHashChanged = actualDatabaseSha256 !== marker.databaseSha256;
  const header = encryptedHeaderCheck(paths.database);
  check(!header.plainSqliteHeader, 'PLAINTEXT_DATABASE', 'Banco operacional não está criptografado.');
  let db;
  try {
    db = openOperational(root, config, loadedKey, {readonly: true});
    const integrity = integrityCheck(db);
    check(integrity.ok, 'INTEGRITY', 'Falha de integridade no banco operacional.');
    check(Number(db.pragma('user_version', {simple: true})) === config.schemaVersion, 'MIGRATION_STATE', 'Versão do schema operacional diverge.');
    const states = db.prepare('SELECT namespace, payload_sha256 FROM operational_state ORDER BY namespace').all();
    check(states.some((row) => row.namespace === 'radar') && states.some((row) => row.namespace === 'newsroom'), 'OPERATIONAL_STATE', 'Estados operacionais obrigatórios ausentes.');
    return {
      authenticated: true,
      integrity,
      marker,
      databaseSha256: actualDatabaseSha256,
      databaseHashChanged,
      encryption: {plainSqliteHeader: false, headerPrefix: header.headerPrefix},
      schemaVersion: Number(db.pragma('user_version', {simple: true})),
      states,
      metrics: queryMetrics(db),
      databaseBytes: stat.size,
    };
  } finally {
    closeQuietly(db);
  }
}

function virtualFile(relative, content, category, modifiedAt) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    path: safeRelativePath(relative),
    category,
    bytes: bytes.length,
    sha256: sha256(bytes),
    modifiedAt: modifiedAt || new Date().toISOString(),
    content: bytes,
  };
}

export function collectOperationalSources(root, config, key, {readonly = true} = {}) {
  const storageConfig = readJson(path.join(root, 'storage/config.json'), 65536);
  const base = collectSourceFiles(root, storageConfig);
  let db;
  const loadedKey = loadKey(root, key);
  check(readOperationalMarker(root, config, {key: loadedKey}), 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  try {
    db = openOperational(root, config, loadedKey, {readonly});
    const states = Object.fromEntries(db.prepare('SELECT namespace, payload_json, updated_at FROM operational_state').all().map((row) => [row.namespace, row]));
    const records = db.prepare('SELECT id, payload_json, updated_at FROM operational_records ORDER BY id').all();
    const assets = db.prepare('SELECT path, content, updated_at FROM operational_assets ORDER BY path').all();
    const filtered = base.files.filter((file) => {
      if (file.path === 'radar/data/state.json' || file.path === 'newsroom/data/state.json') return false;
      if (file.path.startsWith('editorial/data/records/')) return false;
      if (file.path.startsWith('newsroom/data/images/')) return false;
      if (file.path.startsWith('editorial/data/incoming/')) return false;
      return true;
    });
    const files = [...filtered];
    for (const [namespace, row] of Object.entries(states)) {
      const category = ['radar', 'newsroom', 'automation'].includes(namespace) ? namespace : 'operational';
      files.push(virtualFile(`${namespace}/data/state.json`, row.payload_json, category, row.updated_at));
    }
    for (const record of records) files.push(virtualFile(`editorial/data/records/${record.id}.json`, record.payload_json, 'editorial', record.updated_at));
    for (const asset of assets) files.push(virtualFile(asset.path, asset.content, asset.path.startsWith('newsroom/data/images/') || asset.path.startsWith('editorial/data/incoming/') ? 'image' : 'private', asset.updated_at));
    files.sort((left, right) => left.path.localeCompare(right.path));
    const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
    const fingerprint = sha256(canonicalJson(files.map((file) => ({path: file.path, bytes: file.bytes, sha256: file.sha256}))));
    return {root: base.root, files, totalBytes, fingerprint};
  } finally {
    closeQuietly(db);
  }
}
