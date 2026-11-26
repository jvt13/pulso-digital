import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSite} from '../../src/build.mjs';
import {loadSiteConfig} from '../../src/site-config.mjs';
import {operationalPaths} from '../../src/storage/operational.mjs';
import {DATA_ROOT_ENV, runtimeDataPath} from '../../src/runtime/paths.mjs';
import {PYTHON_BIN_ENV, pythonExecutable} from '../../src/runtime/python.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let temp;
let homologation;
let production;
let result;

function walk(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

before(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-pd0071-'));
  homologation = path.join(temp, 'homologation');
  production = path.join(temp, 'production');
  buildSite({environment: 'homologation', output: homologation});
  result = buildSite({environment: 'production', output: production});
});

after(() => {
  assert.ok(temp.startsWith(path.join(os.tmpdir(), 'pulso-pd0071-')));
  fs.rmSync(temp, {recursive: true, force: true});
});

test('ambientes têm URL, base path e indexação independentes', () => {
  const local = loadSiteConfig(root, 'homologation');
  const live = loadSiteConfig(root, 'production');
  assert.equal(local.siteUrl, 'https://jvt13.github.io/pulso-digital');
  assert.equal(local.basePath, '/pulso-digital/');
  assert.equal(live.siteUrl, 'https://pulsobit.tech');
  assert.equal(live.basePath, '/');
  assert.equal(local.indexing, false);
  assert.equal(live.indexing, false);
  assert.equal(live.adsense.enabled, false);
});

test('builds preservam oito matérias, cinco editorias e dezenove páginas', () => {
  assert.deepEqual(
    {articles: result.articles, categories: result.categories, htmlPages: result.htmlPages},
    {articles: 8, categories: 5, htmlPages: 19},
  );
  assert.equal(walk(production).filter((file) => file.endsWith('.html')).length, 19);
  assert.equal((fs.readFileSync(path.join(production, 'rss.xml'), 'utf8').match(/<item>/g) || []).length, 8);
});

test('produção usa o domínio oficial sem vazar URLs do GitHub Pages', () => {
  const home = fs.readFileSync(path.join(production, 'index.html'), 'utf8');
  assert.match(home, /<link rel="canonical" href="https:\/\/pulsobit\.tech\/">/);
  assert.match(home, /<meta property="og:url" content="https:\/\/pulsobit\.tech\/">/);
  const textArtifacts = walk(production)
    .filter((file) => /\.(?:html|xml|txt|css|svg)$/.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  assert.ok(!textArtifacts.includes('jvt13.github.io'));
  assert.ok(!textArtifacts.includes('github.io/pulso-digital'));
});

test('marca, favicon, metadados e dados estruturados estão completos', () => {
  const home = fs.readFileSync(path.join(production, 'index.html'), 'utf8');
  assert.match(home, /<span class="brand-pulse">Pulso<\/span><span class="brand-bit">Bit<\/span>/);
  assert.match(home, /assets\/pulsobit-mark\.svg/);
  assert.match(home, /assets\/favicon\.svg/);
  assert.ok(home.includes('O PULSO DA TECNOLOGIA'));
  assert.ok(home.includes('name="twitter:card" content="summary_large_image"'));
  const graph = [...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .map((match) => JSON.parse(match[1]))
    .find((value) => value['@graph']);
  assert.deepEqual(graph['@graph'].map((item) => item['@type']), ['Organization', 'WebSite']);
  const article = fs.readFileSync(path.join(production, 'noticias/gta-vi-lancamento-vice-city.html'), 'utf8');
  const schemas = [...article.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .map((match) => JSON.parse(match[1]));
  assert.ok(schemas.some((value) => value['@type'] === 'NewsArticle'));
  assert.ok(schemas.some((value) => value['@type'] === 'BreadcrumbList'));
  for (const name of ['pulsobit-mark.svg', 'pulsobit-logo-dark.svg', 'pulsobit-logo-light.svg', 'favicon.svg']) {
    assert.match(fs.readFileSync(path.join(production, 'assets', name), 'utf8'), /^<svg/);
  }
});

test('pré-lançamento bloqueia indexação e mantém links locais válidos', () => {
  for (const environment of [homologation, production]) {
    for (const file of walk(environment).filter((item) => item.endsWith('.html'))) {
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(html.includes('content="noindex,follow"'), file);
      for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|data:)/.test(target)) continue;
        const local = target.split(/[?#]/)[0];
        if (local) assert.ok(fs.existsSync(path.resolve(path.dirname(file), local)), `${file}: ${local}`);
      }
    }
    assert.match(fs.readFileSync(path.join(environment, 'robots.txt'), 'utf8'), /Disallow: \//);
    assert.ok(!fs.readFileSync(path.join(environment, 'index.html'), 'utf8').includes('pagead2.googlesyndication.com'));
  }
});

test('PULSO_DATA_ROOT mantém banco e estado fora da release', () => {
  const previous = process.env[DATA_ROOT_ENV];
  const dataRoot = path.join(temp, 'runtime');
  process.env[DATA_ROOT_ENV] = dataRoot;
  try {
    assert.equal(runtimeDataPath(root, 'storage/data'), path.join(dataRoot, 'storage/data'));
    assert.equal(operationalPaths(root).database, path.join(dataRoot, 'storage/data/operational.sqlcipher'));
    assert.ok(!runtimeDataPath(root, 'radar/data/state.json').startsWith(root + path.sep));
  } finally {
    if (previous === undefined) delete process.env[DATA_ROOT_ENV];
    else process.env[DATA_ROOT_ENV] = previous;
  }
});

test('PULSO_PYTHON_BIN permite interpretador exclusivo do gerador de imagens', () => {
  const previous = process.env[PYTHON_BIN_ENV];
  process.env[PYTHON_BIN_ENV] = '/opt/pulso-digital/venv/bin/python';
  try {
    assert.equal(pythonExecutable(), '/opt/pulso-digital/venv/bin/python');
  } finally {
    if (previous === undefined) delete process.env[PYTHON_BIN_ENV];
    else process.env[PYTHON_BIN_ENV] = previous;
  }
});
