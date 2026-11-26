import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  StorageError,
  atomicWrite,
  check,
  ensureDirectory,
  gitCommit,
  isInside,
  jsonBytes,
  readJson,
  sha256File,
} from './common.mjs';
import {
  assertNoPlainSqliteFile,
  closeQuietly,
  integrityCheck,
  openEncryptedDatabase,
  queryMetrics,
} from './database.mjs';
import {runMigrations} from './migrations.mjs';
import {collectSourceFiles, importSnapshot} from './importer.mjs';
import {encryptedHeaderCheck, readSnapshotManifest, withManifestSignature} from './integrity.mjs';
import {loadStorageKey} from './env.mjs';
import {collectOperationalSources, loadOperationalConfig, operationalActive} from './operational.mjs';
import {runtimeDataPath} from '../runtime/paths.mjs';

export function loadProjectConfig(root) {
  const packageJson = readJson(path.join(root, 'package.json'), 65536);
  check(packageJson.name === 'pulso-digital', 'ROOT', 'Raiz do projeto inválida.');
  const config = readJson(path.join(root, 'storage/config.json'), 65536);
  check(config.schemaVersion === '1.0' && config.formatVersion === '1.0', 'STORAGE_CONFIG', 'Configuração de armazenamento inválida.');
  check(config.database.cipher === 'sqlcipher' && config.database.legacy === 4 && config.database.journalMode === 'DELETE', 'STORAGE_CONFIG', 'Cifra SQLCipher inválida.');
  check(config.key.env === 'PULSO_STORAGE_KEY' && config.key.bytes === 32, 'STORAGE_CONFIG', 'Configuração de chave inválida.');
  return {config, packageJson};
}

function compactTimestamp(iso) {
  return iso.replace(/[-:.]/g, '').replace('Z', 'Z');
}

function newSnapshotId(createdAt) {
  return `${compactTimestamp(createdAt)}-${crypto.randomBytes(4).toString('hex')}`;
}

function snapshotRoot(root, config) {
  return runtimeDataPath(root, config.paths.snapshots);
}

function assertManagedSnapshotPath(root, config, candidate) {
  check(isInside(snapshotRoot(root, config), candidate), 'PATH_INVALID', 'Caminho de snapshot fora do diretório permitido.');
}

export function withStorageLock(root, config, callback) {
  const lock = runtimeDataPath(root, config.paths.lock);
  ensureDirectory(path.dirname(lock));
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new StorageError('LOCK_BUSY', 'Outra operação de armazenamento está ativa. Use storage recover apenas se o proprietário não estiver vivo.');
    }
    throw error;
  }
  const token = crypto.randomUUID();
  try {
    atomicWrite(path.join(lock, 'owner.json'), jsonBytes({
      pid: process.pid,
      host: os.hostname(),
      token,
      at: new Date().toISOString(),
    }));
    return callback();
  } finally {
    const owner = path.join(lock, 'owner.json');
    try {
      if (fs.existsSync(owner) && readJson(owner, 65536).token === token) {
        fs.unlinkSync(owner);
        fs.rmdirSync(lock);
      }
    } catch {}
  }
}

export function recoverStorageLock(root, config, reason) {
  check(typeof reason === 'string' && reason.trim().length >= 5, 'REASON_REQUIRED', 'Informe justificativa de recuperação.');
  const lock = runtimeDataPath(root, config.paths.lock);
  if (!fs.existsSync(lock)) return {recovered: false};
  const ownerFile = path.join(lock, 'owner.json');
  const owner = fs.existsSync(ownerFile) ? readJson(ownerFile, 65536) : null;
  if (owner) {
    check(owner.host === os.hostname() && Number.isInteger(owner.pid) && owner.pid > 0, 'LOCK_BUSY', 'Lock sem proprietário local verificável; inspeção manual necessária.');
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    check(!alive, 'LOCK_BUSY', 'O processo proprietário ainda está ativo; lock preservado.');
  }
  ensureDirectory(runtimeDataPath(root, config.paths.data));
  atomicWrite(
    runtimeDataPath(root, `${config.paths.data}/recovery-${crypto.randomUUID()}.json`),
    jsonBytes({owner, reason, at: new Date().toISOString()}),
  );
  if (fs.existsSync(ownerFile)) fs.unlinkSync(ownerFile);
  fs.rmdirSync(lock);
  return {recovered: true};
}

export function checkpointPlan(root, config) {
  const operationalConfig = loadOperationalConfig(root);
  const collection = operationalActive(root, operationalConfig)
    ? collectOperationalSources(root, operationalConfig, loadStorageKey(root).key)
    : collectSourceFiles(root, config);
  return {
    dryRun: true,
    format: config.format,
    formatVersion: config.formatVersion,
    sourceFingerprint: collection.fingerprint,
    files: collection.files.length,
    totalBytes: collection.totalBytes,
    categories: Object.fromEntries([...new Set(collection.files.map((file) => file.category))].sort().map((category) => [
      category,
      collection.files.filter((file) => file.category === category).length,
    ])),
    persistentChanges: false,
    keyRequired: true,
  };
}

export function createCheckpoint(root, config, packageJson, key, {now = new Date().toISOString(), lock = true} = {}) {
  const execute = () => {
    const operationalConfig = loadOperationalConfig(root);
    const createdAt = now;
    const snapshotId = newSnapshotId(createdAt);
    const collection = operationalActive(root, operationalConfig)
      ? collectOperationalSources(root, operationalConfig, key)
      : collectSourceFiles(root, config);
    const snapshots = snapshotRoot(root, config);
    ensureDirectory(snapshots);
    const temporary = path.join(snapshots, `.tmp-${crypto.randomUUID()}`);
    const databaseFile = path.join(temporary, config.database.filename);
    let db;
    try {
      ensureDirectory(temporary);
      db = openEncryptedDatabase(databaseFile, key);
      const migrations = runMigrations(db, path.join(root, 'storage/migrations'), {now: () => now});
      const imported = importSnapshot(db, collection, {
        snapshotId,
        createdAt,
        appVersion: packageJson.version,
        gitCommit: gitCommit(root),
        host: os.hostname(),
        pid: process.pid,
      });
      const metrics = queryMetrics(db);
      const integrity = integrityCheck(db);
      check(integrity.ok, 'INTEGRITY', 'Checkpoint não passou na verificação de integridade.');
      db.close();
      db = undefined;
      const auxiliaryFiles = fs.readdirSync(temporary).filter((name) => name !== config.database.filename);
      check(auxiliaryFiles.length === 0, 'AUXILIARY_FILE', `Arquivos auxiliares inesperados: ${auxiliaryFiles.join(', ')}.`);
      assertNoPlainSqliteFile(databaseFile);
      const databaseBytes = fs.statSync(databaseFile);
      check(databaseBytes.size <= config.limits.snapshotDbBytes, 'SNAPSHOT_LIMIT', 'Banco acima do limite configurado.');
      const header = encryptedHeaderCheck(databaseFile);
      check(!header.plainSqliteHeader, 'PLAINTEXT_DATABASE', 'O banco persistido não está criptografado.');
      const body = {
        format: config.format,
        formatVersion: config.formatVersion,
        snapshotId,
        createdAt,
        application: {
          name: packageJson.name,
          version: packageJson.version,
          gitCommit: gitCommit(root),
        },
        database: {
          file: config.database.filename,
          engine: config.database.engine,
          cipher: config.database.cipher,
          legacy: config.database.legacy,
          journalMode: config.database.journalMode,
          bytes: databaseBytes.size,
          sha256: sha256File(databaseFile),
        },
        content: {
          sourceFingerprint: collection.fingerprint,
          files: collection.files.length,
          totalBytes: collection.totalBytes,
        },
        key: {
          env: config.key.env,
          bytes: config.key.bytes,
          fingerprint: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
        },
        encryption: {
          plainSqliteHeader: false,
          headerPrefix: header.headerPrefix,
          integrity: integrity,
          auxiliaryFiles: [],
        },
        migrations,
        metrics,
      };
      const manifest = withManifestSignature(body, key);
      atomicWrite(path.join(temporary, 'manifest.json'), jsonBytes(manifest));
      const finalDirectory = path.join(snapshots, snapshotId);
      assertManagedSnapshotPath(root, config, finalDirectory);
      fs.renameSync(temporary, finalDirectory);
      return {
        snapshotId,
        path: path.relative(root, finalDirectory).split(path.sep).join('/'),
        createdAt,
        databaseBytes: databaseBytes.size,
        files: collection.files.length,
        totalBytes: collection.totalBytes,
        sourceFingerprint: collection.fingerprint,
        imported: imported.alreadyImported ? 'already-imported' : 'imported',
        metrics,
      };
    } catch (error) {
      closeQuietly(db);
      if (fs.existsSync(temporary) && isInside(snapshots, temporary)) {
        fs.rmSync(temporary, {recursive: true, force: true});
      }
      throw error;
    }
  };
  return lock ? withStorageLock(root, config, execute) : execute();
}

export function listSnapshots(root, config) {
  const snapshots = snapshotRoot(root, config);
  if (!fs.existsSync(snapshots)) return [];
  const items = [];
  for (const name of fs.readdirSync(snapshots).sort().reverse()) {
    if (name.startsWith('.')) continue;
    const directory = path.join(snapshots, name);
    if (!fs.statSync(directory).isDirectory()) continue;
    try {
      const manifest = readSnapshotManifest(directory, config.limits.manifestBytes);
      items.push({
        id: manifest.snapshotId,
        directory: name,
        createdAt: manifest.createdAt,
        databaseBytes: manifest.database?.bytes ?? null,
        files: manifest.content?.files ?? null,
        totalBytes: manifest.content?.totalBytes ?? null,
        metrics: manifest.metrics?.counts ?? null,
      });
    } catch (error) {
      items.push({id: name, directory: name, error: error.code || error.message});
    }
  }
  return items.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}

export function snapshotRetentionPlan(items, config, {protectedIds = []} = {}) {
  const limit = config.retention?.maxSnapshots;
  check(Number.isInteger(limit) && limit > 0, 'STORAGE_CONFIG', 'Limite configurável de snapshots inválido.');
  const ordered = [...items].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  const newestRetained = new Set(ordered.slice(0, limit).map((item) => item.id || item.directory));
  const protectedSet = new Set(protectedIds.filter(Boolean));
  const latestHealthy = ordered.find((item) => !item.error);
  const protectedSnapshots = ordered.filter((item) => protectedSet.has(item.id || item.directory) || item.id === latestHealthy?.id);
  for (const item of protectedSnapshots) protectedSet.add(item.id || item.directory);
  const kept = ordered.filter((item) => newestRetained.has(item.id || item.directory) || protectedSet.has(item.id || item.directory) || item.error);
  const candidates = ordered.filter((item) => !kept.includes(item));
  return {
    simulation: true,
    deletionPerformed: false,
    policy: 'keep-newest-and-protected',
    maxSnapshots: limit,
    total: ordered.length,
    retainedCount: kept.length,
    candidateCount: candidates.length,
    latestHealthy: latestHealthy?.id || null,
    protectedIds: [...protectedSet].sort(),
    retained: kept.map((item) => ({id: item.id || item.directory, createdAt: item.createdAt || null, reason: item.error ? 'integrity-error-preserved' : protectedSet.has(item.id || item.directory) ? 'protected' : 'newest-window'})),
    removalCandidates: candidates.map((item) => ({id: item.id || item.directory, createdAt: item.createdAt || null, databaseBytes: item.databaseBytes ?? null})),
  };
}

export function planSnapshotRetention(root, config, {protectedIds = []} = {}) {
  const markerFile = runtimeDataPath(root, `${config.paths.data}/${config.operational?.markerFilename || 'operational.json'}`);
  const marker = fs.existsSync(markerFile) ? readJson(markerFile, 65536) : null;
  const markerProtected = [marker?.backupSnapshotId].filter(Boolean);
  return snapshotRetentionPlan(listSnapshots(root, config), config, {
    protectedIds: [...markerProtected, ...protectedIds],
  });
}

export function selectSnapshot(root, config, requestedId = null) {
  const items = listSnapshots(root, config);
  const selected = requestedId
    ? items.find((item) => item.id === requestedId || item.directory === requestedId)
    : items[0];
  if (!selected) throw new StorageError('SNAPSHOT_MISSING', 'Nenhum snapshot encontrado.');
  const directory = path.join(snapshotRoot(root, config), selected.directory);
  assertManagedSnapshotPath(root, config, directory);
  return {item: selected, directory, manifest: readSnapshotManifest(directory, config.limits.manifestBytes)};
}
