import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {check, StorageError} from './common.mjs';
import {generateStorageKey, loadStorageKey, writeStorageKey} from './env.mjs';
import {verifySnapshot} from './integrity.mjs';
import {
  checkpointPlan,
  createCheckpoint,
  listSnapshots,
  loadProjectConfig,
  recoverStorageLock,
  selectSnapshot,
} from './snapshots.mjs';
import {restoreSnapshot} from './exporter.mjs';

const help = `Pulso Digital - armazenamento criptografado
Uso: npm run storage -- COMANDO [opções]

help | status | checkpoint [--dry-run] | verify | inspect
metrics [--json] | restore --dry-run | restore --target DIRETORIO
keygen [--env-file ARQUIVO] | recover --reason "Justificativa"

Opções globais: --root DIRETORIO, --json, --snapshot ID
A chave é lida de PULSO_STORAGE_KEY no ambiente ou .env e nunca é exibida.
Nenhum comando acessa IA, aprova ou publica conteúdo.
`;

const commands = {
  help: {values: [], flags: []},
  status: {values: ['snapshot'], flags: []},
  checkpoint: {values: [], flags: ['dry-run']},
  verify: {values: ['snapshot'], flags: []},
  inspect: {values: ['snapshot'], flags: []},
  metrics: {values: ['snapshot'], flags: []},
  restore: {values: ['target', 'snapshot'], flags: ['dry-run']},
  keygen: {values: ['env-file'], flags: []},
  recover: {values: ['reason'], flags: []},
};

function parse(argv) {
  const opts = {};
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      args.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (['json', 'dry-run'].includes(key)) {
      check(opts[key] === undefined, 'CLI', `Opção repetida: ${key}.`);
      opts[key] = true;
    } else if (key === 'root') {
      check(opts[key] === undefined, 'CLI', `Opção repetida: ${key}.`);
      opts[key] = argv[++index];
      check(opts[key] && !opts[key].startsWith('--'), 'CLI', '--root exige valor.');
    } else {
      check(!key.startsWith('-'), 'CLI', 'Opção inválida.');
      opts[key] = argv[++index];
      check(opts[key] !== undefined && !opts[key].startsWith('--'), 'CLI', `--${key} exige valor.`);
    }
  }
  const [command = 'help'] = args;
  check(commands[command], 'CLI', 'Comando desconhecido; execute storage help.');
  check(args.length === 1, 'CLI', 'Comando aceita apenas opções nomeadas.');
  const allowed = new Set(['root', 'json', ...commands[command].values, ...commands[command].flags]);
  for (const key of Object.keys(opts)) check(allowed.has(key), 'CLI', `Opção não permitida para ${command}: --${key}.`);
  return {command, opts};
}

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/') || '.';
}

export async function main(argv = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  let opts = {};
  try {
    const parsed = parse(argv);
    opts = parsed.opts;
    const root = path.resolve(opts.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
    if (parsed.command === 'help') {
      console.log(opts.json ? JSON.stringify({ok: true, help}) : help);
      return 0;
    }
    const {config, packageJson} = loadProjectConfig(root);
    let result;
    switch (parsed.command) {
      case 'keygen': {
        const key = generateStorageKey();
        const written = writeStorageKey(root, key, {envFile: opts['env-file'] || '.env'});
        result = {command: 'keygen', ...written, keyExposed: false};
        break;
      }
      case 'status': {
        const loaded = loadStorageKey(root, {required: false});
        const snapshots = listSnapshots(root, config);
        const sourceLocks = config.sources.sourceLockPaths.filter((item) => fs.existsSync(path.join(root, item)));
        result = {
          command: 'status',
          version: packageJson.version,
          format: config.format,
          formatVersion: config.formatVersion,
          cipher: config.database.cipher,
          keyConfigured: Boolean(loaded),
          keySource: loaded?.source || null,
          keyFingerprint: loaded?.fingerprint || null,
          storageLocked: fs.existsSync(path.join(root, config.paths.lock)),
          sourceLocks,
          snapshotCount: snapshots.length,
          latest: snapshots[0] || null,
          snapshots,
          dataDirectory: config.paths.data,
          automaticApproval: false,
          automaticPublication: false,
        };
        break;
      }
      case 'checkpoint': {
        if (opts['dry-run']) {
          result = {command: 'checkpoint', ...checkpointPlan(root, config)};
        } else {
          const loaded = loadStorageKey(root);
          check(loaded, 'STORAGE_KEY_MISSING', 'Chave de armazenamento ausente.');
          result = {command: 'checkpoint', ...createCheckpoint(root, config, packageJson, loaded.key)};
        }
        break;
      }
      case 'verify': {
        const loaded = loadStorageKey(root);
        check(loaded, 'STORAGE_KEY_MISSING', 'Chave de armazenamento ausente.');
        const selected = selectSnapshot(root, config, opts.snapshot || null);
        const verified = verifySnapshot(selected.directory, loaded.key, config);
        result = {
          command: 'verify',
          snapshotId: verified.snapshotId,
          createdAt: verified.createdAt,
          authenticated: verified.authenticated,
          integrity: verified.integrity,
          manifest: verified.manifest,
        };
        break;
      }
      case 'inspect': {
        const loaded = loadStorageKey(root, {required: false});
        const selected = selectSnapshot(root, config, opts.snapshot || null);
        if (loaded) {
          const verified = verifySnapshot(selected.directory, loaded.key, config);
          result = {
            command: 'inspect',
            snapshotId: verified.snapshotId,
            authenticated: true,
            integrity: verified.integrity,
            manifest: verified.manifest,
            metrics: verified.metrics,
          };
        } else {
          result = {
            command: 'inspect',
            snapshotId: selected.manifest.snapshotId,
            authenticated: false,
            warning: 'Defina PULSO_STORAGE_KEY para autenticar o manifesto e consultar métricas.',
            manifest: selected.manifest,
          };
        }
        break;
      }
      case 'metrics': {
        const loaded = loadStorageKey(root);
        check(loaded, 'STORAGE_KEY_MISSING', 'Chave de armazenamento ausente.');
        const selected = selectSnapshot(root, config, opts.snapshot || null);
        const verified = verifySnapshot(selected.directory, loaded.key, config);
        result = {command: 'metrics', snapshotId: verified.snapshotId, metrics: verified.metrics};
        break;
      }
      case 'restore': {
        const loaded = loadStorageKey(root);
        check(loaded, 'STORAGE_KEY_MISSING', 'Chave de armazenamento ausente.');
        if (!opts['dry-run']) check(opts.target, 'TARGET_REQUIRED', 'Use --target para restauração real ou --dry-run para simulação.');
        const selected = selectSnapshot(root, config, opts.snapshot || null);
        result = {
          command: 'restore',
          snapshotId: selected.manifest.snapshotId,
          ...restoreSnapshot({
            snapshotDir: selected.directory,
            key: loaded.key,
            config,
            target: opts.target || null,
            dryRun: Boolean(opts['dry-run']),
          }),
        };
        break;
      }
      case 'recover': {
        result = {command: 'recover', ...recoverStorageLock(root, config, opts.reason)};
        break;
      }
      default:
        throw new StorageError('CLI', 'Comando não implementado.');
    }
    const output = {ok: true, startedAt, finishedAt: new Date().toISOString(), result};
    console.log(opts.json ? JSON.stringify(output) : JSON.stringify(output, null, 2));
    return 0;
  } catch (error) {
    const code = error?.code || 'ERROR';
    const payload = {ok: false, code, message: error?.message || 'Falha na operação de armazenamento.'};
    console.error(opts.json ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
    if (/^(STORAGE_KEY_MISSING|STORAGE_KEY_INVALID|KEY_MISMATCH)$/.test(code)) return 3;
    if (/^(LOCK_BUSY|SOURCE_BUSY|IO|EACCES|EPERM)$/.test(code)) return 4;
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
