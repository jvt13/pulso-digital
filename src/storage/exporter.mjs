import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  StorageError,
  atomicWrite,
  check,
  ensureDirectory,
  isInside,
  safeRelativePath,
  sha256,
} from './common.mjs';
import {closeQuietly, openEncryptedDatabase} from './database.mjs';
import {verifySnapshot} from './integrity.mjs';

function resolveTarget(target) {
  check(typeof target === 'string' && target.trim(), 'TARGET_REQUIRED', 'Diretório de destino obrigatório.');
  const absolute = path.resolve(target);
  check(path.parse(absolute).root !== absolute, 'TARGET_INVALID', 'Não restaure sobre a raiz do sistema.');
  check(path.basename(absolute) !== '.' && path.basename(absolute) !== '..', 'TARGET_INVALID', 'Destino inválido.');
  return absolute;
}

export function restoreSnapshot({snapshotDir, key, config, target = null, dryRun = false}) {
  const verified = verifySnapshot(snapshotDir, key, config);
  const database = path.join(snapshotDir, verified.manifest.database.file);
  let db;
  let rows;
  try {
    db = openEncryptedDatabase(database, key, {readonly: true});
    rows = db.prepare('SELECT path, bytes, sha256, content FROM source_files ORDER BY path').all();
  } finally {
    closeQuietly(db);
  }
  const plan = {
    dryRun,
    snapshotId: verified.snapshotId,
    files: rows.map((row) => ({path: row.path, bytes: row.bytes, sha256: row.sha256})),
    totalBytes: rows.reduce((total, row) => total + row.bytes, 0),
    metrics: verified.metrics,
    target: target ? path.resolve(target) : null,
    persistentChanges: false,
  };
  if (dryRun) return plan;

  const absoluteTarget = resolveTarget(target);
  check(!fs.existsSync(absoluteTarget), 'TARGET_EXISTS', 'O destino já existe; restauração não sobrescreve estado ativo.');
  const parent = path.dirname(absoluteTarget);
  ensureDirectory(parent);
  const staging = path.join(parent, `.pulso-restore-${crypto.randomUUID()}`);
  try {
    ensureDirectory(staging);
    for (const row of rows) {
      const relative = safeRelativePath(row.path);
      const destination = path.join(staging, ...relative.split('/'));
      check(isInside(staging, destination), 'PATH_INVALID', `Destino fora da restauração: ${row.path}.`);
      atomicWrite(destination, row.content, 0o600);
      const restored = fs.readFileSync(destination);
      check(restored.length === row.bytes && sha256(restored) === row.sha256, 'RESTORE_INTEGRITY', `Falha ao restaurar ${row.path}.`);
    }
    const files = fs.readdirSync(staging, {recursive: true, withFileTypes: true}).filter((entry) => entry.isFile()).length;
    check(files === rows.length, 'RESTORE_INTEGRITY', 'Quantidade restaurada diverge do snapshot.');
    fs.renameSync(staging, absoluteTarget);
    return {
      ...plan,
      dryRun: false,
      target: absoluteTarget,
      restoredFiles: rows.length,
      persistentChanges: true,
    };
  } catch (error) {
    if (fs.existsSync(staging) && isInside(parent, staging)) {
      fs.rmSync(staging, {recursive: true, force: true});
    }
    if (error instanceof StorageError) throw error;
    throw new StorageError('RESTORE_FAILED', 'Falha durante a restauração isolada.');
  }
}
