import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AutomationRepository} from '../src/automation/repository.mjs';
import {loadStorageKey} from '../src/storage/env.mjs';
import {verifySnapshot} from '../src/storage/integrity.mjs';
import {
  loadOperationalConfig,
  operationalActive,
  operationalPaths,
  verifyOperationalDatabase,
} from '../src/storage/operational.mjs';
import {listSnapshots, selectSnapshot} from '../src/storage/snapshots.mjs';
import {sha256File} from '../src/storage/common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotId = process.argv[2] || process.env.PULSO_CHECKPOINT_ID;
if (!snapshotId) {
  console.error('Uso: node tools/create-migration-bundle.mjs <snapshot-id>');
  process.exit(2);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'pulso-digital') throw new Error('Raiz do projeto inválida.');
const storageConfig = JSON.parse(fs.readFileSync(path.join(root, 'storage/config.json'), 'utf8'));
const operationalConfig = loadOperationalConfig(root);
if (!operationalActive(root, operationalConfig)) throw new Error('Backend operacional não está ativo.');

const automation = new AutomationRepository(root).read();
if (automation.control?.paused !== true) throw new Error('A automação local precisa estar pausada.');
for (const relative of ['storage/data/lock', 'radar/data/lock', 'newsroom/data/lock', 'editorial/data/transaction.json']) {
  if (fs.existsSync(path.join(root, relative))) throw new Error(`Operação ativa detectada: ${relative}.`);
}

const {key} = loadStorageKey(root);
verifyOperationalDatabase(root, {key, config: operationalConfig});
const snapshot = selectSnapshot(root, storageConfig, snapshotId);
verifySnapshot(snapshot.directory, key, storageConfig);
const paths = operationalPaths(root, operationalConfig);

const archiveRoot = path.join(root, 'storage/archive');
fs.mkdirSync(archiveRoot, {recursive: true, mode: 0o700});
const bundleFile = path.join(archiveRoot, `pd0072-operational-${snapshotId}.tar.gz`);
const manifestFile = `${bundleFile}.json`;
if (fs.existsSync(bundleFile) || fs.existsSync(manifestFile)) throw new Error('Bundle já existe; não será sobrescrito.');
const staging = fs.mkdtempSync(path.join(archiveRoot, '.pd0072-bundle-'));
try {
  const dataRoot = path.join(staging, 'storage/data');
  fs.mkdirSync(path.join(dataRoot, 'snapshots'), {recursive: true, mode: 0o700});
  for (const [source, name] of [
    [paths.database, 'operational.sqlcipher'],
    [paths.marker, 'operational.json'],
    [paths.receipt, 'operational-migration.json'],
  ]) {
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataRoot, name));
  }
  fs.cpSync(snapshot.directory, path.join(dataRoot, 'snapshots', snapshotId), {recursive: true});
  const tar = spawnSync('tar', ['-czf', bundleFile, '-C', staging, '.'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
  });
  if (tar.status !== 0) throw new Error(`Falha ao criar bundle: ${tar.stderr || tar.error?.message || 'erro desconhecido'}`);
  const manifest = {
    schemaVersion: '1.0',
    task: 'PD-007.2',
    createdAt: new Date().toISOString(),
    version: packageJson.version,
    snapshotId,
    snapshotIds: listSnapshots(root, storageConfig).map((item) => item.id).filter(Boolean),
    containsStorageKey: false,
    containsEnvFile: false,
    archive: path.basename(bundleFile),
    bytes: fs.statSync(bundleFile).size,
    sha256: sha256File(bundleFile),
    files: {
      operationalDatabaseSha256: fs.existsSync(paths.database) ? sha256File(paths.database) : null,
      markerSha256: fs.existsSync(paths.marker) ? sha256File(paths.marker) : null,
      snapshotDatabaseSha256: sha256File(path.join(snapshot.directory, 'snapshot.sqlcipher')),
    },
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o600});
  console.log(JSON.stringify({ok: true, bundle: path.relative(root, bundleFile), manifest: path.relative(root, manifestFile), ...manifest}, null, 2));
} finally {
  if (fs.existsSync(staging)) fs.rmSync(staging, {recursive: true, force: true});
}
