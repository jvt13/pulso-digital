import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {atomicWrite,check,jsonBytes,sha256} from '../storage/common.mjs';
import {loadStorageKey} from '../storage/env.mjs';

const MAGIC = Buffer.from('PULSO-REPORT-ARCHIVE-1\n', 'utf8');

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function walk(root, directory, output) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    const stat = fs.lstatSync(target);
    check(!stat.isSymbolicLink(), 'REPORT_SYMLINK', 'Links simbólicos não são permitidos no inventário de relatórios.', {path: relative(root, target)});
    if (stat.isDirectory()) walk(root, target, output);
    else if (stat.isFile()) {
      const bytes = fs.readFileSync(target);
      output.push({
        path: relative(root, target),
        bytes: bytes.length,
        mtime: stat.mtime.toISOString(),
        sha256: sha256(bytes),
      });
    }
  }
}

export function loadReportsPolicy(root) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'reports-policy.json'), 'utf8'));
  check(policy.schemaVersion === '1.0' && Array.isArray(policy.essentialPaths) && Array.isArray(policy.pendingPrefixes) && Array.isArray(policy.removableCategories), 'REPORT_POLICY', 'Política de relatórios inválida.');
  return policy;
}

export function inventoryReports(root, policy = loadReportsPolicy(root)) {
  const reportsRoot = path.join(root, policy.reportsDirectory);
  check(fs.existsSync(reportsRoot), 'REPORTS_MISSING', 'Diretório reports ausente.');
  const directories = [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      check(!stat.isSymbolicLink(), 'REPORT_SYMLINK', 'Links simbólicos não são permitidos.', {path: relative(root, target)});
      if (stat.isDirectory()) {
        directories.push(relative(root, target));
        visit(target);
      }
    }
  };
  visit(reportsRoot);
  walk(reportsRoot, reportsRoot, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const duplicates = Object.values(Object.groupBy(files, (item) => `${item.bytes}:${item.sha256}`))
    .filter((items) => items.length > 1)
    .map((items) => ({sha256: items[0].sha256, bytes: items[0].bytes, paths: items.map((item) => item.path)}));
  return {
    generatedAt: new Date().toISOString(),
    root: relative(root, reportsRoot),
    files: files.length,
    directories: directories.length,
    totalBytes: files.reduce((total, item) => total + item.bytes, 0),
    filesList: files,
    directoriesList: directories.sort(),
    duplicates,
  };
}

export function classifyReports(inventory, policy = null) {
  policy ||= {
    essentialPaths: ['report.md', 'project-status.md', 'checkpoint.md', 'cleanup-manifest.json'],
    pendingPrefixes: ['evidence/latest/', 'evidence/pending/'],
    tempSuffixes: ['.tmp', '.part'],
    reproducibleSuffixes: ['.log', '.tap'],
    reproduciblePrefixes: ['pages-artifact/', 'pd002-lighthouse-before/', 'pd002-lighthouse-after/', 'pd0061-restore-'],
    obsoleteTaskPattern: '^pd[0-9]+',
    removableCategories: ['duplicate', 'reproducible', 'obsolete'],
  };
  const duplicatePaths = new Set(inventory.duplicates.flatMap((group) => group.paths.slice(1)));
  const obsolete = new RegExp(policy.obsoleteTaskPattern);
  return inventory.filesList.map((item) => {
    let category = 'unknown';
    if (policy.essentialPaths.includes(item.path)) category = 'essential';
    else if (policy.pendingPrefixes.some((prefix) => item.path.startsWith(prefix))) category = 'pending';
    else if (duplicatePaths.has(item.path)) category = 'duplicate';
    else if (policy.tempSuffixes.some((suffix) => item.path.endsWith(suffix))) category = 'reproducible';
    else if ([...policy.reproducibleSuffixes, '.png', '.jpg', '.jpeg', '.webp'].some((suffix) => item.path.endsWith(suffix))) category = 'reproducible';
    else if (policy.reproduciblePrefixes.some((prefix) => item.path.startsWith(prefix))) category = 'reproducible';
    else if (item.path.startsWith('.pd00661-report-preserved')) category = 'obsolete';
    else if (obsolete.test(item.path)) category = 'obsolete';
    return {...item, category, removable: policy.removableCategories.includes(category)};
  });
}

export function cleanupPlan(root) {
  const policy = loadReportsPolicy(root);
  const inventory = inventoryReports(root, policy);
  const classified = classifyReports(inventory, policy);
  return {
    policy,
    inventory,
    classified,
    removable: classified.filter((item) => item.removable),
    preserved: classified.filter((item) => !item.removable),
    removalBytes: classified.filter((item) => item.removable).reduce((total, item) => total + item.bytes, 0),
  };
}

function archiveKey(key) {
  return Buffer.from(crypto.hkdfSync('sha256', key, Buffer.from('pulso-report-archive-v1'), Buffer.from('reports-aes-256-gcm'), 32));
}

export function createEncryptedReportArchive(root, files, {archivePath, key} = {}) {
  check(Buffer.isBuffer(key) && key.length === 32, 'STORAGE_KEY_INVALID', 'Chave de arquivo inválida.');
  const reportsRoot = path.join(root, 'reports');
  const body = {
    format: 'pulso-report-archive',
    formatVersion: '1.0',
    createdAt: new Date().toISOString(),
    files: files.map((item) => {
      const target = path.resolve(reportsRoot, item.path);
      check(target.startsWith(reportsRoot + path.sep), 'REPORT_SCOPE', 'Arquivo fora de reports.');
      const bytes = fs.readFileSync(target);
      check(sha256(bytes) === item.sha256, 'REPORT_CHANGED', 'Relatório mudou após o inventário.', {path: item.path});
      return {...item, content: bytes.toString('base64')};
    }),
  };
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(body)));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', archiveKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const header = Buffer.from(JSON.stringify({
    formatVersion: '1.0',
    algorithm: 'aes-256-gcm',
    compression: 'gzip',
    keyFingerprint: sha256(key).slice(0, 16),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    files: files.length,
    totalBytes: files.reduce((total, item) => total + item.bytes, 0),
  }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const destination = path.resolve(root, archivePath);
  check(destination.startsWith(root + path.sep), 'ARCHIVE_SCOPE', 'Arquivo de segurança deve permanecer na raiz do projeto.');
  check(!destination.startsWith(path.join(root, 'reports') + path.sep), 'ARCHIVE_SCOPE', 'Arquivo de segurança deve ficar fora de reports.');
  check(!fs.existsSync(destination), 'ARCHIVE_EXISTS', 'Arquivo de segurança já existe; escolha um novo caminho.');
  fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, Buffer.concat([MAGIC, length, header, encrypted]), {mode: 0o600, flag: 'wx'});
  fs.renameSync(temporary, destination);
  try { fs.chmodSync(destination, 0o600); } catch {}
  return {archivePath: relative(root, destination), sha256: sha256(fs.readFileSync(destination)), files: files.length, totalBytes: files.reduce((total, item) => total + item.bytes, 0)};
}

export function verifyEncryptedReportArchive(root, {archivePath, key} = {}) {
  check(Buffer.isBuffer(key) && key.length === 32, 'STORAGE_KEY_INVALID', 'Chave de arquivo inválida.');
  const bytes = fs.readFileSync(path.resolve(root, archivePath));
  check(bytes.subarray(0, MAGIC.length).equals(MAGIC), 'ARCHIVE_INVALID', 'Cabeçalho do arquivo de segurança inválido.');
  let offset = MAGIC.length;
  const headerLength = bytes.readUInt32BE(offset);
  offset += 4;
  const header = JSON.parse(bytes.subarray(offset, offset + headerLength).toString('utf8'));
  offset += headerLength;
  check(header.algorithm === 'aes-256-gcm' && header.compression === 'gzip', 'ARCHIVE_INVALID', 'Formato do arquivo de segurança inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', archiveKey(key), Buffer.from(header.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(header.tag, 'base64'));
  const plain = zlib.gunzipSync(Buffer.concat([decipher.update(bytes.subarray(offset)), decipher.final()]));
  const body = JSON.parse(plain.toString('utf8'));
  check(body.format === 'pulso-report-archive' && body.formatVersion === '1.0' && Array.isArray(body.files), 'ARCHIVE_INVALID', 'Conteúdo do arquivo de segurança inválido.');
  for (const file of body.files) {
    const content = Buffer.from(file.content, 'base64');
    check(content.length === file.bytes && sha256(content) === file.sha256, 'ARCHIVE_INVALID', `Arquivo interno diverge: ${file.path}.`);
  }
  return {authenticated: true, files: body.files.length, totalBytes: body.files.reduce((total, item) => total + item.bytes, 0), createdAt: body.createdAt, archiveSha256: sha256(bytes), filesList: body.files.map(({content, ...item}) => item)};
}

export function removeArchivedReportFiles(root, removable, {archivePath, key} = {}) {
  const reportsRoot = path.join(root, 'reports');
  const verified = verifyEncryptedReportArchive(root, {archivePath, key});
  const archived = new Map(verified.filesList.map((item) => [item.path, item.sha256]));
  for (const item of removable) {
    check(archived.get(item.path) === item.sha256, 'REPORT_SCOPE', 'Arquivo candidato não consta no arquivo de segurança.', {path: item.path});
    const target = path.resolve(reportsRoot, item.path);
    check(target.startsWith(reportsRoot + path.sep), 'REPORT_SCOPE', 'Remoção fora de reports bloqueada.');
    check(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), 'REPORT_SCOPE', 'Somente arquivos regulares podem ser removidos.', {path: item.path});
    check(sha256(fs.readFileSync(target)) === item.sha256, 'REPORT_CHANGED', 'Arquivo mudou após o arquivo de segurança.', {path: item.path});
    fs.unlinkSync(target);
  }
  const directories = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.isDirectory()) collect(path.join(directory, entry.name));
    }
    directories.push(directory);
  };
  collect(reportsRoot);
  for (const directory of directories.sort((left, right) => right.length - left.length)) {
    if (directory !== reportsRoot && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
  return {removedFiles: removable.length, removedBytes: removable.reduce((total, item) => total + item.bytes, 0)};
}

export function archiveCleanupCandidates(root, {archivePath, key = null} = {}) {
  const loaded = key ? {key} : loadStorageKey(root);
  const plan = cleanupPlan(root);
  const archive = createEncryptedReportArchive(root, plan.removable, {archivePath, key: loaded.key});
  return {plan, archive, verified: verifyEncryptedReportArchive(root, {archivePath, key: loaded.key})};
}

export function executeReportCleanup(root, {archivePath, key = null, confirm = false} = {}) {
  check(confirm === true, 'CONFIRM_REQUIRED', 'Confirmação explícita obrigatória para limpar reports.');
  const loaded = key ? {key} : loadStorageKey(root);
  const before = inventoryReports(root);
  const plan = cleanupPlan(root);
  const manifestPath = path.join(root, 'reports', 'cleanup-manifest.json');
  atomicWrite(manifestPath, jsonBytes({
    schemaVersion: '1.0',
    status: 'in-progress',
    startedAt: new Date().toISOString(),
    inventoryBefore: {files: before.files, directories: before.directories, totalBytes: before.totalBytes},
    candidates: plan.removable,
    archivePath,
  }));
  const removed = removeArchivedReportFiles(root, plan.removable, {archivePath, key: loaded.key});
  const after = inventoryReports(root);
  const manifest = {
    schemaVersion: '1.0',
    status: 'completed',
    completedAt: new Date().toISOString(),
    inventoryBefore: {files: before.files, directories: before.directories, totalBytes: before.totalBytes},
    inventoryAfter: {files: after.files, directories: after.directories, totalBytes: after.totalBytes},
    preserved: plan.preserved.map(({path, category, bytes, sha256}) => ({path, category, bytes, sha256})),
    removed: plan.removable.map(({path, category, bytes, sha256, mtime}) => ({path, category, bytes, sha256, mtime})),
    removedFiles: removed.removedFiles,
    removedBytes: removed.removedBytes,
    archivePath,
    archiveIntegrity: verifyEncryptedReportArchive(root, {archivePath, key: loaded.key}).authenticated,
    pending: [],
  };
  atomicWrite(manifestPath, jsonBytes(manifest));
  return {...manifest, finalInventory: after};
}
