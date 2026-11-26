import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicWrite, check, hash, file, jsonBytes, readJson} from './common.mjs';
import {inspectImage} from './images.mjs';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function shortSubject(topic) {
  const text = String(topic || 'tecnologia').replace(/\s+/g, ' ').trim();
  return text.length <= 90 ? text : `${text.slice(0, 87).trim()}...`;
}

export function prepareAutomaticIllustration(root, topicId, record, {now = new Date().toISOString()} = {}) {
  const base = `newsroom/data/images/${topicId}`;
  const manifestPath = file(root, `${base}/manifest.json`);
  if (fs.existsSync(manifestPath)) return inspectImage(root, topicId);
  const folder = file(root, base);
  fs.mkdirSync(folder, {recursive: true});
  const original = path.join(folder, 'original.png');
  check(!fs.existsSync(original), 'IMAGE_CONFLICT', 'Original de imagem já existe sem manifesto; não será sobrescrito.');
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../newsroom/tools/generate_illustration.py');
  const seed = Number.parseInt(hash(record.topic || topicId).slice(0, 8), 16);
  const generated = spawnSync('python', [script, original, record.category || 'tendencias', String(seed)], {
    shell: false,
    timeout: 30000,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4096,
  });
  check(!generated.error && generated.status === 0 && fs.existsSync(original), 'IMAGE_GENERATION', 'Não foi possível gerar a ilustração editorial local.');
  const subject = shortSubject(record.topic);
  const checkedAt = now.slice(0, 10);
  const manifest = {
    schemaVersion: '1.0',
    kind: 'illustration',
    rightsType: 'self-created',
    thirdPartyElements: [],
    credit: 'Pulso Digital',
    sourceUrl: 'https://jvt13.github.io/pulso-digital/editorial.html',
    license: 'Ilustração editorial própria do Pulso Digital; sem elementos de terceiros.',
    licenseUrl: 'https://jvt13.github.io/pulso-digital/editorial.html',
    authorizationBasis: 'Ilustração abstrata gerada por software local do Pulso Digital. Não contém logotipo, captura de tela, fotografia ou obra de terceiros.',
    checkedAt,
    alt: `Ilustração editorial sobre ${subject}`,
    caption: `Ilustração editorial do Pulso Digital sobre ${subject}; não representa o produto ou acontecimento.`,
    previewAllowed: true,
    processing: 'Ilustração própria gerada localmente em 1600×900; WebP principal 1600×900, WebP reduzido 640×360 e JPEG de compartilhamento 1600×900.',
    generatedBy: 'pulso-newsroom-illustration-v1',
  };
  atomicWrite(manifestPath, jsonBytes(manifest));
  let prepared = inspectImage(root, topicId);
  check(prepared.ready, 'IMAGE_PREPARATION', prepared.reason || 'Ilustração gerada não passou na preparação.');
  const originalBytes = fs.readFileSync(original);
  const completeManifest = {
    ...readJson(manifestPath),
    original: {file: 'original.png', width: 1600, height: 900, bytes: originalBytes.length, sha256: sha256(originalBytes)},
    variants: prepared.assets.map((asset) => ({
      file: path.basename(asset.relative),
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
      sha256: sha256(fs.readFileSync(file(root, asset.relative))),
    })),
  };
  atomicWrite(manifestPath, jsonBytes(completeManifest));
  prepared = inspectImage(root, topicId);
  return {...prepared, automatic: true};
}

export function ensurePreparedImage(root, topicId, record, options = {}) {
  const current = inspectImage(root, topicId);
  if (current.ready) return {...current, automatic: false};
  const manifest = file(root, `newsroom/data/images/${topicId}/manifest.json`);
  if (fs.existsSync(manifest)) return current;
  return prepareAutomaticIllustration(root, topicId, record, options);
}
