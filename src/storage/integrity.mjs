import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  StorageError,
  canonicalJson,
  check,
  readJson,
  safeRelativePath,
  sha256,
  sha256File,
} from './common.mjs';
import {
  assertNoPlainSqliteFile,
  closeQuietly,
  integrityCheck,
  openEncryptedDatabase,
  queryMetrics,
} from './database.mjs';
import {storageKeyFingerprint} from './env.mjs';

const HMAC_SALT = Buffer.from('pulso-digital-storage-v1', 'utf8');
const HMAC_INFO = Buffer.from('manifest-hmac', 'utf8');

function manifestBody(manifest) {
  const {hmac, ...body} = manifest;
  return body;
}

function hmacKey(key) {
  return Buffer.from(crypto.hkdfSync('sha256', key, HMAC_SALT, HMAC_INFO, 32));
}

export function signManifest(manifest, key) {
  return crypto.createHmac('sha256', hmacKey(key)).update(canonicalJson(manifestBody(manifest))).digest('hex');
}

export function withManifestSignature(manifest, key) {
  const body = manifestBody(manifest);
  return {...body, hmac: signManifest(body, key)};
}

export function verifyManifestSignature(manifest, key) {
  check(manifest && typeof manifest === 'object', 'MANIFEST_INVALID', 'Manifesto ausente ou inválido.');
  check(manifest.key?.fingerprint === storageKeyFingerprint(key), 'KEY_MISMATCH', 'A chave não corresponde ao checkpoint.');
  check(typeof manifest.hmac === 'string' && /^[a-f0-9]{64}$/.test(manifest.hmac), 'MANIFEST_INVALID', 'Assinatura do manifesto ausente.');
  const expected = Buffer.from(signManifest(manifest, key), 'hex');
  const actual = Buffer.from(manifest.hmac, 'hex');
  check(expected.length === actual.length && crypto.timingSafeEqual(expected, actual), 'TAMPERED', 'Manifesto do checkpoint foi alterado.');
  return true;
}

export function validateManifest(manifest) {
  check(manifest?.format === 'pulso-digital-encrypted-checkpoint', 'MANIFEST_INVALID', 'Formato de manifesto desconhecido.');
  check(manifest.formatVersion === '1.0', 'MANIFEST_INVALID', 'Versão de manifesto não suportada.');
  check(typeof manifest.snapshotId === 'string' && manifest.snapshotId.length > 0, 'MANIFEST_INVALID', 'Snapshot sem identificador.');
  check(manifest.database?.file === 'snapshot.sqlcipher', 'MANIFEST_INVALID', 'Nome do banco no manifesto inválido.');
  check(manifest.database?.cipher === 'sqlcipher' && manifest.database?.legacy === 4, 'MANIFEST_INVALID', 'Cifra do manifesto inválida.');
  check(Number.isInteger(manifest.database?.bytes) && manifest.database.bytes >= 0, 'MANIFEST_INVALID', 'Tamanho do banco inválido.');
  check(/^[a-f0-9]{64}$/.test(manifest.database?.sha256 || ''), 'MANIFEST_INVALID', 'Hash do banco inválido.');
  check(Number.isInteger(manifest.content?.files) && manifest.content.files >= 0, 'MANIFEST_INVALID', 'Contagem de arquivos inválida.');
  check(Number.isInteger(manifest.content?.totalBytes) && manifest.content.totalBytes >= 0, 'MANIFEST_INVALID', 'Total de bytes inválido.');
  check(/^[a-f0-9]{64}$/.test(manifest.content?.sourceFingerprint || ''), 'MANIFEST_INVALID', 'Fingerprint de origem inválido.');
}

export function readSnapshotManifest(snapshotDir, maxBytes = 1048576) {
  return readJson(path.join(snapshotDir, 'manifest.json'), maxBytes);
}

export function verifySnapshot(snapshotDir, key, config) {
  const manifest = readSnapshotManifest(snapshotDir, config.limits.manifestBytes);
  validateManifest(manifest);
  verifyManifestSignature(manifest, key);
  const database = path.join(snapshotDir, manifest.database.file);
  const stat = fs.lstatSync(database);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size === manifest.database.bytes, 'TAMPERED', 'Tamanho do banco diverge do manifesto.');
  check(stat.size <= config.limits.snapshotDbBytes, 'SNAPSHOT_LIMIT', 'Banco acima do limite configurado.');
  check(sha256File(database) === manifest.database.sha256, 'TAMPERED', 'Hash do banco diverge do manifesto.');
  assertNoPlainSqliteFile(database);
  let db;
  try {
    db = openEncryptedDatabase(database, key, {readonly: true});
    const integrity = integrityCheck(db);
    check(integrity.ok, 'INTEGRITY', 'Falha na verificação de integridade do SQLite.');
    const rows = db.prepare('SELECT path, bytes, sha256, length(content) AS content_bytes, content FROM source_files ORDER BY path').all();
    check(rows.length === manifest.content.files, 'TAMPERED', 'Quantidade de arquivos diverge do manifesto.');
    let totalBytes = 0;
    for (const row of rows) {
      const safe = safeRelativePath(row.path);
      check(safe === row.path, 'PATH_INVALID', 'Caminho restaurado inválido.');
      check(!path.posix.basename(safe).startsWith('.env'), 'SECRET_EXCLUDED', 'Snapshot contém arquivo de ambiente.');
      check(row.bytes === row.content_bytes && row.sha256 === sha256(row.content), 'TAMPERED', `Arquivo adulterado no snapshot: ${row.path}.`);
      totalBytes += row.bytes;
    }
    check(totalBytes === manifest.content.totalBytes, 'TAMPERED', 'Total de bytes diverge do manifesto.');
    const metrics = queryMetrics(db);
    check(canonicalJson(metrics) === canonicalJson(manifest.metrics), 'TAMPERED', 'Indicadores internos divergem do manifesto.');
    return {
      authenticated: true,
      snapshotId: manifest.snapshotId,
      createdAt: manifest.createdAt,
      integrity,
      manifest,
      metrics,
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('VERIFY_FAILED', 'Falha ao verificar o snapshot criptografado.');
  } finally {
    closeQuietly(db);
  }
}

export function encryptedHeaderCheck(database) {
  const bytes = fs.readFileSync(database).subarray(0, 16);
  return {plainSqliteHeader: bytes.toString('utf8') === 'SQLite format 3\u0000', headerPrefix: bytes.toString('hex').slice(0, 16)};
}
