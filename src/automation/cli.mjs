import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {check, StorageError} from '../storage/common.mjs';
import {AutomationOrchestrator} from './orchestrator.mjs';

const help = `Pulso Digital — automação editorial
Uso: npm run automation -- COMANDO [opções]

help | status | init | plan | health | metrics [--json]
run --once [--confirm-free-tier] | run --dry-run
start [--max-iterations N] [--confirm-free-tier]
pause --reason "Motivo" | resume
jobs [--limit N] | history [--limit N]
recover --reason "Motivo"

A automação inicia pausada. O backend é o SQLite operacional ativo.
start é primeiro plano, sem daemon próprio. Não há publicação automática.
`;

const commands = new Set(['help', 'status', 'init', 'plan', 'run', 'start', 'pause', 'resume', 'jobs', 'history', 'health', 'metrics', 'recover']);
const booleanOptions = new Set(['json', 'once', 'dry-run', 'confirm-free-tier']);
const valueOptions = new Set(['root', 'reason', 'limit', 'max-iterations']);

function parse(argv) {
  const opts = {}, args = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    const key = arg.slice(2);
    check(booleanOptions.has(key) || valueOptions.has(key), 'CLI', `Opção desconhecida: --${key}.`);
    check(!Object.hasOwn(opts, key), 'CLI', `Opção repetida: --${key}.`);
    if (booleanOptions.has(key)) opts[key] = true;
    else {
      check(argv[index + 1] && !argv[index + 1].startsWith('--'), 'CLI', `Valor ausente para --${key}.`);
      opts[key] = argv[++index];
    }
  }
  const command = args[0] || 'help';
  check(commands.has(command), 'CLI', 'Comando desconhecido; execute automation help.');
  check(args.length === 1, 'CLI', 'Comando aceita apenas opções nomeadas.');
  return {command, opts};
}

export async function main(argv = process.argv.slice(2)) {
  let opts = {};
  try {
    const parsed = parse(argv);
    opts = parsed.opts;
    const root = path.resolve(opts.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
    const orchestrator = new AutomationOrchestrator(root);
    let result;
    switch (parsed.command) {
      case 'help':
        console.log(opts.json ? JSON.stringify({ok: true, help}) : help);
        return 0;
      case 'init': result = {command: 'init', ...orchestrator.init()}; break;
      case 'status': result = {command: 'status', ...orchestrator.status()}; break;
      case 'plan': result = {command: 'plan', ...orchestrator.plan()}; break;
      case 'pause':
        check(opts.reason, 'CLI', 'Use --reason para pausar.');
        result = {command: 'pause', ...orchestrator.pause(opts.reason)};
        break;
      case 'resume': result = {command: 'resume', ...orchestrator.resume()}; break;
      case 'jobs': {
        const limit = opts.limit ? Number(opts.limit) : 50;
        check(Number.isInteger(limit) && limit > 0 && limit <= 500, 'CLI', '--limit inválido.');
        result = {command: 'jobs', jobs: orchestrator.jobs({limit})};
        break;
      }
      case 'history': {
        const limit = opts.limit ? Number(opts.limit) : 50;
        check(Number.isInteger(limit) && limit > 0 && limit <= 500, 'CLI', '--limit inválido.');
        result = {command: 'history', runs: orchestrator.history({limit})};
        break;
      }
      case 'health': result = {command: 'health', ...orchestrator.health()}; break;
      case 'metrics': result = {command: 'metrics', ...orchestrator.metrics()}; break;
      case 'run': {
        check(opts.once || opts['dry-run'], 'CLI', 'Use run --once ou run --dry-run.');
        check(!(opts.once && opts['dry-run']), 'CLI', 'Escolha --once ou --dry-run.');
        result = {
          command: 'run',
          ...(await orchestrator.runOnce({
            dryRun: Boolean(opts['dry-run']),
            freeTierConfirmed: Boolean(opts['confirm-free-tier']),
          })),
        };
        break;
      }
      case 'start':
        result = {
          command: 'start',
          ...(await orchestrator.start({
            maxIterations: opts['max-iterations'] ? Number(opts['max-iterations']) : null,
            freeTierConfirmed: Boolean(opts['confirm-free-tier']),
          })),
        };
        break;
      case 'recover':
        check(opts.reason, 'CLI', 'Use --reason para recuperar.');
        result = {command: 'recover', ...orchestrator.recover(opts.reason)};
        break;
      default: throw new StorageError('CLI', 'Comando não implementado.');
    }
    console.log(opts.json ? JSON.stringify({ok: true, result}) : JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    const payload = {ok: false, error: {code: error.code || 'ERROR', message: error.message || String(error), details: error.details || null}};
    console.error(opts.json ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
    if (['PAUSED', 'FREE_TIER_UNCONFIRMED', 'AI_DISABLED', 'BACKEND_REQUIRED', 'BACKEND_UNAVAILABLE'].includes(payload.error.code)) return 3;
    if (['LEASE_BUSY', 'LOCK_BUSY', 'OPERATIONAL_CONFLICT', 'RECOVERY_REQUIRED', 'RECOVERY_CONFLICT'].includes(payload.error.code)) return 4;
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
