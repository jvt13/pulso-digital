import { hash } from './schema.mjs';

export const normalize = text => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export function normalizeUrl(value) {
  try {
    const url = new URL(value); url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.href;
  } catch { return null; }
}
export const contentDigest = article => hash(normalize((article.sections || []).flatMap(section => section.paragraphs || []).join(' ')));
export function titleSimilarity(left, right) {
  const a = new Set(normalize(left).split(' ').filter(w => w.length > 1));
  const b = new Set(normalize(right).split(' ').filter(w => w.length > 1));
  if (!a.size || !b.size) return 0;
  return [...a].filter(word => b.has(word)).length / new Set([...a, ...b]).size;
}
export function detectDuplicates(input, published, drafts, config) {
  const errors = [], warnings = [], article = input.article;
  const candidates = [...published.map(a => ({ id: a.editorialId, article: a, published: true })), ...drafts.filter(d => d.state !== 'rejected' && d.state !== 'published').map(d => ({ id: d.input.id, article: d.input.article, published: false }))];
  const urls = new Set((article.sources || []).map(s => normalizeUrl(s.url)).filter(Boolean));
  for (const other of candidates) {
    if (!other.published && other.id === input.id) continue;
    if (input.operation === 'update' && other.published && other.article.slug === input.targetSlug) continue;
    const details = { id: other.id || null, slug: other.article.slug || null };
    if (other.id && other.id === input.id) errors.push({ code: 'DUPLICATE_ID', message: 'Identificador já utilizado.', ...details });
    if (article.slug && article.slug === other.article.slug) errors.push({ code: 'SLUG_COLLISION', message: 'Slug já utilizado; uma atualização precisa indicar explicitamente seu alvo.', ...details });
    if (article.sections?.length && other.article.sections?.length && contentDigest(article) === contentDigest(other.article)) errors.push({ code: 'EXACT_DUPLICATE', message: 'Corpo normalizado idêntico a outro conteúdo.', ...details });
    const similarity = titleSimilarity(article.title, other.article.title);
    if (similarity >= config.titleSimilarity) warnings.push({ code: 'SIMILAR_TITLE', message: 'Título semelhante; exige revisão explícita.', similarity, ...details });
    if ((other.article.sources || []).some(s => urls.has(normalizeUrl(s.url)))) warnings.push({ code: 'SHARED_SOURCE', message: 'Fonte compartilhada; isso não comprova duplicidade nem independência.', ...details });
  }
  return { errors, warnings };
}
