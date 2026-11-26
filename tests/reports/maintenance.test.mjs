import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  archiveCleanupCandidates,
  cleanupPlan,
  executeReportCleanup,
  inventoryReports,
  removeArchivedReportFiles,
  recoverArchivedReportFile,
  verifyEncryptedReportArchive,
} from '../../src/reports/maintenance.mjs';
import {sha256File} from '../../src/storage/common.mjs';

const key = Buffer.alloc(32, 7);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-reports-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.copyFileSync(path.resolve('reports-policy.json'), path.join(root, 'reports-policy.json'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'pulso-digital', version: '1.5.0'}));
  const reports = path.join(root, 'reports');
  fs.mkdirSync(path.join(reports, 'evidence', 'latest'), {recursive: true});
  fs.mkdirSync(path.join(reports, 'evidence', 'pending'), {recursive: true});
  fs.mkdirSync(path.join(reports, 'pd001-old'), {recursive: true});
  fs.writeFileSync(path.join(reports, 'report.md'), '# Current\n');
  fs.writeFileSync(path.join(reports, 'project-status.md'), '# Status\n');
  fs.writeFileSync(path.join(reports, 'checkpoint.md'), '# Checkpoint\n');
  fs.writeFileSync(path.join(reports, 'evidence', 'latest', 'keep.json'), '{"keep":true}\n');
  fs.writeFileSync(path.join(reports, 'evidence', 'pending', 'pending.json'), '{"pending":true}\n');
  fs.writeFileSync(path.join(reports, 'pd001-old', 'run.log'), 'old log\n');
  fs.writeFileSync(path.join(reports, 'pd001-old', 'duplicate.bin'), 'duplicate\n');
  fs.writeFileSync(path.join(reports, 'pd002-old.bin'), 'duplicate\n');
  fs.writeFileSync(path.join(reports, 'unknown.custom'), 'unique unknown\n');
  return {root, reports};
}

test('reports: inventário calcula arquivos, tamanho, diretórios e duplicidades', t => {
  const fx = fixture(t);
  const inventory = inventoryReports(fx.root);
  assert.equal(inventory.files, 9);
  assert.equal(inventory.directories, 4);
  assert(inventory.totalBytes > 0);
  assert.equal(inventory.duplicates.length, 1);
  assert.equal(inventory.duplicates[0].paths.length, 2);
});

test('reports: plano preserva essenciais, pendências e arquivos desconhecidos', t => {
  const fx = fixture(t);
  const plan = cleanupPlan(fx.root);
  const categories = Object.fromEntries(plan.classified.map((item) => [item.path, item.category]));
  assert.equal(categories['report.md'], 'essential');
  assert.equal(categories['evidence/latest/keep.json'], 'pending');
  assert.equal(categories['evidence/pending/pending.json'], 'pending');
  assert.equal(categories['unknown.custom'], 'unknown');
  assert(['obsolete', 'reproducible'].includes(categories['pd001-old/run.log']));
  assert(!plan.removable.some((item) => item.path === 'unknown.custom'));
  assert(!plan.removable.some((item) => item.path.startsWith('evidence/')));
});

test('reports: arquivo de segurança é criptografado, externo e verificável', t => {
  const fx = fixture(t);
  const archivePath = 'storage/archive/reports/test.pulso';
  const created = archiveCleanupCandidates(fx.root, {archivePath, key});
  assert.equal(created.verified.authenticated, true);
  assert.equal(created.archive.files, created.plan.removable.length);
  assert(fs.existsSync(path.join(fx.root, archivePath)));
  const bytes = fs.readFileSync(path.join(fx.root, archivePath));
  assert(!bytes.toString('utf8').includes('old log'));
  assert.deepEqual(verifyEncryptedReportArchive(fx.root, {archivePath, key}).files, created.archive.files);
});

test('reports: limpeza remove somente candidatos arquivados e preserva evidências', t => {
  const fx = fixture(t);
  const archivePath = 'storage/archive/reports/cleanup.pulso';
  const beforePlan = cleanupPlan(fx.root);
  archiveCleanupCandidates(fx.root, {archivePath, key});
  const result = executeReportCleanup(fx.root, {archivePath, key, confirm: true});
  assert.equal(result.status, 'completed');
  assert.equal(result.removedFiles, beforePlan.removable.length);
  assert(fs.existsSync(path.join(fx.reports, 'report.md')));
  assert(fs.existsSync(path.join(fx.reports, 'project-status.md')));
  assert(fs.existsSync(path.join(fx.reports, 'checkpoint.md')));
  assert(fs.existsSync(path.join(fx.reports, 'evidence', 'latest', 'keep.json')));
  assert(fs.existsSync(path.join(fx.reports, 'evidence', 'pending', 'pending.json')));
  assert(fs.existsSync(path.join(fx.reports, 'unknown.custom')));
  assert.equal(fs.existsSync(path.join(fx.reports, 'pd001-old', 'run.log')), false);
  assert(fs.existsSync(path.join(fx.reports, 'cleanup-manifest.json')));
  assert.equal(result.inventoryAfter.files < result.inventoryBefore.files, true);
});

test('reports: limpeza recusa candidato ausente do arquivo de segurança', t => {
  const fx = fixture(t);
  const archivePath = 'storage/archive/reports/guard.pulso';
  archiveCleanupCandidates(fx.root, {archivePath, key});
  assert.throws(() => removeArchivedReportFiles(fx.root, [{path: '../outside.txt', bytes: 1, sha256: '0'.repeat(64)}], {archivePath, key}), {code: 'REPORT_SCOPE'});
});

test('reports: recuperação seletiva restaura bytes exatos em diretório isolado', t => {
  const fx = fixture(t);
  const archivePath = 'storage/archive/reports/selective.pulso';
  const created = archiveCleanupCandidates(fx.root, {archivePath, key});
  const selected = created.plan.removable[0];
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-report-recovery-'));
  t.after(() => fs.rmSync(isolated, {recursive: true, force: true}));
  const recovered = recoverArchivedReportFile(fx.root, {
    archivePath,
    key,
    path: selected.path,
    target: path.relative(fx.root, path.join(isolated, 'recovered.bin')),
  });
  assert.equal(recovered.verified, true);
  assert.equal(sha256File(path.join(isolated, 'recovered.bin')), selected.sha256);
});

test('reports: symlink ou junction interrompe o inventário', t => {
  const fx = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-reports-outside-'));
  t.after(() => fs.rmSync(outside, {recursive: true, force: true}));
  fs.symlinkSync(outside, path.join(fx.reports, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inventoryReports(fx.root), {code: 'REPORT_SYMLINK'});
});
