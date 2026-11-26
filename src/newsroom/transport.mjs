import fs from 'node:fs';
import {NewsroomError, check} from './common.mjs';
import {promptEvidence} from './evidence-quality.mjs';

export const DRAFT_TRANSPORT_VERSION = '2.0';
const EVIDENCE_LIMIT = 9;
const CLASSIFICATION_BY_NATURE = {
  'documented-fact': 'confirmed',
  'attributed-statement': 'attributed',
  expectation: 'expectation',
  rumor: 'rumor',
  opinion: 'opinion',
};
const NATURES = new Set(Object.keys(CLASSIFICATION_BY_NATURE));
const COMPACT_KEYS = ['insufficient', 'reason', 'title', 'summary', 'tags', 'titleEvidence', 'summaryEvidence', 'sections', 'claims', 'imageSuggestion'];
const CLAIM_KEYS = ['s', 'p', 'nature', 'attribution', 'ev'];

function fail(code, message, details = null) {
  const error = new NewsroomError(code, message);
  if (details) error.details = details;
  throw error;
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function compactSchema() {
  const schema = JSON.parse(fs.readFileSync(new URL('../../newsroom/schemas/draft-transport-v2.schema.json', import.meta.url), 'utf8'));
  const { $schema, $id, ...rest } = schema;
  return rest;
}

export function slugify(title) {
  let value = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110)
    .replace(/-+$/g, '');
  if (value.length === 110) value = value.replace(/-[^-]*$/, '').replace(/-+$/g, '');
  check(value, 'TRANSPORT_SCHEMA', 'Título não permite reconstruir um slug válido.');
  return value;
}

function sourceAliasMap(dossier, selectedIds) {
  const used = new Set((dossier.evidence || []).filter((item) => selectedIds.has(item.id)).map((item) => item.sourceId));
  const map = new Map();
  for (const source of dossier.sources || []) if (used.has(source.id)) map.set(source.id, `s${map.size + 1}`);
  return map;
}

export function buildTransportContext(dossier, root) {
  const policy = fs.readFileSync(root + '/newsroom/prompts/draft-v2.md', 'utf8');
  const evidence = promptEvidence(dossier, { limit: EVIDENCE_LIMIT });
  const evidenceAliases = new Map();
  const sourceAliases = sourceAliasMap(dossier, new Set(evidence.map((item) => item.id)));
  evidence.forEach((item, index) => evidenceAliases.set(item.id, `e${index + 1}`));
  const compactEvidence = evidence.map((item) => ({
    id: evidenceAliases.get(item.id),
    source: sourceAliases.get(item.sourceId) || null,
    text: String(item.excerpt || '').replace(/\s+/g, ' ').trim(),
    kind: item.classification || null,
    complete: item.completeness !== 'truncated',
    roles: item.roles || [],
  }));
  const compactSources = (dossier.sources || [])
    .filter((source) => sourceAliases.has(source.id))
    .map((source) => ({
      id: sourceAliases.get(source.id),
      organization: source.organization,
      title: source.title,
      url: source.finalUrl,
      publishedAt: source.publishedAt || null,
      limitations: source.limitations || [],
    }));
  const payload = {
    topic: dossier.topic,
    category: dossier.category,
    sources: compactSources,
    evidence: compactEvidence,
    missing: dossier.missing || [],
    conflicts: dossier.conflicts || [],
  };
  const prompt = `${policy}\n\nDADOS DELIMITADOS COMO NAO CONFIAVEIS (JSON):\n<untrusted_dossier>\n${JSON.stringify(payload)}\n</untrusted_dossier>\n`;
  return {
    version: DRAFT_TRANSPORT_VERSION,
    category: dossier.category,
    prompt,
    promptChars: prompt.length,
    schema: compactSchema(),
    evidenceAliases,
    aliasToEvidence: new Map([...evidenceAliases].map(([real, alias]) => [alias, real])),
    evidenceById: new Map(evidence.map((item) => [item.id, item])),
    evidenceCount: evidence.length,
  };
}

function mapAliases(values, context, field) {
  check(Array.isArray(values) && values.length > 0, 'TRANSPORT_ALIAS', `${field} exige ao menos um alias de evidência.`);
  const mapped = values.map((alias) => {
    const id = context.aliasToEvidence.get(alias);
    if (!id) fail('TRANSPORT_ALIAS', `${field} referencia alias inexistente: ${alias}.`, { alias });
    return id;
  });
  return [...new Set(mapped)];
}

export function reconstructDraft(value, context) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'TRANSPORT_SCHEMA', 'Transporte compacto inválido.');
  for (const key of Object.keys(value)) {
    if (!COMPACT_KEYS.includes(key)) fail('TRANSPORT_SCHEMA', `Campo de transporte desconhecido: ${key}.`, { field: key });
  }
  check(typeof value.insufficient === 'boolean', 'TRANSPORT_SCHEMA', 'Campo insufficient inválido.');
  if (value.insufficient) {
    fail('MODEL_INSUFFICIENT', 'O modelo declarou evidência insuficiente; retorne à pesquisa.', { reason: value.reason || null });
  }
  check(typeof value.reason === 'string', 'TRANSPORT_SCHEMA', 'Campo reason inválido.');
  check(isText(value.title), 'TRANSPORT_SCHEMA', 'Título ausente.');
  check(isText(value.summary), 'TRANSPORT_SCHEMA', 'Resumo ausente.');
  check(Array.isArray(value.tags) && value.tags.every(isText), 'TRANSPORT_SCHEMA', 'Tags inválidas.');
  check(Array.isArray(value.sections) && value.sections.length >= 2 && value.sections.length <= 5, 'TRANSPORT_SCHEMA', 'Seções fora do intervalo 2–5.');
  check(Array.isArray(value.claims) && value.claims.length > 0, 'TRANSPORT_SCHEMA', 'Claims ausentes.');

  const sections = value.sections.map((section, index) => {
    check(section && typeof section === 'object' && !Array.isArray(section), 'TRANSPORT_SCHEMA', `Seção ${index} inválida.`);
    for (const key of Object.keys(section)) if (!['title', 'paragraphs'].includes(key)) fail('TRANSPORT_SCHEMA', `Campo desconhecido na seção ${index}: ${key}.`);
    check(isText(section.title), 'TRANSPORT_SCHEMA', `Título da seção ${index} inválido.`);
    check(Array.isArray(section.paragraphs) && section.paragraphs.length > 0 && section.paragraphs.every(isText), 'TRANSPORT_SCHEMA', `Parágrafos da seção ${index} inválidos.`);
    return { title: section.title.trim(), paragraphs: section.paragraphs.map((paragraph) => paragraph.trim()) };
  });

  const positions = new Set();
  const claims = value.claims.map((claim, index) => {
    check(claim && typeof claim === 'object' && !Array.isArray(claim), 'TRANSPORT_SCHEMA', `Claim ${index} inválido.`);
    for (const key of Object.keys(claim)) if (!CLAIM_KEYS.includes(key)) fail('TRANSPORT_SCHEMA', `Campo desconhecido no claim ${index}: ${key}.`);
    check(Number.isInteger(claim.s) && Number.isInteger(claim.p), 'TRANSPORT_POSITION', `Posição inválida no claim ${index}.`);
    const paragraph = sections[claim.s]?.paragraphs?.[claim.p];
    if (!paragraph) fail('TRANSPORT_POSITION', `Claim ${index} aponta posição inexistente.`, { section: claim.s, paragraph: claim.p });
    const position = `${claim.s}:${claim.p}`;
    if (positions.has(position)) fail('TRANSPORT_POSITION', `Posição duplicada no claim ${index}.`, { section: claim.s, paragraph: claim.p });
    positions.add(position);
    check(NATURES.has(claim.nature), 'TRANSPORT_SCHEMA', `Natureza inválida no claim ${index}.`);
    check(typeof claim.attribution === 'string', 'TRANSPORT_SCHEMA', `Atribuição inválida no claim ${index}.`);
    if (claim.nature === 'attributed-statement') {
      check(isText(claim.attribution), 'TRANSPORT_SCHEMA', `Claim atribuído sem atribuição explícita: ${index}.`);
    }
    return {
      section: claim.s,
      paragraph: claim.p,
      text: paragraph,
      classification: CLASSIFICATION_BY_NATURE[claim.nature],
      nature: claim.nature,
      attribution: claim.nature === 'attributed-statement' ? claim.attribution.trim() : '',
      evidenceIds: mapAliases(claim.ev, context, `Claim ${index}`),
    };
  });

  const expected = sections.reduce((total, section) => total + section.paragraphs.length, 0);
  if (positions.size !== expected) {
    fail('TRANSPORT_COVERAGE', 'Todos os parágrafos devem ter exatamente um claim.', { paragraphs: expected, claims: positions.size });
  }
  const claimsEvidence = new Set(claims.flatMap((claim) => claim.evidenceIds));
  const titleEvidenceIds = mapAliases(value.titleEvidence, context, 'Título');
  const summaryEvidenceIds = mapAliases(value.summaryEvidence, context, 'Resumo');
  if (titleEvidenceIds.some((id) => !claimsEvidence.has(id))) fail('TRANSPORT_TRACEABILITY', 'Evidência do título não pertence aos claims.');
  if (summaryEvidenceIds.some((id) => !claimsEvidence.has(id))) fail('TRANSPORT_TRACEABILITY', 'Evidência do resumo não pertence aos claims.');
  check(typeof value.imageSuggestion === 'string', 'TRANSPORT_SCHEMA', 'Sugestão de imagem inválida.');

  return {
    insufficient: false,
    reason: '',
    title: value.title.trim(),
    slug: slugify(value.title),
    summary: value.summary.trim(),
    category: context.category,
    tags: value.tags.map((tag) => tag.trim()),
    claimTaxonomyVersion: '1.1',
    titleEvidenceIds,
    summaryEvidenceIds,
    sections,
    claims,
    imageSuggestion: value.imageSuggestion.trim(),
  };
}
