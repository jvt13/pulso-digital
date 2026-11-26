import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  StorageError,
  canonicalJson,
  check,
  gitCommit,
  isInside,
  jsonBytes,
  readJson,
  safeRelativePath,
  sha256,
  sha256File,
  toPosix,
} from './common.mjs';
import {runtimeDataPath, runtimeDataRoot} from '../runtime/paths.mjs';
import {
  closeQuietly,
  integrityCheck,
  openEncryptedDatabase,
  queryMetrics,
  withTransaction,
} from './database.mjs';
import {loadStorageKey, storageKeyFingerprint} from './env.mjs';
import {encryptedHeaderCheck, verifyManifestSignature, withManifestSignature} from './integrity.mjs';
import {runMigrations} from './migrations.mjs';
import {collectSourceFiles, importPublications} from './importer.mjs';
import {createCheckpoint} from './snapshots.mjs';
import {
  OPERATIONAL_FORMAT_VERSION,
  collectOperationalSources,
  loadOperationalConfig,
  operationalPaths,
  populateOperationalDatabase,
  readOperationalMarker,
  verifyOperationalDatabase,
  writeOperationalMarker,
} from './operational.mjs';
import {withStorageLock} from './snapshots.mjs';

const RECEIPT_FORMAT = 'pulso-digital-operational-migration';

function compactTimestamp(iso) {
  return iso.replace(/[-:.]/g, '');
}

function readLegacyJson(root, relative, required = true) {
  const file = runtimeDataPath(root, relative);
  if (!fs.existsSync(file)) {
    check(!required, 'SOURCE_REQUIRED', `Arquivo legado ausente: ${relative}.`);
    return null;
  }
  return readJson(file, 16 * 1024 * 1024);
}

function walkFiles(root, relativeDirectory) {
  const base = runtimeDataPath(root, relativeDirectory);
  if (!fs.existsSync(base)) return [];
  const result = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      check(!stat.isSymbolicLink(), 'SOURCE_INVALID', 'Link simbólico em asset privado.');
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) result.push(absolute);
    }
  };
  walk(base);
  return result;
}

function legacyEditorialRecords(root) {
  const directory = runtimeDataPath(root, 'editorial/data/records');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^[a-z0-9-]+\.json$/.test(name))
    .sort()
    .map((name) => {
      const record = readJson(path.join(directory, name), 16 * 1024 * 1024);
      check(record?.input?.id === name.slice(0, -5), 'SOURCE_INVALID', `Registro editorial inválido: ${name}.`);
      return record;
    });
}

function legacyAssets(root) {
  const dataRoot = runtimeDataRoot(root);
  return [...walkFiles(root, 'newsroom/data/images'), ...walkFiles(root, 'editorial/data/incoming')]
    .map((absolute) => {
      const content = fs.readFileSync(absolute);
      return {
        path: safeRelativePath(toPosix(path.relative(dataRoot, absolute))),
        bytes: content.length,
        sha256: sha256(content),
        content,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function countsFor(radar, newsroom, records, assets) {
  return {
    radarTopics: radar.topics?.length || 0,
    radarSignals: (radar.topics || []).reduce((total, topic) => total + (topic.signals?.length || 0), 0),
    radarHistory: (radar.topics || []).reduce((total, topic) => total + (topic.history?.length || 0), 0),
    radarRuns: radar.runs?.length || 0,
    newsroomTopics: Object.keys(newsroom.topics || {}).length,
    dossiers: Object.values(newsroom.topics || {}).filter((record) => record.dossier).length,
    evidence: Object.values(newsroom.topics || {}).reduce((total, record) => total + (record.dossier?.evidence?.length || 0), 0),
    drafts: Object.values(newsroom.topics || {}).filter((record) => record.draft).length,
    claims: Object.values(newsroom.topics || {}).reduce((total, record) => total + (record.draft?.claims?.length || 0), 0),
    aiCalls: newsroom.usage?.length || 0,
    incompleteAiCalls: (newsroom.usage || []).filter((entry) => entry.status !== 'complete').length,
    reviews: Object.values(newsroom.topics || {}).reduce((total, record) => total + (record.reviews?.length || 0), 0) + (newsroom.reviewSamples?.length || 0),
    editorialRecords: records.length,
    editorialEvents: records.reduce((total, record) => total + (record.history?.length || 0), 0),
    assets: assets.length,
  };
}

export function legacyInventory(root, config) {
  const radar = readLegacyJson(root, 'radar/data/state.json');
  const newsroom = readLegacyJson(root, 'newsroom/data/state.json');
  const records = legacyEditorialRecords(root);
  const assets = legacyAssets(root);
  const collection = collectSourceFiles(root, config);
  return {
    radar,
    newsroom,
    records,
    assets,
    counts: countsFor(radar, newsroom, records, assets),
    hashes: {
      radar: sha256(canonicalJson(radar)),
      newsroom: sha256(canonicalJson(newsroom)),
      records: Object.fromEntries(records.map((record) => [record.input.id, sha256(canonicalJson(record))])),
      assets: Object.fromEntries(assets.map((asset) => [asset.path, asset.sha256])),
    },
    sourceFingerprint: collection.fingerprint,
    sourceFiles: collection.files.length,
    sourceBytes: collection.totalBytes,
  };
}

function dbInventory(db) {
  const states = Object.fromEntries(db.prepare('SELECT namespace, payload_json FROM operational_state ORDER BY namespace').all().map((row) => [row.namespace, JSON.parse(row.payload_json)]));
  const records = Object.fromEntries(db.prepare('SELECT id, payload_json FROM operational_records ORDER BY id').all().map((row) => [row.id, JSON.parse(row.payload_json)]));
  const assets = Object.fromEntries(db.prepare('SELECT path, sha256 FROM operational_assets ORDER BY path').all().map((row) => [row.path, row.sha256]));
  return {
    radar: states.radar || null,
    newsroom: states.newsroom || null,
    records: Object.values(records),
    assets: Object.keys(assets).map((assetPath) => ({path: assetPath, sha256: assets[assetPath]})),
    hashes: {
      radar: states.radar ? sha256(canonicalJson(states.radar)) : null,
      newsroom: states.newsroom ? sha256(canonicalJson(states.newsroom)) : null,
      records: Object.fromEntries(Object.entries(records).map(([id, record]) => [id, sha256(canonicalJson(record))])),
      assets,
    },
    counts: countsFor(states.radar || {}, states.newsroom || {}, Object.values(records), Object.keys(assets).map((assetPath) => ({path: assetPath}))),
    metrics: queryMetrics(db),
  };
}

function differences(left, right) {
  const result = [];
  for (const [key, value] of Object.entries(left.counts || {})) {
    if (value !== right.counts?.[key]) result.push({field: `counts.${key}`, expected: value, actual: right.counts?.[key] ?? null});
  }
  for (const key of ['radar', 'newsroom']) {
    if (left.hashes?.[key] !== right.hashes?.[key]) result.push({field: `hashes.${key}`, expected: left.hashes?.[key] || null, actual: right.hashes?.[key] || null});
  }
  for (const id of new Set([...Object.keys(left.hashes?.records || {}), ...Object.keys(right.hashes?.records || {})])) {
    if (left.hashes?.records?.[id] !== right.hashes?.records?.[id]) result.push({field: `hashes.records.${id}`, expected: left.hashes?.records?.[id] || null, actual: right.hashes?.records?.[id] || null});
  }
  for (const asset of new Set([...Object.keys(left.hashes?.assets || {}), ...Object.keys(right.hashes?.assets || {})])) {
    if (left.hashes?.assets?.[asset] !== right.hashes?.assets?.[asset]) result.push({field: `hashes.assets.${asset}`, expected: left.hashes?.assets?.[asset] || null, actual: right.hashes?.assets?.[asset] || null});
  }
  return result;
}

export function migrationPlan(root, config) {
  const operationalConfig = loadOperationalConfig(root);
  const paths = operationalPaths(root, operationalConfig);
  const active = fs.existsSync(paths.marker);
  if (active) return {dryRun: true, alreadyActive: true, backend: 'sqlite', persistentChanges: false};
  const inventory = legacyInventory(root, config);
  return {
    dryRun: true,
    alreadyActive: false,
    backend: 'json',
    target: `storage/data/${operationalConfig.filename}`,
    pendingPattern: 'storage/data/operational.pending.*.sqlcipher',
    sourceFingerprint: inventory.sourceFingerprint,
    counts: inventory.counts,
    assetsBytes: inventory.assets.reduce((total, asset) => total + asset.bytes, 0),
    persistentChanges: false,
    next: 'migrate cria backup prévio, banco pendente e recibo; activate só após comparação.',
  };
}

function receiptBody(receipt) {
  const {hmac, ...body} = receipt;
  return body;
}

function writeReceipt(file, receipt, key) {
  const signed = withManifestSignature(receiptBody(receipt), key);
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file, jsonBytes(signed), {mode: 0o600});
  return signed;
}

export function readMigrationReceipt(root, key, {required = false} = {}) {
  const file = operationalPaths(root, loadOperationalConfig(root)).receipt;
  if (!fs.existsSync(file)) {
    check(!required, 'MIGRATION_MISSING', 'Recibo de migração operacional ausente.');
    return null;
  }
  const receipt = readJson(file, 65536);
  check(receipt.format === RECEIPT_FORMAT && receipt.formatVersion === OPERATIONAL_FORMAT_VERSION && receipt.key?.env === 'PULSO_STORAGE_KEY', 'MIGRATION_INVALID', 'Recibo de migração inválido.');
  verifyManifestSignature(receipt, key);
  return receipt;
}

function pendingPath(root, receipt) {
  const absolute = runtimeDataPath(root, receipt.pendingDatabase);
  check(isInside(runtimeDataPath(root, 'storage/data'), absolute), 'PATH_INVALID', 'Banco pendente fora de storage/data.');
  return absolute;
}

export function compareOperational(root, config, key, {pending = false} = {}) {
  const operationalConfig = loadOperationalConfig(root);
  const inventory = legacyInventory(root, config);
  const marker = fs.existsSync(operationalPaths(root, operationalConfig).marker) ? readOperationalMarker(root, operationalConfig, {key}) : null;
  const receipt = !marker ? readMigrationReceipt(root, key, {required: pending}) : null;
  const file = marker ? operationalPaths(root, operationalConfig).database : receipt ? pendingPath(root, receipt) : null;
  check(file && fs.existsSync(file), 'MIGRATION_MISSING', 'Nenhum banco operacional ativo ou pendente para comparar.');
  let db;
  try {
    db = openEncryptedDatabase(file, key, {readonly: true});
    const actual = dbInventory(db);
    const diff = differences(inventory, actual);
    return {
      equal: diff.length === 0,
      backend: marker ? 'sqlite-active' : 'sqlite-pending',
      database: path.relative(root, file).split(path.sep).join('/'),
      expected: {hashes: inventory.hashes, counts: inventory.counts, sourceFingerprint: inventory.sourceFingerprint},
      actual: {hashes: actual.hashes, counts: actual.counts, metrics: actual.metrics},
      differences: diff,
    };
  } finally {
    closeQuietly(db);
  }
}

export function migrateOperational(root, config, packageJson, key, {now = () => new Date().toISOString()} = {}) {
  const operationalConfig = loadOperationalConfig(root);
  const paths = operationalPaths(root, operationalConfig);
  check(!fs.existsSync(paths.marker), 'ALREADY_ACTIVE', 'Backend SQLite operacional já está ativo.');
  const existingReceipt = readMigrationReceipt(root, key);
  check(!existingReceipt || existingReceipt.status === 'active', 'MIGRATION_PENDING', 'Já existe migração pendente; compare/ative ou preserve o recibo antes de repetir.');
  const inventory = legacyInventory(root, config);
  const backup = createCheckpoint(root, config, packageJson, key, {now: now()});
  return withStorageLock(root, config, () => {
    const createdAt = now();
    const migrationId = `${compactTimestamp(createdAt)}-${crypto.randomBytes(4).toString('hex')}`;
    const pending = path.join(paths.data, `operational.pending.${migrationId}.sqlcipher`);
    let db;
    try {
      db = openEncryptedDatabase(pending, key);
      runMigrations(db, path.join(root, 'storage/migrations'), {now: () => createdAt});
      populateOperationalDatabase(db, {
        states: {radar: inventory.radar, newsroom: inventory.newsroom},
        records: inventory.records,
        assets: inventory.assets,
        metadata: {
          backend: 'sqlite',
          operational_state: 'pending',
          operational_schema_version: config.schemaVersion,
          operational_migration_id: migrationId,
          operational_source_fingerprint: inventory.sourceFingerprint,
          operational_app_version: packageJson.version,
          operational_git_commit: gitCommit(root) || '',
          created_at: createdAt,
        },
        action: 'migration-import',
      });
      importPublications(
        db,
        readLegacyJson(root, 'content/articles.json', false),
        readLegacyJson(root, 'content/images.json', false),
      );
      const integrity = integrityCheck(db);
      check(integrity.ok, 'INTEGRITY', 'Banco pendente não passou na integridade.');
      const metrics = queryMetrics(db);
      db.close();
      db = undefined;
      const header = encryptedHeaderCheck(pending);
      check(!header.plainSqliteHeader, 'PLAINTEXT_DATABASE', 'Banco pendente não está criptografado.');
      const databaseBytes = fs.statSync(pending).size;
      const receipt = writeReceipt(paths.receipt, {
        format: RECEIPT_FORMAT,
        formatVersion: OPERATIONAL_FORMAT_VERSION,
        migrationId,
        status: 'pending',
        createdAt,
        pendingDatabase: path.relative(root, pending).split(path.sep).join('/'),
        sourceFingerprint: inventory.sourceFingerprint,
        counts: inventory.counts,
        hashes: inventory.hashes,
        metrics,
        databaseBytes,
        databaseSha256: sha256File(pending),
        backupSnapshotId: backup.snapshotId,
        appVersion: packageJson.version,
        gitCommit: gitCommit(root),
        key: {env: 'PULSO_STORAGE_KEY', bytes: 32, fingerprint: storageKeyFingerprint(key)},
      }, key);
      const comparison = compareOperational(root, config, key, {pending: true});
      check(comparison.equal, 'MIGRATION_DIVERGENCE', 'Migração pendente diverge dos JSON; ativação bloqueada.', comparison.differences);
      return {
        migrationId,
        status: 'pending',
        pendingDatabase: receipt.pendingDatabase,
        backupSnapshotId: backup.snapshotId,
        counts: receipt.counts,
        metrics: receipt.metrics,
        databaseBytes: receipt.databaseBytes,
        comparison,
      };
    } catch (error) {
      closeQuietly(db);
      if (fs.existsSync(pending) && isInside(paths.data, pending)) {
        try { fs.unlinkSync(pending); } catch {}
      }
      if (fs.existsSync(paths.receipt)) {
        try { fs.unlinkSync(paths.receipt); } catch {}
      }
      throw error;
    }
  });
}

export function migrationStatus(root, config, key = null) {
  const operationalConfig = loadOperationalConfig(root);
  const paths = operationalPaths(root, operationalConfig);
  const loaded = key || loadStorageKey(root, {required: false})?.key || null;
  const receipt = loaded ? readMigrationReceipt(root, loaded) : (fs.existsSync(paths.receipt) ? {status: 'present-unverified'} : null);
  const marker = loaded ? readOperationalMarker(root, operationalConfig, {key: loaded}) : (fs.existsSync(paths.marker) ? {present: true, verified: false} : null);
  return {
    backend: marker ? 'sqlite' : 'json',
    active: Boolean(marker),
    marker: marker ? {activatedAt: marker.activatedAt, migrationId: marker.migrationId, sourceFingerprint: marker.sourceFingerprint, schemaVersion: marker.schemaVersion} : null,
    receipt: receipt ? {migrationId: receipt.migrationId, status: receipt.status, pendingDatabase: receipt.pendingDatabase, backupSnapshotId: receipt.backupSnapshotId, counts: receipt.counts} : null,
    pendingExists: receipt?.pendingDatabase ? fs.existsSync(path.resolve(root, receipt.pendingDatabase)) : false,
    databaseExists: fs.existsSync(paths.database),
    databaseBytes: fs.existsSync(paths.database) ? fs.statSync(paths.database).size : null,
    markerExists: fs.existsSync(paths.marker),
    keyConfigured: Boolean(loaded),
  };
}

export function activateOperational(root, config, packageJson, key, {now = () => new Date().toISOString()} = {}) {
  const operationalConfig = loadOperationalConfig(root);
  const paths = operationalPaths(root, operationalConfig);
  return withStorageLock(root, config, () => {
    check(!fs.existsSync(paths.marker), 'ALREADY_ACTIVE', 'Backend SQLite operacional já está ativo.');
    const receipt = readMigrationReceipt(root, key, {required: true});
    check(receipt.status === 'pending', 'MIGRATION_INVALID', 'Recibo não está pendente.');
    const pending = pendingPath(root, receipt);
    check(fs.existsSync(pending), 'MIGRATION_MISSING', 'Banco pendente ausente.');
    const comparison = compareOperational(root, config, key, {pending: true});
    check(comparison.equal, 'MIGRATION_DIVERGENCE', 'Banco pendente diverge dos JSON; ativação bloqueada.', comparison.differences);
    const currentFingerprint = collectSourceFiles(root, config).fingerprint;
    check(currentFingerprint === receipt.sourceFingerprint, 'SOURCE_CHANGED', 'Dados de origem mudaram desde a migração.');
    check(!fs.existsSync(paths.database), 'DATABASE_EXISTS', 'Banco operacional ativo já existe sem marcador; intervenção necessária.');
    const activatedAt = now();
    check(sha256File(pending) === receipt.databaseSha256, 'TAMPERED', 'Banco pendente foi alterado desde a migração.');
    let db;
    try {
      db = openEncryptedDatabase(pending, key);
      withTransaction(db, () => {
        const meta = db.prepare('INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        meta.run('operational_state', 'active');
        meta.run('operational_activated_at', activatedAt);
        meta.run('backend', 'sqlite');
        db.prepare('INSERT INTO operational_events (at, action, namespace, entity_id, details_json) VALUES (?, ?, ?, ?, ?)')
          .run(activatedAt, 'activate', 'operational', receipt.migrationId, canonicalJson({backupSnapshotId: receipt.backupSnapshotId, sourceFingerprint: receipt.sourceFingerprint}));
      });
    } finally {
      closeQuietly(db);
    }
    const sha = sha256File(pending);
    const databaseBytes = fs.statSync(pending).size;
    const marker = withManifestSignature({
      format: 'pulso-digital-operational-backend',
      formatVersion: OPERATIONAL_FORMAT_VERSION,
      backend: 'sqlite',
      database: `storage/data/${operationalConfig.filename}`,
      schemaVersion: operationalConfig.schemaVersion,
      activatedAt,
      migrationId: receipt.migrationId,
      sourceFingerprint: receipt.sourceFingerprint,
      databaseSha256: sha,
      databaseBytes,
      backupSnapshotId: receipt.backupSnapshotId,
      appVersion: packageJson.version,
      gitCommit: gitCommit(root),
      counts: receipt.counts,
      key: {env: 'PULSO_STORAGE_KEY', bytes: 32, fingerprint: storageKeyFingerprint(key)},
    }, key);
    const temporaryMarker = `${paths.marker}.tmp-${crypto.randomUUID()}`;
    fs.mkdirSync(paths.data, {recursive: true, mode: 0o700});
    fs.writeFileSync(temporaryMarker, jsonBytes(marker), {mode: 0o600});
    fs.renameSync(pending, paths.database);
    try {
      fs.renameSync(temporaryMarker, paths.marker);
    } catch (error) {
      try { fs.renameSync(paths.database, pending); } catch {}
      try { fs.unlinkSync(temporaryMarker); } catch {}
      throw error;
    }
    const verified = verifyOperationalDatabase(root, {key, config: operationalConfig});
    writeReceipt(paths.receipt, {...receipt, status: 'active', activatedAt, databaseBytes: verified.databaseBytes, databaseSha256: verified.marker.databaseSha256}, key);
    return {
      backend: 'sqlite',
      activatedAt,
      migrationId: receipt.migrationId,
      database: path.relative(root, paths.database).split(path.sep).join('/'),
      databaseBytes: verified.databaseBytes,
      databaseSha256: verified.marker.databaseSha256,
      backupSnapshotId: receipt.backupSnapshotId,
      sourceFingerprint: receipt.sourceFingerprint,
      metrics: verified.metrics,
    };
  });
}

export function upgradePlan(root) {
  const operationalConfig = loadOperationalConfig(root);
  const marker = readOperationalMarker(root, operationalConfig, {verify: false});
  return {
    backend: marker ? 'sqlite' : 'json',
    currentSchema: marker?.schemaVersion ?? null,
    targetSchema: operationalConfig.schemaVersion,
    needsUpgrade: Boolean(marker && marker.schemaVersion < operationalConfig.schemaVersion),
    persistentChanges: false,
  };
}

export function upgradeOperational(root, config, packageJson, key, {now = () => new Date().toISOString()} = {}) {
  const operationalConfig = loadOperationalConfig(root);
  const paths = operationalPaths(root, operationalConfig);
  const previousMarker = readOperationalMarker(root, operationalConfig, {key});
  check(previousMarker, 'BACKEND_NOT_ACTIVE', 'Backend SQLite operacional não está ativo.');
  if (previousMarker.schemaVersion >= operationalConfig.schemaVersion) {
    return {backend: 'sqlite', alreadyCurrent: true, schemaVersion: previousMarker.schemaVersion, persistentChanges: false};
  }
  return withStorageLock(root, config, () => {
    const before = createCheckpoint(root, config, packageJson, key, {lock: false});
    let db;
    try {
      db = openEncryptedDatabase(paths.database, key);
      const migrations = runMigrations(db, path.join(root, 'storage/migrations'), {now: now});
      const integrity = integrityCheck(db);
      check(integrity.ok, 'INTEGRITY', 'Banco operacional não passou na integridade após upgrade.');
      withTransaction(db, () => {
        const meta = db.prepare('INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        meta.run('operational_schema_version', String(operationalConfig.schemaVersion));
        meta.run('operational_upgraded_at', now());
        meta.run('operational_app_version', packageJson.version);
        meta.run('backend', 'sqlite');
        db.prepare('INSERT INTO operational_events (at, action, namespace, entity_id, details_json) VALUES (?, ?, ?, ?, ?)')
          .run(now(), 'schema-upgrade', 'operational', String(operationalConfig.schemaVersion), canonicalJson({from: previousMarker.schemaVersion, to: operationalConfig.schemaVersion, migrations: migrations.applied}));
      });
      db.close();
      db = undefined;
      const databaseBytes = fs.statSync(paths.database).size;
      const databaseSha256 = sha256File(paths.database);
      writeOperationalMarker(root, operationalConfig, key, {
        activatedAt: previousMarker.activatedAt,
        migrationId: previousMarker.migrationId,
        sourceFingerprint: previousMarker.sourceFingerprint,
        backupSnapshotId: previousMarker.backupSnapshotId,
        counts: previousMarker.counts,
        databaseSha256,
        databaseBytes,
        appVersion: packageJson.version,
        gitCommit: gitCommit(root),
        upgradedAt: now(),
      });
      const verified = verifyOperationalDatabase(root, {key, config: operationalConfig});
      const after = createCheckpoint(root, config, packageJson, key, {lock: false});
      return {
        backend: 'sqlite',
        alreadyCurrent: false,
        fromSchema: previousMarker.schemaVersion,
        schemaVersion: verified.schemaVersion,
        migrations,
        databaseBytes,
        databaseSha256,
        preUpgradeCheckpoint: before.snapshotId,
        postUpgradeCheckpoint: after.snapshotId,
        persistentChanges: true,
      };
    } catch (error) {
      closeQuietly(db);
      throw error;
    }
  });
}
