import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class StorageError extends Error {
  constructor(code, message, details = null) {
    super(message, details ? {cause: details} : undefined);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function check(condition, code, message) {
  if (!condition) throw new StorageError(code, message);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n');
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function readJson(file, maxBytes = 1048576) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes, 'FILE_INVALID', `Arquivo inválido ou acima do limite: ${path.basename(file)}.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function chmodBestEffort(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Windows pode ignorar modos POSIX; as permissões da conta ainda se aplicam.
  }
}

export function ensureDirectory(directory, mode = 0o700) {
  fs.mkdirSync(directory, {recursive: true});
  chmodBestEffort(directory, mode);
}

export function atomicWrite(target, bytes, mode = 0o600) {
  const directory = path.dirname(target);
  ensureDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(target)}.tmp-${crypto.randomUUID()}`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    chmodBestEffort(target, mode);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (fs.existsSync(temporary)) {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
}

export function isInside(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function toPosix(relative) {
  return relative.split(path.sep).join('/');
}

export function safeRelativePath(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 4096, 'PATH_INVALID', 'Caminho relativo inválido.');
  const normalized = value.replaceAll('\\', '/');
  check(!normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized), 'PATH_INVALID', 'Caminho absoluto não permitido.');
  const parts = normalized.split('/');
  check(parts.every((part) => part && part !== '.' && part !== '..' && !part.includes('\0')), 'PATH_INVALID', 'Caminho com segmento não permitido.');
  return parts.join('/');
}

export function mediaTypeFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.json') return 'application/json';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

export function gitCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
