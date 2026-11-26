import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSiteConfig} from '../src/site-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [targetArgument, environment = 'production'] = process.argv.slice(2);
if (!targetArgument) {
  console.error('Uso: node tools/verify-site.mjs <diretório-publicado> [ambiente]');
  process.exit(2);
}

const site = loadSiteConfig(root, environment);
const target = path.resolve(root, targetArgument);
if (!fs.existsSync(target)) throw new Error(`Artefato ausente: ${targetArgument}.`);

function walk(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const files = walk(target);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const categoryFiles = files.filter((file) => file.includes(`${path.sep}categorias${path.sep}`));
const articleFiles = files.filter((file) => file.includes(`${path.sep}noticias${path.sep}`));
if (htmlFiles.length !== 19 || categoryFiles.length !== 5 || articleFiles.length !== 8) {
  throw new Error(`Contagem inesperada: ${htmlFiles.length} HTML, ${categoryFiles.length} editorias, ${articleFiles.length} matérias.`);
}
if ((fs.readFileSync(path.join(target, 'rss.xml'), 'utf8').match(/<item>/g) || []).length !== 8) {
  throw new Error('RSS não contém oito itens.');
}
if (site.adsense.enabled || [...htmlFiles, path.join(target, 'robots.txt')].some((file) => fs.readFileSync(file, 'utf8').includes('pagead2.googlesyndication.com'))) {
  throw new Error('Publicidade deveria permanecer desativada.');
}
if (site.environment === 'production') {
  const allText = files
    .filter((file) => /\.(?:html|xml|txt|css|svg)$/.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  if (allText.includes('jvt13.github.io')) throw new Error('URL de homologação encontrada no artefato de produção.');
}
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  if (!site.indexing && !html.includes('content="noindex,follow"')) throw new Error(`Indexação não bloqueada: ${path.relative(target, file)}.`);
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const link = match[1];
    if (/^(?:https?:|mailto:|data:)/.test(link)) continue;
    const local = link.split(/[?#]/)[0];
    if (local && !fs.existsSync(path.resolve(path.dirname(file), local))) {
      throw new Error(`Link local quebrado em ${path.relative(target, file)}: ${local}.`);
    }
  }
}
const forbidden = files.filter((file) => /(?:\.sqlcipher|\.sqlite|\.db|\.env|\.key|\.pem|report\.md)$/.test(file));
if (forbidden.length) throw new Error(`Arquivo privado no artefato público: ${forbidden.map((file) => path.relative(target, file)).join(', ')}`);

console.log(JSON.stringify({
  ok: true,
  environment: site.environment,
  siteUrl: site.siteUrl,
  indexing: site.indexing,
  htmlPages: htmlFiles.length,
  categories: categoryFiles.length,
  articles: articleFiles.length,
  adsense: site.adsense.enabled,
}));
