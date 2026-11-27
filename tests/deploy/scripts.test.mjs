import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptsDir = path.join(root, 'deploy/scripts');
const expectedScripts = [
  'lib.sh',
  '00-audit-vps.sh',
  '10-prepare-host.sh',
  '15-link-initial-release.sh',
  '20-install-node.sh',
  '30-install-dependencies.sh',
  '40-install-python.sh',
  '50-prepare-state.sh',
  '55-verify-platform.sh',
  '60-verify-storage-import.sh',
  '61-activate-storage-import.sh',
  '70-build-public.sh',
  '80-install-systemd.sh',
  '90-install-nginx-bootstrap.sh',
  '91-issue-certificate.sh',
  '92-enable-nginx-tls.sh',
  '93-install-renewal-hook.sh',
  '95-homologate-vps.sh',
  '96-switch-release.sh',
  '97-rollback-release.sh',
  '99-verify-service-write.sh',
];

function bashSyntax(file) {
  if (process.platform !== 'win32') return spawnSync('bash', ['-n', file], {encoding: 'utf8'});
  const linux = `/mnt/${file[0].toLowerCase()}${file.slice(2).replaceAll('\\', '/')}`;
  return spawnSync('wsl.exe', ['/bin/bash', '-n', linux], {encoding: 'utf8'});
}

test('scripts de implantação estão organizados em etapas independentes', () => {
  const files = fs.readdirSync(scriptsDir).filter((name) => name.endsWith('.sh')).sort();
  assert.deepEqual(files, expectedScripts.slice().sort());
  for (const name of expectedScripts) {
    const text = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
    assert.match(text, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m, name);
  }
});

test('scripts não acessam SSH, não usam sudo e não alteram sistemas alheios', () => {
  const forbidden = [
    /\bssh\s/,
    /\bscp\s/,
    /\bsudo\s/,
    /\bapt(?:-get)?\s+(?:upgrade|dist-upgrade|autoremove)\b/,
    /\bnpm\s+(?:install\s+-g|update\s+-g)\b/,
    /\bpm2\s+(?:restart|reload|delete|stop|start)\b/,
    /\bsystemctl\s+(?:restart|stop|start)\s+(?:nginx|postgresql|pm2)\b/,
    /\bufw\s+(?:enable|disable|reset)\b/,
    /\bchmod\s+(?:-R\s+)?777\b/,
    /\brm\s+-rf\s+\/(?:\s|$)/,
  ];
  for (const name of expectedScripts) {
    const text = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${name}: ${pattern}`);
  }
});

test('scripts Bash passam em verificação sintática', () => {
  for (const name of expectedScripts) {
    const result = bashSyntax(path.join(scriptsDir, name));
    if (result.error?.code === 'ENOENT') continue;
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
  const hook = path.join(root, 'deploy/letsencrypt/renewal-hooks/deploy/pulsobit-nginx.sh');
  const result = bashSyntax(hook);
  if (result.error?.code !== 'ENOENT') assert.equal(result.status, 0, result.stderr);
});

test('Nginx é exclusivo do PulsoBit e não cria servidor default', () => {
  const files = [
    path.join(root, 'deploy/nginx/pulsobit.tech.conf.example'),
    path.join(root, 'deploy/nginx/pulsobit.tech.bootstrap.conf.example'),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /server_name pulsobit\.tech www\.pulsobit\.tech;/);
    assert.doesNotMatch(text, /default_server/);
    assert.doesNotMatch(text, /root\s+\/(?:opt|var\/lib|etc)\//);
  }
  const tls = fs.readFileSync(files[0], 'utf8');
  assert.match(tls, /root \/var\/www\/pulso-digital;/);
  assert.match(tls, /return 301 https:\/\/pulsobit\.tech\$request_uri;/);
  assert.match(tls, /sqlcipher\|sqlite\|db/);
});

test('scripts mantêm automação, IA, indexação e publicidade desativadas', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '1.6.0');
  const site = JSON.parse(fs.readFileSync(path.join(root, 'site/environments.json'), 'utf8'));
  assert.equal(site.environments.production.indexing, false);
  assert.equal(site.environments.production.adsense, false);
  const automation = JSON.parse(fs.readFileSync(path.join(root, 'automation/config.json'), 'utf8'));
  assert.equal(automation.pausedByDefault, true);
  assert.equal(automation.ai.enabled, false);
  assert.equal(automation.ai.freeTierConfirmed, false);
  const systemd = fs.readFileSync(path.join(root, 'deploy/systemd/pulso-digital.service.example'), 'utf8');
  assert.doesNotMatch(systemd, /--confirm-free-tier/);
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'deploy/pd0072-expected-counts.json'), 'utf8'));
  assert.deepEqual(
    {topics: expected.counts.radarTopics, evidence: expected.counts.evidence, drafts: expected.counts.drafts, tokens: expected.ai.chargedTokens},
    {topics: 247, evidence: 81, drafts: 5, tokens: 80423},
  );
});

test('bundle de migração não inclui chave ou .env no código gerador', () => {
  const text = fs.readFileSync(path.join(root, 'tools/create-migration-bundle.mjs'), 'utf8');
  assert.match(text, /containsStorageKey:\s*false/);
  assert.match(text, /containsEnvFile:\s*false/);
  assert.match(text, /storage\/data\/lock/);
  assert.match(text, /A automação local precisa estar pausada/);
  assert.doesNotMatch(text, /copyFileSync\([^)]*\.env/);
  assert.doesNotMatch(text, /['"]\.env['"]/);
});

test('publicação e restauração operam em raiz isolada sem alterar o pai compartilhado', () => {
  const script = path.join(root, 'tests/deploy/publish-simulation.sh');
  const command = process.platform === 'win32' ? 'wsl.exe' : 'bash';
  const args = process.platform === 'win32'
    ? ['/bin/bash', `/mnt/${script[0].toLowerCase()}${script.slice(2).replaceAll('\\', '/')}`]
    : [script];
  const result = spawnSync(command, args, {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PUBLISH_SIMULATION_OK/);
});

test('dry-run do atualizador central funciona em raiz isolada e não troca release', () => {
  const script = path.join(root, 'tests/deploy/update-dry-run-simulation.sh');
  const command = process.platform === 'win32' ? 'wsl.exe' : 'bash';
  const args = process.platform === 'win32'
    ? ['/bin/bash', `/mnt/${script[0].toLowerCase()}${script.slice(2).replaceAll('\\', '/')}`]
    : [script];
  const result = spawnSync(command, args, {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UPDATE_DRY_RUN_SIMULATION_OK/);
});

test('ativação inicial aceita árvore estrutural vazia e recusa arquivos existentes', () => {
  const script = path.join(root, 'tests/deploy/import-activation-simulation.sh');
  const command = process.platform === 'win32' ? 'wsl.exe' : 'bash';
  const args = process.platform === 'win32'
    ? ['/bin/bash', `/mnt/${script[0].toLowerCase()}${script.slice(2).replaceAll('\\', '/')}`]
    : [script];
  const result = spawnSync(command, args, {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /IMPORT_ACTIVATION_SIMULATION_OK/);
});

test('ativação do import aceita somente diretórios estruturais vazios', () => {
  const lib = fs.readFileSync(path.join(scriptsDir, 'lib.sh'), 'utf8');
  assert.match(lib, /find "\$\{active_data\}" -mindepth 1 ! -type d -print -quit/);
  assert.match(lib, /snapshot \$\{snapshot_id\} já existe no estado ativo/);
  assert.doesNotMatch(lib, /rmdir "\$\{active_data\}"/);
  assert.match(lib, /find "\$\{active_data\}"[^\n]+! -type d/);
  const activate = fs.readFileSync(path.join(scriptsDir, '61-activate-storage-import.sh'), 'utf8');
  assert.match(activate, /activate_staged_storage "\$\{active_data\}" "\$\{activation\}" "\$\{snapshot_id\}"/);
});

test('atualização central oferece dry-run, checkpoint, confirmação e rollback automático', () => {
  const update = fs.readFileSync(path.join(scriptsDir, '96-switch-release.sh'), 'utf8');
  assert.match(update, /--dry-run/);
  assert.match(update, /run_storage "\$\{current\}" checkpoint/);
  assert.match(update, /Digite PREPARAR/);
  assert.match(update, /Digite CONFIRMAR/);
  assert.match(update, /on_exit_rollback/);
  assert.match(update, /95-homologate-vps\.sh/);
  assert.doesNotMatch(update, /npm_config_jobs/);
  const rollback = fs.readFileSync(path.join(scriptsDir, '97-rollback-release.sh'), 'utf8');
  assert.match(rollback, /--dry-run/);
  assert.match(rollback, /Digite ROLLBACK/);
  assert.match(rollback, /run_storage "\$\{current\}" checkpoint/);
  assert.match(rollback, /banco e chave não foram alterados/);
});

test('Systemd usa limites na seção Unit e declara escrita Unix necessária', () => {
  const text = fs.readFileSync(path.join(root, 'deploy/systemd/pulso-digital.service.example'), 'utf8');
  const unit = text.match(/\[Unit\]([\s\S]*?)\[Service\]/)?.[1] || '';
  const service = text.match(/\[Service\]([\s\S]*?)\[Install\]/)?.[1] || '';
  assert.match(unit, /StartLimitIntervalSec=300/);
  assert.match(unit, /StartLimitBurst=3/);
  assert.doesNotMatch(service, /StartLimitIntervalSec|StartLimitBurst/);
  assert.match(service, /ReadWritePaths=\/opt\/pulso-digital\/current\/content/);
  assert.match(service, /ReadWritePaths=\/opt\/pulso-digital\/current\/public/);
});

test('Nginx bloqueia privados antes de cache e HTTPS usa hook verificado', () => {
  const nginx = fs.readFileSync(path.join(root, 'deploy/nginx/pulsobit.tech.conf.example'), 'utf8');
  const hidden = nginx.indexOf('location ~ (^|/)\\.');
  const privateFiles = nginx.indexOf('sqlcipher|sqlite|db');
  const assets = nginx.indexOf('location ~* \\.(?:css|js|svg');
  assert.ok(hidden > 0 && hidden < assets);
  assert.ok(privateFiles > 0 && privateFiles < assets);
  assert.match(nginx, /location (?:\^~ )?\/\.well-known\/acme-challenge\//);
  const certbot = fs.readFileSync(path.join(scriptsDir, '91-issue-certificate.sh'), 'utf8');
  assert.match(certbot, /--webroot/);
  assert.doesNotMatch(certbot, /--dns-cloudflare/);
  const hook = fs.readFileSync(path.join(root, 'deploy/letsencrypt/renewal-hooks/deploy/pulsobit-nginx.sh'), 'utf8');
  assert.match(hook, /nginx -t/);
  assert.match(hook, /systemctl reload nginx/);
  assert.match(hook, /RENEWED_LINEAGE/);
});

test('run_npm prioriza o Node independente e não usa npm_config_jobs', () => {
  const text = fs.readFileSync(path.join(scriptsDir, 'lib.sh'), 'utf8');
  assert.match(text, /PATH="\$\{NODE_ROOT\}\/bin:\$\{PATH\}"/);
  assert.doesNotMatch(text, /npm_config_jobs/);
  const dependencies = fs.readFileSync(path.join(scriptsDir, '30-install-dependencies.sh'), 'utf8');
  assert.match(dependencies, /new Database\(':memory:'\)/);
  assert.match(dependencies, /sqlite-native-memory-ok/);
});
