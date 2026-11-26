import fs from 'node:fs';
import path from 'node:path';

export const DATA_ROOT_ENV = 'PULSO_DATA_ROOT';

export function runtimeDataRoot(projectRoot) {
  const configured = String(process.env[DATA_ROOT_ENV] || '').trim();
  return configured ? path.resolve(projectRoot, configured) : path.resolve(projectRoot);
}

export function runtimeDataPath(projectRoot, relative) {
  const normalized = String(relative || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw Object.assign(new Error('Caminho de runtime inválido.'), {code: 'RUNTIME_PATH'});
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw Object.assign(new Error('Caminho de runtime fora do escopo.'), {code: 'RUNTIME_PATH'});
  }
  const root = runtimeDataRoot(projectRoot);
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Caminho de runtime fora do escopo.'), {code: 'RUNTIME_PATH'});
  }
  return target;
}

export function ensureRuntimeDataRoot(projectRoot) {
  const root = runtimeDataRoot(projectRoot);
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  return root;
}
