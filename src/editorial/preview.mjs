import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validate,resolveImage} from './validator.mjs';
import {publicArticle,verifyOutput} from './publisher.mjs';
import {confined,filesUnder,jsonBytes} from './repository.mjs';
import {ensure} from './schema.mjs';

export function createPrivatePreview(repository, id, {target, now = repository.now()} = {}) {
  ensure(target, 'TARGET_REQUIRED', 'Destino da prévia obrigatório.');
  const targetRoot = path.resolve(target);
  const reportsRoot = path.join(repository.root, 'reports') + path.sep;
  ensure(targetRoot.startsWith(reportsRoot), 'PREVIEW_SCOPE', 'Prévia privada deve permanecer em reports/.');
  return repository.withLock(() => {
    const record = repository.get(id);
    ensure(['validated', 'approved'].includes(record.state), 'PREVIEW_STATE', 'Prévia exige registro validado, sem necessidade de aprovação.');
    const validation = validate(repository, record.input);
    ensure(validation.valid, 'PREVIEW_VALIDATION', 'Registro não passou na validação editorial.', validation);
    const articles = repository.read('content/articles.json');
    const images = repository.read('content/images.json');
    const image = resolveImage(repository, record.input, articles, images);
    const projection = publicArticle(record.input, null, now);
    projection.article.correctionNote = 'Prévia privada para revisão humana; nenhuma aprovação editorial ou publicação foi realizada.';
    projection.article.productionNote = 'Prévia privada produzida em diretório isolado para decisão editorial humana.';
    projection.article.verification = {
      checkedAt: now.slice(0, 10),
      method: 'Prévia sem aprovação humana; automação não certifica factualidade nem autoriza publicação.',
    };
    const previewArticles = [...articles, projection.article];
    const previewImages = {...images, [record.input.article.image.key]: image.record};
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-preview-'));
    try {
      for (const relative of ['config.json', 'package.json', 'src/build.mjs', 'src/art.mjs', 'src/site-config.mjs', 'src/runtime/paths.mjs', ...filesUnder(repository.root, 'site').map((file) => file.relative), ...filesUnder(repository.root, 'brand').map((file) => file.relative), ...filesUnder(repository.root, 'public').map((file) => file.relative)]) {
        const destination = confined(stage, relative);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(repository.file(relative), destination);
      }
      fs.mkdirSync(path.join(stage, 'content'), {recursive: true});
      fs.writeFileSync(confined(stage, 'content/articles.json'), jsonBytes(previewArticles));
      fs.writeFileSync(confined(stage, 'content/images.json'), jsonBytes(previewImages));
      for (const asset of image.assets) {
        const destination = confined(stage, `public/${asset.path}`);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(asset.source, destination);
      }
      const build = spawnSync(process.execPath, [path.join(stage, 'src/build.mjs')], {
        cwd: stage,
        encoding: 'utf8',
        timeout: repository.config.limits.buildTimeoutMs,
        shell: false,
        maxBuffer: 1048576,
      });
      ensure(build.status === 0, 'PREVIEW_BUILD', 'Falha no build isolado da prévia.', {stderr: build.stderr?.slice(0, 2000)});
      const output = verifyOutput(stage, previewArticles.length);
      const site = path.join(targetRoot, 'site');
      fs.mkdirSync(site, {recursive: true});
      fs.cpSync(path.join(stage, 'public'), site, {recursive: true, force: true});
      return {
        id,
        target: path.relative(repository.root, targetRoot).split(path.sep).join('/'),
        articleHtml: `site/noticias/${projection.article.slug}.html`,
        slug: projection.article.slug,
        articles: output.articles,
        htmlPages: output.htmlPages,
        approved: record.state === 'approved',
        publicationPerformed: false,
        correctionNote: projection.article.correctionNote,
        synthetic: record.input.synthetic,
      };
    } finally {
      ensure(path.dirname(stage) === fs.realpathSync(os.tmpdir()) || path.dirname(stage) === path.resolve(os.tmpdir()), 'PREVIEW_SCOPE', 'Diretório temporário inesperado.');
      fs.rmSync(stage, {recursive: true, force: true});
    }
  });
}
