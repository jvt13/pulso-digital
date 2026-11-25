import fs from 'node:fs';
import { checkSchema, safeId, hash, ensure, inputBudget } from './schema.mjs';
import { detectDuplicates, normalize } from './deduplication.mjs';
import { dimensions } from './image.mjs';

export function validDate(value, timestamp = false) {
  if (typeof value !== 'string' || !(timestamp ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return false;
  const day = value.slice(0, 10), date = new Date(day + 'T12:00:00Z');
  return Number.isFinite(Date.parse(value)) && Number.isFinite(+date) && date.toISOString().slice(0, 10) === day;
}
export function safeUrl(value) {
  if(typeof value!=='string')return false;
  try { const u = new URL(value); return /^https?:\/\//i.test(value) && ['https:', 'http:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password && !/[\u0000-\u0020<>"'\\]/.test(value); } catch { return false; }
}
function walk(value, fn, location = '$') {
  if (typeof value === 'string') fn(value, location);
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, fn, `${location}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, fn, `${location}.${k}`));
}
export function resolveImage(repo, input, published, registry) {
  const image = input.article.image;
  ensure(image && safeId(image.key), 'IMAGE_REQUIRED', 'Informe uma referência segura de imagem.');
  const existing=Object.hasOwn(registry,image.key)?registry[image.key]:null;
  const record = image.record || existing;
  ensure(record, 'IMAGE_RECORD', 'Imagem sem registro de origem/autorização.');
  if (image.record && existing) ensure(hash(image.record) === hash(existing), 'IMAGE_CONFLICT', 'O motor não substitui silenciosamente registros de imagem já existentes. Use uma chave nova.');
  const fields=['kind','credit','sourceUrl','originalUrl','license','licenseUrl','originalWidth','originalHeight','alt','caption','processing','src','smallSrc','shareSrc','width','height','previewAllowed','checkedAt','files'];
  ensure(Object.keys(record).every(k=>fields.includes(k)),'IMAGE_RECORD','Campo não público/não reconhecido no registro da imagem.');
  for (const field of ['src', 'smallSrc', 'shareSrc', 'alt', 'caption', 'credit', 'sourceUrl', 'license', 'licenseUrl', 'kind', 'files']) ensure(record[field], 'IMAGE_RECORD', `Registro de imagem incompleto: ${field}.`);
  for(const field of ['src','smallSrc','shareSrc','alt','caption','credit','sourceUrl','license','licenseUrl','kind'])ensure(typeof record[field]==='string'&&record[field].trim()&&record[field].length<=6000,'IMAGE_RECORD','Campo de imagem deve ser texto limitado.');
  ensure(Number.isInteger(record.width)&&Number.isInteger(record.height)&&record.width<=16000&&record.height>0&&record.height<=16000&&typeof record.previewAllowed==='boolean'&&validDate(record.checkedAt)&&record.checkedAt<=repo.now().slice(0,10),'IMAGE_RECORD','Dimensões, permissão de preview ou data de verificação inválidas.');
  if(record.originalUrl)ensure(safeUrl(record.originalUrl),'IMAGE_AUTHORIZATION','URL do original inválida.');
  for(const field of ['originalWidth','originalHeight'])if(Object.hasOwn(record,field))ensure(record[field]===null||(Number.isInteger(record[field])&&record[field]>0&&record[field]<=100000),'IMAGE_RECORD','Dimensão original deve ser número inteiro ou null.');
  if(Object.hasOwn(record,'processing'))ensure(typeof record.processing==='string'&&record.processing.length<=6000,'IMAGE_RECORD','Processamento deve ser texto público limitado.');
  ensure(record.files&&typeof record.files==='object'&&!Array.isArray(record.files)&&Object.keys(record.files).length===3,'IMAGE_RECORD','Registre as três variantes.');
  ensure(['illustration', 'photograph'].includes(record.kind) && safeUrl(record.sourceUrl) && safeUrl(record.licenseUrl), 'IMAGE_AUTHORIZATION', 'Origem ou fundamento de uso inválido.');
  ensure(record.width >= 1200 && record.width * 9 === record.height * 16, 'IMAGE_DIMENSIONS', 'Imagem principal deve ter ao menos 1200 px e proporção 16:9.');
  ensure(image.authorization?.basis?.trim().length >= 10 && safeUrl(image.authorization?.url) && image.credit === record.credit, 'IMAGE_AUTHORIZATION', 'Documente autorização e crédito correspondentes ao registro.');
  ensure(image.alt?.trim() && image.caption?.trim(), 'IMAGE_CAPTION', 'Legenda e alt são obrigatórios.');
  ensure(image.alt===record.alt && image.caption===record.caption,'IMAGE_CAPTION','Alt e legenda devem corresponder ao registro; para outro uso, registre uma imagem com chave própria.');
  if (record.kind === 'illustration') ensure(/ilustra/i.test(image.caption) && /ilustra/i.test(image.alt), 'ILLUSTRATION_LABEL', 'Identifique a ilustração no alt e na legenda.');
  const uses = published.filter(a => a.image === image.key && a.slug !== input.targetSlug);
  ensure(!uses.length || image.reuseJustification?.trim().length >= 20, 'IMAGE_REUSE', 'A imagem pertence a outra matéria; justifique editorialmente a reutilização.');
  const transfers = image.assets || [], transferMap = new Map();
  for (const asset of transfers) {
    ensure(/^[a-z0-9/._-]+$/.test(asset.from) && /^[a-z0-9/._-]+$/.test(asset.to),'IMAGE_PATH','Use caminhos ASCII seguros, sem encoding, query ou fragmento.');
    ensure(asset.from.startsWith('editorial/data/incoming/') && asset.to.startsWith(`assets/editorial/${input.id}/`) && /\.(webp|jpg|jpeg|png)$/.test(asset.to), 'IMAGE_PATH', 'Assets novos devem vir de incoming/ e ter destino exclusivo em assets/editorial/ID/.');
    ensure(!transferMap.has(asset.to), 'IMAGE_PATH', 'Destino de asset repetido.');
    transferMap.set(asset.to, repo.file(asset.from)); repo.file('public/' + asset.to);
    ensure(!fs.existsSync(repo.file('public/' + asset.to)) || hash(fs.readFileSync(repo.file('public/' + asset.to))) === hash(fs.readFileSync(repo.file(asset.from))), 'IMAGE_CONFLICT', 'Um asset público existente não será sobrescrito.');
  }
  const assets = [];
  for (const file of Object.values(record.files)) {
    ensure(file && typeof file.path === 'string' && /^[a-z0-9/._-]+$/.test(file.path) && file.path.startsWith('assets/') && /\.(webp|jpg|jpeg|png)$/.test(file.path), 'IMAGE_PATH', 'Caminho ou formato de imagem não permitido.');
    const source = transferMap.get(file.path) || repo.file('public/' + file.path);
    const stat = fs.lstatSync(source);
    ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size <= repo.config.limits.assetBytes && stat.size === file.bytes, 'IMAGE_FILE', 'Asset ausente, não regular ou tamanho divergente.');
    const bytes = fs.readFileSync(source), extension = file.path.split('.').at(-1);
    ensure(Object.keys(file).every(k=>['path','width','height','bytes'].includes(k))&&Number.isInteger(file.width)&&Number.isInteger(file.height)&&Number.isInteger(file.bytes),'IMAGE_RECORD','Metadados da variante inválidos.');
    const signature = extension === 'webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' : extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216;
    ensure(signature, 'IMAGE_FILE', 'Conteúdo do asset incompatível com o formato.');
    const actual=dimensions(bytes,extension);ensure(actual.width===file.width&&actual.height===file.height,'IMAGE_DIMENSIONS','Dimensões declaradas não correspondem ao arquivo.');
    if(file.path===record.src||file.path===record.shareSrc)ensure(file.width===record.width&&file.height===record.height,'IMAGE_DIMENSIONS','Variantes principais inconsistentes com o registro.');
    assets.push({ path: file.path, source, hash: hash(bytes) });
  }
  ensure([record.src, record.smallSrc, record.shareSrc].every(p => assets.some(a => a.path === p)) && transfers.every(t => assets.some(a => a.path === t.to)), 'IMAGE_RECORD', 'Variantes ou transferências sem registro correspondente.');
  const mainHash=assets.find(a=>a.path===record.src).hash;
  const matchingUse=published.some(a=>a.slug!==input.targetSlug&&Object.hasOwn(registry,a.image)&&registry[a.image].src&&hash(fs.readFileSync(repo.file('public/'+registry[a.image].src)))===mainHash);
  ensure(!matchingUse||image.reuseJustification?.trim().length>=20,'IMAGE_REUSE','Imagem já utilizada, mesmo sob outra chave: justifique editorialmente a reutilização.');
  return { record, assets, reused: uses.length > 0||matchingUse };
}

export function validate(repo, input) {
  if(!inputBudget(input))return {valid:false,errors:[{code:'INPUT_COMPLEXITY',path:'$',message:'JSON excede o limite de profundidade/elementos.'}],warnings:[],checkedAt:repo.now(),contentHash:null};
  const errors = checkSchema(input), warnings = [], now = repo.now(), today = now.slice(0, 10);
  const fail = (code, location, message) => errors.push({ code, path: location, message });
  walk(input, (text, location) => {
    if (/<|>|\u0000|(?:javascript|vbscript|data)\s*:/i.test(text) || /&(?:lt|gt|#0*60|#x0*3c);/i.test(text)) fail('INJECTION', location, 'HTML, JavaScript e protocolos perigosos não são aceitos.');
    if (/\b(?:TODO|TBD)\b/.test(text)||/lorem ipsum|placeholder|preencher aqui/i.test(text)) fail('PLACEHOLDER', location, 'Conteúdo incompleto.');
    if (text.length > 80000) fail('LIMIT', location, 'Campo acima do limite máximo.');
  });
  if (errors.length) return { valid: false, errors, warnings, checkedAt: now, contentHash: null };
  const a = input.article, limits = repo.config.limits;
  const required = ['title','slug','summary','category','tags','sections','language','editorial','sources','claims','image'];
  for (const field of required) if (!a[field] || (Array.isArray(a[field]) && !a[field].length)) fail('REQUIRED', '$.article.' + field, 'Campo obrigatório para validação/publicação.');
  if (!safeId(input.id) || !safeId(a.slug)) fail('UNSAFE_SLUG', '$.article.slug', 'Identificador ou slug inseguro para Windows/Linux.');
  if (a.language !== 'pt-BR' || a.editorial?.name !== repo.read('config.json').name || a.editorial?.role !== 'Edição institucional provisória') fail('EDITORIAL_IDENTITY', '$.article.editorial', 'Utilize a identificação institucional documentada; não invente autoria pessoal.');
  for (const field of ['title','summary']) if (a[field]?.length > limits[field]) fail('LIMIT', '$.article.' + field, 'Campo acima do limite configurado.');
  if ((a.tags?.length || 0) > limits.tags || (a.sources?.length || 0) > limits.sources || (a.sections?.length || 0) > limits.sections) fail('LIMIT', '$.article', 'Quantidade de elementos acima do limite configurado.');
  if ((a.sections?.length || 0) < 2) fail('BODY', '$.article.sections', 'Informe ao menos duas seções estruturadas.');
  let bodySize = 0;
  for (const [i, section] of (a.sections || []).entries()) {
    if (!section.paragraphs.length || section.paragraphs.length > limits.paragraphsPerSection) fail('BODY', `$.article.sections[${i}]`, 'Quantidade de parágrafos inválida.');
    for (const paragraph of section.paragraphs) { bodySize += paragraph.length; if (paragraph.length > limits.paragraph) fail('LIMIT', '$.article.sections', 'Parágrafo acima do limite.'); }
  }
  if (bodySize > limits.body) fail('LIMIT', '$.article.sections', 'Corpo acima do limite.');
  const sourceIds = new Set();
  for (const [i, source] of (a.sources || []).entries()) {
    if (!safeId(source.id) || sourceIds.has(source.id)) fail('SOURCE_ID', `$.article.sources[${i}]`, 'ID de fonte inválido ou repetido.');
    sourceIds.add(source.id);
    if (!safeUrl(source.url)) fail('SOURCE_URL', `$.article.sources[${i}].url`, 'Use URL absoluta HTTP/HTTPS sem credenciais.');
    if (!validDate(source.checkedAt) || source.checkedAt > today || (source.publishedDate && (!validDate(source.publishedDate) || source.publishedDate > source.checkedAt))) fail('SOURCE_DATE', `$.article.sources[${i}]`, 'Data de fonte/consulta inválida ou incoerente.');
  }
  const covered = new Set(), claimIds = new Set();
  for (const claim of a.claims || []) {
    const paragraph = a.sections?.[claim.section]?.paragraphs?.[claim.paragraph], key = `${claim.section}:${claim.paragraph}`;
    if (!safeId(claim.id) || claimIds.has(claim.id) || !Number.isInteger(claim.section) || !Number.isInteger(claim.paragraph) || paragraph !== claim.text || covered.has(key)) fail('CLAIM_MAPPING', '$.article.claims', 'Cada afirmação deve mapear exatamente um parágrafo e ter ID único.');
    claimIds.add(claim.id); covered.add(key);
    if ((claim.classification !== 'opinion' && !claim.sourceIds.length) || claim.sourceIds.some(id => !sourceIds.has(id)) || claim.evidence.trim().length < 10) fail('EVIDENCE', '$.article.claims', 'Documente evidência e fontes para a afirmação.');
    if (claim.classification === 'rumor' && !/rumor|nao confirmad|sem confirmacao/.test(normalize(claim.text))) fail('CLAIM_QUALIFIER', '$.article.claims', 'Rumor deve estar identificado no texto.');
    if (claim.classification === 'expectation' && !/previ|esper|meta|planej|estim|pode|podera/.test(normalize(claim.text))) fail('CLAIM_QUALIFIER', '$.article.claims', 'Expectativa deve estar identificada no texto.');
  }
  (a.sections || []).forEach((s,i) => s.paragraphs.forEach((_,j) => { if (!covered.has(`${i}:${j}`)) fail('EVIDENCE_COVERAGE', '$.article.claims', 'Parágrafo sem rastreabilidade declarada.'); }));
  if (a.eventDate && (!validDate(a.eventDate) || !a.eventLabel || (a.eventDate > today && (!(a.claims || []).some(c => c.classification === 'expectation') || !/prev|meta|planej|estim/i.test(a.eventLabel))))) fail('EVENT_DATE', '$.article.eventDate', 'Data do acontecimento inválida ou futuro sem qualificação de expectativa.');
  const published = repo.read('content/articles.json'), registry = repo.read('content/images.json'), target = published.find(p => p.slug === input.targetSlug);
  if (input.operation === 'update' && (!target || a.slug !== input.targetSlug || !a.changeNote?.trim())) fail('UPDATE_TARGET', '$.targetSlug', 'Atualização exige alvo existente, slug preservado e descrição da alteração.');
  if (input.operation === 'create' && input.targetSlug) fail('UPDATE_TARGET', '$.targetSlug', 'Nova matéria não pode indicar alvo de atualização.');
  let image;
  try { image = resolveImage(repo, input, published, registry); } catch (e) { fail(e.code || 'IMAGE_FILE', '$.article.image', e.message); }
  const duplicates = detectDuplicates(input, published, repo.list(), repo.config.deduplication);
  errors.push(...duplicates.errors); warnings.push(...duplicates.warnings);
  if (a.sources?.length < repo.config.deduplication.recommendedSources) warnings.push({ code: 'SOURCE_COUNT', message: 'Poucas fontes: quantidade não determina confiabilidade ou independência.' });
  if (image?.reused) warnings.push({ code: 'IMAGE_REUSE_REVIEW', message: 'Reutilização de imagem exige revisão explícita da justificativa e dos direitos.' });
  warnings.push({ code: 'HUMAN_REVIEW_REQUIRED', message: 'Validação determinística não verifica fatos, independência de fontes, originalidade ou direitos de imagem.' });
  const contentHash = errors.length ? null : hash({ input, image: image.record, assets: image.assets.map(({ path, hash }) => ({ path, hash })), target: target ? hash(target) : null });
  return { valid: !errors.length, errors, warnings, checkedAt: now, contentHash, targetHash: target ? hash(target) : null };
}
