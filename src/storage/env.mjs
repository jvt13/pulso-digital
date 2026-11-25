import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {StorageError, atomicWrite, check, chmodBestEffort, sha256} from './common.mjs';

const KEY_NAME = 'PULSO_STORAGE_KEY';

function parseValue(raw) {
  let value = String(raw || '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

export function parseStorageKey(raw) {
  const value = parseValue(raw);
  check(value, 'STORAGE_KEY_MISSING', `${KEY_NAME} não configurada.`);
  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else key = Buffer.from(value, 'base64url');
  check(key.length === 32, 'STORAGE_KEY_INVALID', `${KEY_NAME} deve representar exatamente 32 bytes.`);
  return key;
}

export function storageKeyFingerprint(key) {
  return sha256(key).slice(0, 16);
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {text: '', lines: []};
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, 'ENV_INVALID', 'Arquivo .env inválido.');
  const text = fs.readFileSync(file, 'utf8');
  return {text, lines: text.split(/\r?\n/)};
}

export function loadStorageKey(root, {required = true} = {}) {
  let raw = process.env[KEY_NAME];
  let source = raw ? 'environment' : null;
  if (!raw) {
    const envFile = path.join(root, '.env');
    const {lines} = readEnvFile(envFile);
    const matches = lines.filter((line) => new RegExp(`^\\s*${KEY_NAME}\\s*=`).test(line));
    check(matches.length <= 1, 'ENV_INVALID', `${KEY_NAME} aparece mais de uma vez no .env.`);
    if (matches.length === 1) {
      raw = parseValue(matches[0].split('=').slice(1).join('='));
      source = '.env';
    }
  }
  if (!raw) {
    if (!required) return null;
    throw new StorageError('STORAGE_KEY_MISSING', `${KEY_NAME} não configurada; execute storage keygen ou defina a variável.`);
  }
  return {key: parseStorageKey(raw), fingerprint: storageKeyFingerprint(parseStorageKey(raw)), source};
}

export function generateStorageKey() {
  return crypto.randomBytes(32).toString('base64url');
}

export function writeStorageKey(root, raw, {envFile = '.env'} = {}) {
  parseStorageKey(raw);
  const target = path.resolve(root, envFile);
  check(!target.includes('\0'), 'ENV_INVALID', 'Caminho .env inválido.');
  const {text, lines} = readEnvFile(target);
  const matches = lines.filter((line) => new RegExp(`^\\s*${KEY_NAME}\\s*=`).test(line));
  check(matches.length <= 1, 'ENV_INVALID', `${KEY_NAME} aparece mais de uma vez no .env.`);
  if (matches.length === 1 && parseValue(matches[0].split('=').slice(1).join('='))) {
    return {created: false, envFile: path.relative(root, target) || '.env', fingerprint: storageKeyFingerprint(parseStorageKey(raw))};
  }
  let output;
  if (matches.length === 1) {
    output = lines.map((line) => new RegExp(`^\\s*${KEY_NAME}\\s*=`).test(line) ? `${KEY_NAME}=${raw}` : line).join('\n');
  } else {
    output = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${KEY_NAME}=${raw}\n`;
  }
  atomicWrite(target, Buffer.from(output), 0o600);
  chmodBestEffort(target, 0o600);
  return {created: true, envFile: path.relative(root, target) || '.env', fingerprint: storageKeyFingerprint(parseStorageKey(raw))};
}

export {KEY_NAME};
