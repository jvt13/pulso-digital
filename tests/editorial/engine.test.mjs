import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { Repository, filesUnder, atomicWrite, jsonBytes } from '../../src/editorial/repository.mjs';
import { EditorialEngine } from '../../src/editorial/engine.mjs';
import { validate, safeUrl } from '../../src/editorial/validator.mjs';
import { createPrivatePreview } from '../../src/editorial/preview.mjs';
import { hash, checkSchema } from '../../src/editorial/schema.mjs';
import { titleSimilarity, normalizeUrl } from '../../src/editorial/deduplication.mjs';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fixture=JSON.parse(fs.readFileSync(path.join(sourceRoot,'editorial/fixtures/valid-create.json'),'utf8'));
const now=()=>new Date().toISOString();
function sandbox(t,{fault,allowSynthetic=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pd003-test-'));
  for(const relative of ['src','public','content','editorial','package.json','config.json'])fs.cpSync(path.join(sourceRoot,relative),path.join(root,relative),{recursive:true,filter:p=>!p.startsWith(path.join(sourceRoot,'editorial','data'))});
  const configFile=path.join(root,'editorial/config.json');const config=JSON.parse(fs.readFileSync(configFile));config.allowSyntheticPublication=allowSynthetic;fs.writeFileSync(configFile,JSON.stringify(config));
  t.after(()=>{assert.ok(root.startsWith(path.join(os.tmpdir(),'pd003-test-')));fs.rmSync(root,{recursive:true,force:true});});
  const repo=new Repository(root,{fault,now});return {root,repo,engine:new EditorialEngine(repo)};
}
function input(repo,value=structuredClone(fixture),file='candidate.json'){
  const relative='editorial/data/incoming/'+file;atomicWrite(repo.file(relative),jsonBytes(value));return relative;
}
function approve(env,value=structuredClone(fixture)){
  const file=input(env.repo,value);env.engine.import(file);
  const result=env.engine.validate(value.id);assert.equal(result.result.valid,true,JSON.stringify(result.result.errors));
  env.engine.approve(value.id,{reviewer:'operador-teste-sintetico',factsReviewed:true,imageRightsReviewed:true,acknowledgeWarnings:true});return value.id;
}
const snapshot=repo=>Object.fromEntries(filesUnder(repo.root).filter(f=>!f.relative.startsWith('editorial/data/transactions/')).map(f=>[f.relative,hash(fs.readFileSync(f.file))]));
const publicSnapshot=repo=>Object.fromEntries([...filesUnder(repo.root,'public'),...filesUnder(repo.root,'content')].map(f=>[f.relative,hash(fs.readFileSync(f.file))]));
const expectCode=(fn,code)=>assert.throws(fn,e=>e.code===code,code);

test('importação válida gera pending → draft, sem publicar ou aceitar metadados internos',t=>{
  const env=sandbox(t),before=publicSnapshot(env.repo),record=env.engine.import(input(env.repo));
  assert.equal(record.state,'draft');assert.deepEqual(record.history.map(h=>h.to),['pending','draft']);assert.ok(record.createdAt);assert.deepEqual(publicSnapshot(env.repo),before);
  const injected={...structuredClone(fixture),id:'fixture-interna',state:'approved',approval:{reviewer:'inventado'}};
  expectCode(()=>env.engine.import(input(env.repo,injected)),'INPUT_SCHEMA');
});
test('JSON inválido, arquivo excessivo e importação fora dos diretórios permitidos',t=>{
  const env=sandbox(t);
  expectCode(()=>env.engine.import('editorial/fixtures/invalid-syntax.json'),'INVALID_JSON');
  atomicWrite(env.repo.file('editorial/data/incoming/large.json'),Buffer.alloc(env.repo.config.limits.inputBytes+1,32));
  expectCode(()=>env.engine.import('editorial/data/incoming/large.json'),'INPUT_SIZE');
  expectCode(()=>env.engine.import('../../config.json'),'INPUT_DIRECTORY');
  expectCode(()=>env.repo.file('public/../config.json'),'UNSAFE_PATH');
  const polluted=JSON.parse(JSON.stringify(fixture).replace('"schemaVersion"','"__proto__":{},"schemaVersion"'));
  assert.ok(checkSchema(polluted).some(e=>e.code==='UNKNOWN_FIELD'));
});
for(const [name,edit,code] of [
  ['campos obrigatórios',v=>delete v.article.summary,'REQUIRED'],
  ['categoria inválida',v=>v.article.category='nova-editoria','ENUM'],
  ['data inexistente',v=>v.article.sources[0].checkedAt='2026-02-30','SOURCE_DATE'],
  ['data de consulta futura',v=>v.article.sources[0].checkedAt='2999-01-01','SOURCE_DATE'],
  ['evento futuro sem qualificação',v=>{v.article.eventDate='2999-01-01';v.article.eventLabel='Fato confirmado';},'EVENT_DATE'],
  ['slug traversal',v=>v.article.slug='../../escape','UNSAFE_SLUG'],
  ['nome reservado Windows',v=>v.article.slug='con','UNSAFE_SLUG'],
  ['HTML/JavaScript no título',v=>v.article.title='<script>alert(1)</script>','INJECTION'],
  ['HTML no corpo',v=>v.article.sections[0].paragraphs[0]='<img src=x onerror=alert(1)>','INJECTION'],
  ['HTML codificado em metadados',v=>v.article.image.caption='&#60;script&#62;','INJECTION'],
  ['protocolo perigoso',v=>v.article.sources[0].url='javascript:alert(1)','INJECTION'],
  ['URL com credenciais',v=>v.article.sources[0].url='https://usuario:senha@example.invalid/','SOURCE_URL'],
  ['ausência de fontes',v=>v.article.sources=[],'REQUIRED'],
  ['evidência ausente',v=>v.article.claims[0].evidence='','EMPTY'],
  ['parágrafo não rastreado',v=>v.article.claims.pop(),'EVIDENCE_COVERAGE'],
  ['rumor sem identificação',v=>v.article.claims[0].classification='rumor','CLAIM_QUALIFIER'],
  ['expectativa sem identificação',v=>v.article.claims[0].classification='expectation','CLAIM_QUALIFIER'],
  ['autoria inventada',v=>v.article.editorial.name='Jornalista Fictício','EDITORIAL_IDENTITY'],
  ['placeholder',v=>v.article.summary='TODO completar notícia','PLACEHOLDER'],
  ['autorização ausente',v=>v.article.image.authorization.basis='','EMPTY'],
  ['imagem ausente',v=>v.article.image.key='imagem-nao-registrada','IMAGE_RECORD'],
  ['reutilização sem justificativa',v=>delete v.article.image.reuseJustification,'IMAGE_REUSE'],
  ['caminho de asset fora da raiz',v=>v.article.image.assets=[{from:'../../pessoal.jpg',to:'assets/editorial/fixture-motor-editorial/photo.jpg'}],'IMAGE_PATH']
])test('validador bloqueia '+name,t=>{const env=sandbox(t),value=structuredClone(fixture);edit(value);const result=validate(env.repo,value);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.code===code),JSON.stringify(result.errors));});

test('limites configuráveis e validação sem rede',t=>{
  const env=sandbox(t);env.repo.config.limits.title=10;
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=()=>{requests++;throw new Error('Requisição externa proibida no teste.');};
  try {assert.ok(validate(env.repo,fixture).errors.some(e=>e.code==='LIMIT'));assert.equal(requests,0);}finally{globalThis.fetch=originalFetch;}
  assert.equal(safeUrl('https:example.org'),false);assert.equal(safeUrl('https://example.invalid/'),true);
  // example.invalid nunca precisa resolver: não há fetch/http no validador.
});
test('deduplicação exata, ID e colisão de slug; acentos, pontuação e caixa normalizados',t=>{
  const env=sandbox(t);env.engine.import(input(env.repo));
  expectCode(()=>env.engine.import(input(env.repo)),'DUPLICATE_ID');
  const other=structuredClone(fixture);other.id='outra-fixture';other.article.slug='outra-fixture';other.article.sections[0].paragraphs[0]=other.article.sections[0].paragraphs[0].toUpperCase();other.article.claims[0].text=other.article.sections[0].paragraphs[0];
  assert.ok(validate(env.repo,other).errors.some(e=>e.code==='EXACT_DUPLICATE'));
  other.article.sections[0].paragraphs[0]='Texto completamente distinto, apenas sintético, para comparação controlada.';other.article.claims[0].text=other.article.sections[0].paragraphs[0];
  other.article.sections[1].paragraphs[0]='Outro parágrafo sintético que não reproduz o corpo anterior.';other.article.claims[1].text=other.article.sections[1].paragraphs[0];
  other.article.slug=fixture.article.slug;assert.ok(validate(env.repo,other).errors.some(e=>e.code==='SLUG_COLLISION'));
});
test('título semelhante e mesma fonte geram avisos, sem rejeição automática de matérias diferentes',t=>{
  const env=sandbox(t);env.engine.import(input(env.repo));
  const other=structuredClone(fixture);other.id='outra-pauta';other.article.slug='outra-pauta';
  other.article.sections.forEach((s,i)=>{s.paragraphs[0]='Parágrafo diferente número '+i+' sobre um teste sintético independente.';other.article.claims[i].text=s.paragraphs[0];});
  const result=validate(env.repo,other);assert.equal(result.valid,true);assert.ok(result.warnings.some(w=>w.code==='SIMILAR_TITLE'));assert.ok(result.warnings.some(w=>w.code==='SHARED_SOURCE'));
  assert.equal(titleSimilarity('AÇÃO: TESTE!','acao teste'),1);
  assert.equal(normalizeUrl('https://EXAMPLE.invalid:443/nota/?b=2&utm_source=x#a'),normalizeUrl('https://example.invalid/nota?b=2'));
});
test('transições inválidas, rejeição fundamentada, retorno e revisão controlada',t=>{
  const env=sandbox(t),id=env.engine.import(input(env.repo)).input.id;
  expectCode(()=>env.engine.approve(id,{reviewer:'teste'}),'NOT_VALIDATED');
  expectCode(()=>env.engine.publish(id),'NOT_APPROVED');
  expectCode(()=>env.engine.reject(id,''),'REASON_REQUIRED');
  env.engine.reject(id,'Revisão sintética necessária.');env.engine.draft(id,'Retorno explícito para revisão.');
  env.engine.validate(id);
  expectCode(()=>env.engine.validate(id),'INVALID_TRANSITION');
  expectCode(()=>env.engine.approve(id,{reviewer:'teste'}),'EXPLICIT_REVIEW_REQUIRED');
  expectCode(()=>env.engine.approve(id,{reviewer:'teste',factsReviewed:true,imageRightsReviewed:true}),'WARNINGS_REVIEW_REQUIRED');
  env.engine.approve(id,{reviewer:'operador-sintetico',factsReviewed:true,imageRightsReviewed:true,acknowledgeWarnings:true});
  const revised=structuredClone(fixture);revised.article.summary='Resumo sintético revisado explicitamente.';
  env.engine.revise(id,input(env.repo,revised),'Revisão explícita do resumo.');assert.equal(env.repo.get(id).state,'draft');assert.equal(env.repo.get(id).approval,null);
  expectCode(()=>env.engine.publish(id),'NOT_APPROVED');
});
test('histórico adulterado e edição silenciosa após aprovação são detectados',t=>{
  const env=sandbox(t),id=approve(env);const file=env.repo.recordPath(id),original=fs.readFileSync(file);
  const record=JSON.parse(original);record.input.article.title='Alteração indevida';fs.writeFileSync(file,JSON.stringify(record));expectCode(()=>env.engine.publish(id),'HISTORY_INTEGRITY');
  fs.writeFileSync(file,original);const second=JSON.parse(original);second.history[0].reason='Motivo adulterado';fs.writeFileSync(file,JSON.stringify(second));expectCode(()=>env.repo.get(id),'HISTORY_INTEGRITY');
});
test('hash aprovado inclui arquivos da imagem e alvo de atualização',t=>{
  const env=sandbox(t),id=approve(env);const image=env.repo.read('content/images.json').network;
  const file=env.repo.file('public/'+image.src);const bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);
  expectCode(()=>env.engine.publish(id),'APPROVAL_CHANGED');
});
test('dry-run executa build isolado sem efeitos persistentes e fixtures são bloqueadas no projeto normal',t=>{
  const env=sandbox(t),id=approve(env),before=snapshot(env.repo);const plan=env.engine.publish(id,{dryRun:true});
  assert.equal(plan.expected.articles,9);assert.equal(plan.expected.htmlPages,20);assert.ok(plan.files.includes('content/articles.json'));assert.deepEqual(snapshot(env.repo),before);assert.equal(env.repo.get(id).state,'approved');
  env.repo.config.allowSyntheticPublication=false;expectCode(()=>env.engine.publish(id),'SYNTHETIC_PUBLICATION');
});

test('prévia privada usa layout real sem aprovar, publicar ou alterar public',t=>{
  const env=sandbox(t),id=env.engine.import(input(env.repo)).input.id;
  env.engine.validate(id);
  const before=publicSnapshot(env.repo),target=path.join(env.root,'reports','evidence','latest','preview');
  const result=createPrivatePreview(env.repo,id,{target,now:now()});
  assert.equal(result.approved,false);
  assert.equal(result.publicationPerformed,false);
  assert.equal(result.articles,9);
  assert.equal(result.htmlPages,20);
  assert(fs.existsSync(path.join(target,result.articleHtml)));
  assert.match(fs.readFileSync(path.join(target,result.articleHtml),'utf8'),/Prévia privada para revisão humana/);
  assert.doesNotMatch(fs.readFileSync(path.join(target,result.articleHtml),'utf8'),/aprovação editorial explícita/);
  assert.deepEqual(publicSnapshot(env.repo),before);
  assert.equal(env.repo.get(id).state,'validated');
});
test('ciclo completo, publicação válida, isolamento privado e repetição idempotente',t=>{
  const env=sandbox(t),id=approve(env);const result=env.engine.publish(id);assert.equal(result.expected.articles,9);
  assert.deepEqual(env.repo.get(id).history.map(h=>h.to),['pending','draft','validated','approved','published']);
  const article=env.repo.read('content/articles.json').find(a=>a.slug===fixture.article.slug);assert.ok(article.publishedAt);assert.ok(!Object.hasOwn(article,'claims'));assert.ok(!Object.hasOwn(article,'approval'));
  assert.equal(filesUnder(env.root,'public').some(f=>f.relative.includes('editorial/data')),false);
  const inherited=spawnSync(process.execPath,['--test',env.repo.file('src/test.mjs')],{cwd:env.root,encoding:'utf8',timeout:30000});
  assert.equal(inherited.status,0,inherited.stdout+'\n'+inherited.stderr);
  const before=snapshot(env.repo);assert.equal(env.engine.publish(id).idempotent,true);assert.deepEqual(snapshot(env.repo),before);
  expectCode(()=>env.engine.draft(id,'Não reabrir matéria publicada.'),'INVALID_TRANSITION');
});
test('atualização legítima preserva slug e publicação; alteração efetiva e atualização sem mudanças',t=>{
  const env=sandbox(t),id=approve(env);env.engine.publish(id);
  const old=env.repo.read('content/articles.json').find(a=>a.slug===fixture.article.slug);
  const update=structuredClone(fixture);update.id='fixture-atualizacao';update.operation='update';update.targetSlug=old.slug;update.article.summary='Resumo sintético efetivamente atualizado.';update.article.changeNote='Correção sintética do resumo.';
  approve(env,update);env.engine.publish(update.id);
  const revised=env.repo.read('content/articles.json').find(a=>a.slug===old.slug);assert.equal(revised.date,old.date);assert.equal(revised.publishedAt,old.publishedAt);assert.equal(revised.slug,old.slug);assert.equal(revised.correctionNote,update.article.changeNote);
  const noChange=structuredClone(update);noChange.id='fixture-sem-mudancas';approve(env,noChange);const stamp=revised.updatedAt;assert.equal(env.engine.publish(noChange.id).changed,false);assert.equal(env.repo.read('content/articles.json').find(a=>a.slug===old.slug).updatedAt,stamp);
});
test('falha de geração preserva todos os dados e estado aprovado',t=>{
  const env=sandbox(t,{fault:(point,{stage}={})=>{if(point==='before-build')fs.writeFileSync(path.join(stage,'src/build.mjs'),"throw new Error('falha sintética');");}}),id=approve(env),before=publicSnapshot(env.repo);
  expectCode(()=>env.engine.publish(id),'BUILD_FAILED');assert.deepEqual(publicSnapshot(env.repo),before);assert.equal(env.repo.get(id).state,'approved');
});
test('falha de escrita após aplicação parcial faz rollback e mantém os dados anteriores',t=>{
  let armed=true;const env=sandbox(t,{fault:(point,{index}={})=>{if(armed&&point==='after-write'&&index===1){armed=false;throw new Error('falha de escrita sintética');}}}),id=approve(env),before=publicSnapshot(env.repo);
  assert.throws(()=>env.engine.publish(id),/falha de escrita/);assert.deepEqual(publicSnapshot(env.repo),before);assert.equal(env.repo.get(id).state,'approved');assert.equal(fs.existsSync(env.repo.journal),false);
  assert.equal(env.engine.publish(id).expected.articles,9);
});
test('interrupção deixa diário e recuperação explícita restaura estado consistente',t=>{
  let armed=true;const env=sandbox(t,{fault:(point,{index}={})=>{if(armed&&point==='after-write'&&index===2){armed=false;const e=new Error('interrupção simulada');e.simulatedInterruption=true;throw e;}}}),id=approve(env),before=publicSnapshot(env.repo);
  assert.throws(()=>env.engine.publish(id),/interrupção/);assert.ok(fs.existsSync(env.repo.journal));expectCode(()=>env.engine.validate(id),'RECOVERY_REQUIRED');
  const fresh=new EditorialEngine(new Repository(env.root));assert.equal(fresh.recover().action,'rolled-back');assert.deepEqual(publicSnapshot(env.repo),before);assert.equal(fresh.repo.get(id).state,'approved');
  assert.equal(fresh.publish(id).expected.articles,9);
});
test('recuperação após commit confirma publicação sem duplicar; conflito externo não é sobrescrito',t=>{
  const env=sandbox(t,{fault:point=>{if(point==='committed'){const e=new Error('interrupção depois do commit');e.simulatedInterruption=true;throw e;}}}),id=approve(env);
  assert.throws(()=>env.engine.publish(id),/interrupção/);
  const fresh=new EditorialEngine(new Repository(env.root));assert.equal(fresh.recover().action,'confirmed');assert.equal(fresh.publish(id).idempotent,true);
  // Segunda raiz: edição externa durante uma recuperação precisa ser preservada.
  const other=sandbox(t,{fault:(point,{index}={})=>{if(point==='after-write'&&index===0){const e=new Error('interrupção');e.simulatedInterruption=true;throw e;}}}),otherId=approve(other);
  assert.throws(()=>other.engine.publish(otherId));const journal=other.repo.read('editorial/data/transaction.json'),target=other.repo.file(journal.entries[0].relative);fs.writeFileSync(target,'edição externa a preservar');
  expectCode(()=>other.engine.recover(),'RECOVERY_CONFLICT');assert.equal(fs.readFileSync(target,'utf8'),'edição externa a preservar');
});
test('operações concorrentes entre processos são bloqueadas sem escrita perdida',async t=>{
  const env=sandbox(t);const repositoryUrl=new URL('../../src/editorial/repository.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {Repository} from ${JSON.stringify(repositoryUrl)}; const r=new Repository(${JSON.stringify(env.root)});r.withLock(()=>{console.log('LOCKED');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200);});`],{stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
  expectCode(()=>env.engine.import('editorial/fixtures/valid-create.json'),'LOCK_BUSY');
  await new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(new Error('processo concorrente falhou')));});
  assert.equal(env.engine.import('editorial/fixtures/valid-create.json').state,'draft');
});
test('lock ativo não é removido; lock órfão pode ser recuperado explicitamente',t=>{
  const env=sandbox(t);env.repo.withLock(()=>expectCode(()=>env.repo.breakOrphanLock('Teste de processo ativo.'),'LOCK_BUSY'));
  fs.mkdirSync(env.repo.lock);atomicWrite(env.repo.file('editorial/data/lock/owner.json'),jsonBytes({pid:2147483647,host:os.hostname(),token:'teste',at:now()}));
  assert.equal(env.engine.recover({breakLock:true,reason:'Recuperação de fixture órfã.'}).recovered,false);assert.equal(fs.existsSync(env.repo.lock),false);
});
test('CLI portátil em Windows/Linux: ajuda, JSON, códigos de saída e ciclo isolado',t=>{
  const env=sandbox(t),cli=path.join(sourceRoot,'src/editorial/cli.mjs');
  const run=(...args)=>spawnSync(process.execPath,[cli,...args,'--root',env.root,'--json'],{encoding:'utf8',timeout:30000});
  assert.equal(run('help').status,0);assert.equal(run('status').status,0);assert.equal(fs.existsSync(env.repo.data),false);
  assert.equal(run('import','editorial/fixtures/invalid-syntax.json').status,2);
  assert.equal(run('import','editorial/fixtures/valid-create.json').status,0);
  assert.equal(run('publish',fixture.id).status,3);
  assert.equal(run('validate',fixture.id).status,0);
  assert.equal(run('approve',fixture.id,'--dry-run').status,2);assert.equal(env.repo.get(fixture.id).state,'validated');
  assert.equal(run('approve',fixture.id,'--reviewer','operador-cli-sintetico','--facts-reviewed','--image-rights-reviewed','--acknowledge-warnings').status,0);
  const plan=run('publish',fixture.id,'--dry-run');assert.equal(plan.status,0,plan.stderr);assert.equal(JSON.parse(plan.stdout).result.expected.articles,9);
  const published=run('publish',fixture.id);assert.equal(published.status,0,published.stderr);
  assert.equal(run('history',fixture.id).status,0);assert.equal(run('list').status,0);assert.equal(run('show',fixture.id).status,0);
  assert.equal(run('nao-existe').status,2);
});

test('imagem nova e assets locais entram na mesma transação, sem vazar caminhos privados',t=>{
  const env=sandbox(t),value=structuredClone(fixture),image=structuredClone(env.repo.read('content/images.json').network);
  value.id='fixture-imagem-nova';value.article.image.key='fixture-imagem-nova';value.article.image.record=image;value.article.image.assets=[];
  for(const [index,file] of Object.values(image.files).entries()){
    const suffix=file.path.endsWith('.jpg')?'.jpg':'.webp',from=`editorial/data/incoming/image-${index}${suffix}`,to=`assets/editorial/${value.id}/image-${index}${suffix}`;
    atomicWrite(env.repo.file(from),fs.readFileSync(env.repo.file('public/'+file.path)));
    for(const field of ['src','smallSrc','shareSrc'])if(image[field]===file.path)image[field]=to;
    file.path=to;value.article.image.assets.push({from,to});
  }
  const id=approve(env,value),before=publicSnapshot(env.repo),plan=env.engine.publish(id,{dryRun:true});
  assert.ok(plan.files.includes('content/images.json'));assert.deepEqual(publicSnapshot(env.repo),before);
  env.engine.publish(id);assert.ok(env.repo.read('content/images.json')[value.article.image.key]);
  for(const asset of value.article.image.assets)assert.ok(fs.existsSync(env.repo.file('public/'+asset.to)));
  assert.ok(!fs.readFileSync(env.repo.file('public/noticias/'+value.article.slug+'.html'),'utf8').includes('editorial/data/incoming'));
});
test('cabeçalhos e dimensões de imagens, campos privados e symlinks são bloqueados',t=>{
  const env=sandbox(t),value=structuredClone(fixture);value.article.image.record=structuredClone(env.repo.read('content/images.json').network);
  value.article.image.key='registro-sintetico';value.article.image.record.width=1200;
  assert.ok(validate(env.repo,value).errors.some(e=>e.code==='IMAGE_DIMENSIONS'));
  value.article.image.record=structuredClone(env.repo.read('content/images.json').network);value.article.image.record.privateNote='Dado privado não publicável';
  assert.ok(validate(env.repo,value).errors.some(e=>e.code==='IMAGE_RECORD'));
  value.article.image.record=structuredClone(env.repo.read('content/images.json').network);value.article.image.record.processing={internalNote:'Privado'};
  assert.ok(validate(env.repo,value).errors.some(e=>e.code==='IMAGE_RECORD'));
  value.article.image.record=structuredClone(env.repo.read('content/images.json').network);value.article.image.record.originalWidth={internalNote:'Privado'};
  assert.ok(validate(env.repo,value).errors.some(e=>e.code==='IMAGE_RECORD'));
  const outside=sandbox(t);const destination=env.repo.file('editorial/data/incoming');fs.mkdirSync(destination,{recursive:true});
  fs.symlinkSync(outside.root,path.join(destination,'foreign'),process.platform==='win32'?'junction':'dir');
  expectCode(()=>env.repo.input('editorial/data/incoming/foreign/config.json'),'SYMLINK');
});
test('JSON profundamente aninhado é bloqueado antes de recursão ou importação',t=>{
  const env=sandbox(t),value=structuredClone(fixture);let deep='fim';for(let i=0;i<30;i++)deep={child:deep};value.article.image.record={processing:deep};
  assert.equal(validate(env.repo,value).errors[0].code,'INPUT_COMPLEXITY');
  expectCode(()=>env.engine.import(input(env.repo,value)),'INPUT_COMPLEXITY');
});
test('build normal não promove rascunhos e bloqueia estado em transação incompleta',t=>{
  const env=sandbox(t),id=env.engine.import(input(env.repo)).input.id,before=publicSnapshot(env.repo);
  const build=()=>spawnSync(process.execPath,[env.repo.file('src/build.mjs')],{cwd:env.root,encoding:'utf8'});
  assert.equal(build().status,0);assert.deepEqual(publicSnapshot(env.repo),before);assert.equal(env.repo.get(id).state,'draft');
  env.repo.withLock(()=>assert.notEqual(build().status,0));
  atomicWrite(env.repo.journal,jsonBytes({fixture:true}));assert.notEqual(build().status,0);
});

test('alteração do alvo depois da aprovação invalida atualização sem sobrescrever a edição externa',t=>{
  const env=sandbox(t),created=approve(env);env.engine.publish(created);
  const value=structuredClone(fixture);value.id='atualizacao-com-conflito';value.operation='update';value.targetSlug=value.article.slug;value.article.summary='Resumo sintético alterado.';value.article.changeNote='Atualização sintética explícita.';
  const id=approve(env,value),articles=env.repo.read('content/articles.json');articles.find(a=>a.slug===value.targetSlug).summary='Edição externa a preservar';atomicWrite(env.repo.file('content/articles.json'),jsonBytes(articles));
  expectCode(()=>env.engine.publish(id),'APPROVAL_CHANGED');assert.equal(env.repo.read('content/articles.json').find(a=>a.slug===value.targetSlug).summary,'Edição externa a preservar');
});
test('mudança concorrente durante dry-run aborta o plano sem escrever estado editorial',t=>{
  let env;env=sandbox(t,{fault:point=>{if(point==='before-build')fs.appendFileSync(env.repo.file('public/assets/style.css'),'\n/* edição externa sintética */');}});const id=approve(env),before=fs.readFileSync(env.repo.recordPath(id));
  expectCode(()=>env.engine.publish(id,{dryRun:true}),'CONCURRENT_CHANGE');assert.deepEqual(fs.readFileSync(env.repo.recordPath(id)),before);assert.equal(fs.existsSync(env.repo.journal),false);
});
test('interrupção real de processo deixa lock/diário recuperáveis e restaura arquivos',t=>{
  const env=sandbox(t),id=approve(env),before=publicSnapshot(env.repo);
  const repoUrl=new URL('../../src/editorial/repository.mjs',import.meta.url).href,engineUrl=new URL('../../src/editorial/engine.mjs',import.meta.url).href;
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {Repository} from ${JSON.stringify(repoUrl)};import {EditorialEngine} from ${JSON.stringify(engineUrl)};const r=new Repository(${JSON.stringify(env.root)},{fault:(point,detail)=>{if(point==='before-build')console.log(JSON.stringify({stage:detail.stage}));if(point==='after-write'&&detail.index===2)process.kill(process.pid,'SIGKILL');}});new EditorialEngine(r).publish(${JSON.stringify(id)});`],{encoding:'utf8',timeout:30000});
  assert.notEqual(child.status,0);assert.ok(fs.existsSync(env.repo.lock));assert.ok(fs.existsSync(env.repo.journal));
  assert.equal(env.engine.recover({breakLock:true,reason:'Recuperação de processo sintético interrompido.'}).action,'rolled-back');assert.deepEqual(publicSnapshot(env.repo),before);assert.equal(env.repo.get(id).state,'approved');
  const {stage}=JSON.parse(child.stdout.trim());assert.ok(stage.startsWith(path.join(os.tmpdir(),'pulso-editorial-')));fs.rmSync(stage,{recursive:true,force:true});
});
test('expectativa e rumor qualificados são rastreáveis, sem certificação automática de verdade',t=>{
  const env=sandbox(t),value=structuredClone(fixture);
  value.article.summary='Um resumo sintético sobre todo o fluxo editorial local.';
  value.article.sections[0].paragraphs[0]='Expectativa sintética: este fluxo poderá preparar uma demonstração futura.';value.article.claims[0].text=value.article.sections[0].paragraphs[0];value.article.claims[0].classification='expectation';
  value.article.sections[1].paragraphs[0]='Rumor não confirmado em cenário sintético, sem notícia real.';value.article.claims[1].text=value.article.sections[1].paragraphs[0];value.article.claims[1].classification='rumor';
  value.article.eventDate='2999-01-01';value.article.eventLabel='Data prevista da simulação';const result=validate(env.repo,value);assert.equal(result.valid,true);assert.ok(result.warnings.some(w=>w.code==='HUMAN_REVIEW_REQUIRED'));
});
