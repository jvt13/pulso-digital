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
  '95-homologate-vps.sh',
  '96-switch-release.sh',
  '97-rollback-release.sh',
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
