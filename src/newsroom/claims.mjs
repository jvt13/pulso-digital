import {normalize} from '../radar/common.mjs';

const RUMOR_QUALIFIER = /\b(?:rumor|nao confirmad|sem confirmacao|nao verificado|especulacao)\b/;
const FACTUAL_VERB = /\b(?:conta|contem|inclui|colabora|contribu|registra|participa|atinge|totaliza|possui|tem)\w*/;

function numbers(text) {
  return [...String(text || '').matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0]);
}

export function correctUnqualifiedRumorClaims(draft, dossier) {
  const changes = [];
  const sources = new Map((dossier.sources || []).map((source) => [source.id, source]));
  const evidence = new Map((dossier.evidence || []).map((item) => [item.id, item]));
  for (const [index, claim] of (draft.claims || []).entries()) {
    if (claim.classification !== 'rumor' || claim.nature !== 'rumor') continue;
    if (RUMOR_QUALIFIER.test(normalize(claim.text)) || !FACTUAL_VERB.test(normalize(claim.text))) continue;
    const cited = (claim.evidenceIds || []).map((id) => evidence.get(id)).filter(Boolean);
    if (!cited.length) continue;
    const primarySources = cited.every((item) => sources.get(item.sourceId)?.type === 'primary-organization');
    const evidenceText = normalize(cited.map((item) => item.excerpt).join(' '));
    const supportedNumbers = numbers(claim.text).every((value) => evidenceText.includes(value));
    if (!primarySources || !supportedNumbers) continue;
    changes.push({
      claimIndex: index,
      previousClassification: claim.classification,
      previousNature: claim.nature,
      classification: 'confirmed',
      nature: 'documented-fact',
      reason: 'Afirmação factual sem qualificador de rumor, com fonte primária e números presentes na evidência associada.',
    });
    claim.classification = 'confirmed';
    claim.nature = 'documented-fact';
    claim.attribution = '';
  }
  return changes;
}

export function correctAttributedQuoteFromFinding(draft, dossier, finding) {
  if (finding?.category !== 'attribution' || finding.field !== 'body' || !Number.isInteger(finding.claimIndex)) return null;
  const claim = draft.claims?.[finding.claimIndex];
  if (!claim || claim.classification !== 'attributed' || !claim.attribution) return null;
  const evidence = new Map((dossier.evidence || []).map((item) => [item.id, item]));
  const passages = [];
  for (const evidenceId of finding.evidenceIds || claim.evidenceIds || []) {
    const excerpt = evidence.get(evidenceId)?.excerpt;
    if (!excerpt) continue;
    for (const match of excerpt.matchAll(/[“"]([^”"]{40,})[”"]/g)) passages.push(match[1].trim());
  }
  if (!passages.length) return null;
  const ranked = passages
    .map((passage) => ({passage, length: passage.length}))
    .sort((left, right) => right.length - left.length);
  const selected = ranked[0];
  if (!selected) return null;
  const previousText = claim.text;
  const quoted = `“${selected.passage}”`;
  draft.sections[claim.section].paragraphs[claim.paragraph] = quoted;
  claim.text = quoted;
  claim.classification = 'attributed';
  claim.nature = 'attributed-statement';
  return {
    claimIndex: finding.claimIndex,
    findingId: finding.findingId,
    previousText,
    newText: quoted,
    attribution: claim.attribution,
    evidenceIds: [...(finding.evidenceIds || claim.evidenceIds || [])],
    reason: 'Substituição mecânica por citação literal da evidência vinculada; nenhuma nova declaração foi criada.',
  };
}
