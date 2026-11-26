import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {check} from '../storage/common.mjs';
import {
  archiveCleanupCandidates,
  cleanupPlan,
  executeReportCleanup,
  inventoryReports,
} from './maintenance.mjs';

const help = `Pulso Digital — manutenção de relatórios
Uso: npm run reports -- COMANDO [opções]

help | inventory | plan
archive --archive CAMINHO
cleanup --archive CAMINHO --confirm

--root DIRETORIO | --json
O arquivo de segurança deve ficar fora de reports/, usa AES-256-GCM com a chave local e
nunca é impresso ou enviado externamente.`;

function parse(argv) {
  const opts = {}, args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) { args.push(arg); continue; }
    const key = arg.slice(2);
    if (key === 'json' || key === 'confirm') opts[key] = true;
    else {
      check(['root', 'archive'].includes(key), 'CLI', `Opção desconhecida: ${key}.`);
      check(argv[index + 1] && !argv[index + 1].startsWith('--'), 'CLI', `Valor ausente para ${key}.`);
      opts[key] = argv[++index];
    }
  }
  check(args.length === 1, 'CLI', 'Informe um comando.');
  return {command: args[0], opts};
}

export async function main(argv = process.argv.slice(2)) {
  let opts = {};
  try {
    const parsed = parse(argv);
    opts = parsed.opts;
    const root = path.resolve(opts.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
    let result;
    if (parsed.command === 'help') result = {help};
    else if (parsed.command === 'inventory') result = inventoryReports(root);
    else if (parsed.command === 'plan') result = cleanupPlan(root);
    else if (parsed.command === 'archive') {
      check(opts.archive, 'CLI', 'Use --archive CAMINHO.');
      result = archiveCleanupCandidates(root, {archivePath: opts.archive});
    } else if (parsed.command === 'cleanup') {
      check(opts.archive && opts.confirm, 'CLI', 'Use --archive CAMINHO --confirm.');
      result = executeReportCleanup(root, {archivePath: opts.archive, confirm: true});
    } else check(false, 'CLI', 'Comando desconhecido; execute help.');
    console.log(opts.json ? JSON.stringify({ok: true, result}) : JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    const payload = {ok: false, error: {code: error.code || 'ERROR', message: error.message, details: error.details || null}};
    console.error(opts.json ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
    return /^(REPORT_SCOPE|ARCHIVE_INVALID|REPORT_CHANGED)/.test(payload.error.code) ? 4 : 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
