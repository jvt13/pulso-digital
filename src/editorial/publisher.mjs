import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ensure, hash, EditorialError } from './schema.mjs';
import { validate, resolveImage } from './validator.mjs';
import { transition } from './lifecycle.mjs';
import { filesUnder, confined, jsonBytes } from './repository.mjs';

export function publicArticle(input, target, now) {
  const a = input.article;
  const common = {
    title: a.title, slug: a.slug, summary: a.summary, category: a.category,
    tags: a.tags, sections: a.sections, image: a.image.key,
    editorial: a.editorial,
    sources: a.sources.map(({ name, url, checkedAt, kind, publishedDate }) => ({ name, url, checkedAt, ...(kind ? { kind } : {}), ...(publishedDate ? { publishedDate } : {}) })),
    verification: { checkedAt: now.slice(0,10), method: 'Revisão editorial explícita de fatos e direitos de imagem; validação estrutural automatizada não substitui essa revisão.' },
    productionNote: 'Conteúdo encaminhado por revisão editorial institucional, com fontes documentadas.',
    ...(a.eventDate ? { eventDate: a.eventDate, eventLabel: a.eventLabel } : {})
  };
  const existingMaterial = target && Object.fromEntries(Object.keys(common).map(key => [key, target[key]]));
  if (target && hash({ ...common, verification: null }) === hash({ ...existingMaterial, verification: null })) return { article: target, changed: false };
  const result = { ...(target || {}), ...common, date: target?.date || now.slice(0,10), ...(target ? {} : { publishedAt: now }), updatedAt: now, correctionNote: a.changeNote || 'Publicação inicial após validação e aprovação editorial explícita.' };
  if (!a.eventDate) { delete result.eventDate; delete result.eventLabel; }
  return { article: result, changed: true };
}

export function verifyOutput(stage, expectedArticles) {
  const articles = JSON.parse(fs.readFileSync(confined(stage,'content/articles.json'),'utf8'));
  ensure(articles.length === expectedArticles && new Set(articles.map(a=>a.slug)).size === articles.length, 'OUTPUT_INTEGRITY', 'Quantidade ou slugs divergentes na saída preparada.');
  for (const a of articles) ensure(fs.existsSync(confined(stage,`public/noticias/${a.slug}.html`)), 'OUTPUT_INTEGRITY', 'Página de matéria ausente.');
  let htmlPages = 0;
  for (const { file, relative } of filesUnder(stage, 'public').filter(f=>f.relative.endsWith('.html'))) {
    htmlPages++;
    const html = fs.readFileSync(file,'utf8');
    ensure((html.match(/<h1(?:\s|>)/g)||[]).length === 1, 'OUTPUT_INTEGRITY', 'Hierarquia principal inválida.');
    ensure(!html.includes('editorial/data/') && !html.includes('"claims":') && !html.includes('"approval":'), 'PRIVATE_OUTPUT', 'Metadados internos encontrados na saída.');
    for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      const link = match[1].split(/[?#]/)[0];
      if (!link || /^(https?:|mailto:)/.test(link)) continue;
      const resolved = path.resolve(path.dirname(file), link);
      ensure(resolved.startsWith(path.join(stage,'public')+path.sep) && fs.existsSync(resolved), 'OUTPUT_LINK', 'Recurso local não encontrado na saída.', { page: relative, link });
    }
    for (const match of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) JSON.parse(match[1]);
  }
  ensure(htmlPages === articles.length + 11, 'OUTPUT_INTEGRITY', 'Páginas inesperadas: rascunhos não devem integrar public/.');
  return { htmlPages, articles: articles.length };
}

function prepare(repo, id) {
  const record = repo.get(id);
  ensure(record.state === 'approved' && record.approval, 'NOT_APPROVED', 'Publicação exige aprovação editorial explícita.');
  const result = validate(repo, record.input);
  ensure(result.valid, 'VALIDATION_FAILED', 'Validações obrigatórias falharam.', result);
  ensure(result.contentHash === record.approval.contentHash, 'APPROVAL_CHANGED', 'Conteúdo, alvo ou imagem mudou depois da aprovação. Revalide e aprove novamente.');
  ensure(result.warnings.every(w=>record.approval.acknowledgedWarnings.includes(w.code)), 'NEW_WARNINGS', 'Existem avisos ainda não revisados.', result.warnings);
  ensure(!record.input.synthetic || repo.config.allowSyntheticPublication === true, 'SYNTHETIC_PUBLICATION', 'Fixtures sintéticas só podem ser publicadas em cópia temporária explicitamente configurada.');
  const articles = repo.read('content/articles.json'), images = repo.read('content/images.json');
  const target = articles.find(a=>a.slug===record.input.targetSlug);
  const image = resolveImage(repo,record.input,articles,images), now = repo.now();
  const projection = publicArticle(record.input,target,now);
  if (target) articles[articles.indexOf(target)] = projection.article; else articles.push(projection.article);
  if (!Object.hasOwn(images,record.input.article.image.key)) images[record.input.article.image.key] = image.record;
  return { record, result, articles, images, image, projection, now };
}

function stagePublication(repo, plan, stage) {
  for (const relative of ['config.json','package.json', 'src/build.mjs','src/art.mjs', ...filesUnder(repo.root,'public').map(f=>f.relative)]) {
    const source = repo.file(relative), dest = confined(stage,relative);
    fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.copyFileSync(source,dest);
  }
  fs.mkdirSync(path.join(stage,'content'),{recursive:true});
  fs.writeFileSync(confined(stage,'content/articles.json'),jsonBytes(plan.articles));
  fs.writeFileSync(confined(stage,'content/images.json'),jsonBytes(plan.images));
  for (const asset of plan.image.assets) {
    const dest = confined(stage,'public/'+asset.path);
    const bytes=fs.readFileSync(asset.source);
    ensure(hash(bytes)===asset.hash,'APPROVAL_CHANGED','Imagem alterada durante a preparação; publicação cancelada.');
    fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,bytes);
  }
  const total = filesUnder(stage).reduce((n,f)=>n+fs.statSync(f.file).size,0);
  ensure(total <= repo.config.limits.stagedBytes,'STAGE_LIMIT','Área preparada acima do limite.');
  repo.fault('before-build', { stage });
  const build = spawnSync(process.execPath,[path.join(stage,'src/build.mjs')], { cwd:stage, timeout:repo.config.limits.buildTimeoutMs, maxBuffer:1048576, encoding:'utf8', shell:false });
  ensure(build.status === 0 && !build.error,'BUILD_FAILED','Falha na geração isolada; conteúdo real preservado.',{ status:build.status, error:build.error?.code, stderr:build.stderr?.slice(0,2000) });
  for(const asset of plan.image.assets)ensure(hash(fs.readFileSync(confined(stage,'public/'+asset.path)))===asset.hash,'APPROVAL_CHANGED','Asset preparado diverge dos bytes aprovados.');
  return verifyOutput(stage,plan.articles.length);
}

export function publish(repo, id, { dryRun = false } = {}) {
  const execute = () => {
    ensure(!fs.existsSync(repo.journal), 'RECOVERY_REQUIRED','Execute recover antes de publicar ou simular.');
    const initial = repo.get(id);
    if (initial.state === 'published') return { id, dryRun, idempotent:true, changed:false, receipt:initial.receipt, files:[] };
    const fingerprint = repo.fingerprint(), plan = prepare(repo,id);
    const stage = fs.mkdtempSync(path.join(os.tmpdir(),'pulso-editorial-'));
    try {
      const output = stagePublication(repo,plan,stage);
      ensure(repo.fingerprint() === fingerprint,'CONCURRENT_CHANGE','Dados mudaram durante a preparação; nenhuma alteração aplicada.');
      const changes = [...filesUnder(stage,'public'), ...['content/articles.json','content/images.json'].map(relative=>({relative,file:confined(stage,relative)}))]
        .map(({relative,file})=>({relative,bytes:fs.readFileSync(file)}))
        .filter(({relative,bytes})=>!fs.existsSync(repo.file(relative)) || hash(fs.readFileSync(repo.file(relative)))!==hash(bytes));
      const receipt = { at:plan.now, slug:plan.projection.article.slug, operation:plan.record.input.operation, publishedAt:plan.projection.article.publishedAt || plan.projection.article.date, approvedHash:plan.result.contentHash, publicArticleHash:hash(plan.projection.article), changed:plan.projection.changed };
      const finalRecord = transition(plan.record,'published',{action:'publish',at:plan.now,reason:plan.projection.changed?'Publicação validada em área isolada.':'Atualização sem alteração efetiva; datas públicas preservadas.',patch:{receipt}});
      const stateRelative=`editorial/data/records/${id}.json`;
      ensure(jsonBytes(finalRecord).length<=repo.config.limits.stateBytes,'STATE_LIMIT','Histórico acima do limite.');
      const response = { id, dryRun, idempotent:false, changed:plan.projection.changed, validations:plan.result, conflicts:[], files:[...changes.map(c=>c.relative),stateRelative], expected:{state:'published',...output}, receipt };
      if (dryRun) return response;
      changes.push({relative:stateRelative,bytes:jsonBytes(finalRecord)});
      response.transaction = repo.transaction(changes);
      return response;
    } finally {
      ensure(path.dirname(stage)===fs.realpathSync(os.tmpdir()) || path.dirname(stage)===path.resolve(os.tmpdir()),'STAGE_PATH','Diretório temporário inesperado.');
      fs.rmSync(stage,{recursive:true,force:true});
    }
  };
  return dryRun ? execute() : repo.withLock(execute);
}
