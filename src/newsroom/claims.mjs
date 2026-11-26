import {normalize} from '../radar/common.mjs';

const RUMOR_QUALIFIER = /\b(?:rumor|nao confirmad|sem confirmacao|nao verificado|especulacao)\b/;
const SOURCE_ATTRIBUTION = /\b(?:segundo|conforme|de acordo com)\s+([^,.;:]{2,80})/i;

export function correctUnqualifiedRumorClaims(draft, dossier) {
  const changes = [];
  const sources = new Map((dossier.sources || []).map((source) => [source.id, source]));
  const evidence = new Map((dossier.evidence || []).map((item) => [item.id, item]));
  for (const [index, claim] of (draft.claims || []).entries()) {
    if (claim.classification !== 'rumor' || claim.nature !== 'rumor') continue;
    if (RUMOR_QUALIFIER.test(normalize(claim.text))) continue;
    const attributionMatch = String(claim.text || '').match(SOURCE_ATTRIBUTION);
    if (!attributionMatch) continue;
    const cited = (claim.evidenceIds || []).map((id) => evidence.get(id)).filter(Boolean);
    if (!cited.length) continue;
    const primarySources = cited.every((item) => sources.get(item.sourceId)?.type === 'primary-organization');
    const attributedText = normalize(attributionMatch[1]);
    const source = cited.map((item) => sources.get(item.sourceId)).find((item) => item && attributedText.includes(normalize(item.organization)));
    if (!primarySources || !source) continue;
    changes.push({
      claimIndex: index,
      previousClassification: claim.classification,
      previousNature: claim.nature,
      classification: 'attributed',
      nature: 'attributed-statement',
      attribution: source.organization,
      reason: 'Normalização mecânica para declaração atribuída: o próprio texto identifica a fonte primária e não há confirmação independente.',
    });
    claim.classification = 'attributed';
    claim.nature = 'attributed-statement';
    claim.attribution = source.organization;
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
    for (const match of excerpt.matchAll(/[“"]([^”"]{40,})[”"]/g)) {
      passages.push({passage: match[1].trim(), evidenceId, excerpt, start: match.index, end: match.index + match[0].length});
    }
  }
  if (passages.length !== 1) return null;
  const selected = passages[0];
  const author = normalize(claim.attribution);
  const nearby = normalize(selected.excerpt.slice(Math.max(0, selected.start - 180), Math.min(selected.excerpt.length, selected.end + 180)));
  if (!nearby.includes(author)) return null;
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

function literalQuote(text) {
  const match = String(text || '').match(/^[“"]([^”"]+)[”"]$/);
  return match?.[1] || null;
}

export function auditMechanicalCorrections(draft, dossier, history = []) {
  const sources = new Map((dossier.sources || []).map((source) => [source.id, source]));
  const evidence = new Map((dossier.evidence || []).map((item) => [item.id, item]));
  const classification = [];
  const attribution = [];
  for (const item of history.filter((entry) => entry.action?.startsWith('mechanical-'))) {
    if (item.action === 'mechanical-classification-correction') {
      for (const change of item.changes || []) {
        const claim = draft.claims?.[change.claimIndex];
        const cited = (claim?.evidenceIds || []).map((id) => evidence.get(id)).filter(Boolean);
        const citedSources = [...new Set(cited.map((entry) => sources.get(entry.sourceId)?.organization).filter(Boolean))];
        const explicitAttribution = SOURCE_ATTRIBUTION.test(String(claim?.text || ''));
        const historicalUnsafeFactPromotion = change.classification === 'confirmed' && citedSources.length === 1 && !explicitAttribution;
        classification.push({
          claimIndex: change.claimIndex,
          previousClassification: change.previousClassification,
          appliedClassification: change.classification,
          currentClassification: claim?.classification || null,
          citedSources,
          explicitAttribution,
          historicalUnsafeFactPromotion,
          mitigated: historicalUnsafeFactPromotion && claim?.classification === 'attributed',
          unsafeIndependentFactPromotion: historicalUnsafeFactPromotion && claim?.classification === 'confirmed',
        });
      }
    }
    if (item.action === 'mechanical-attribution-correction') {
      const change = item.change || {};
      const quote = literalQuote(change.newText);
      const cited = (change.evidenceIds || []).map((id) => evidence.get(id)).filter(Boolean);
      const author = normalize(change.attribution || '');
      const exact = Boolean(quote && cited.some((entry) => entry.excerpt.includes(quote)));
      const authorNearby = Boolean(quote && cited.some((entry) => {
        const position = entry.excerpt.indexOf(quote);
        if (position < 0) return false;
        return normalize(entry.excerpt.slice(Math.max(0, position - 180), Math.min(entry.excerpt.length, position + quote.length + 180))).includes(author);
      }));
      attribution.push({
        claimIndex: change.claimIndex,
        findingId: change.findingId,
        exactLiteralQuote: exact,
        authorNearby,
        citationVerified: exact && authorNearby,
        mechanismWasAmbiguousLongestQuote: true,
      });
    }
  }
  return {
    classification,
    attribution,
    unsafePromotions: classification.filter((item) => item.unsafeIndependentFactPromotion),
    historicalUnsafePromotions: classification.filter((item) => item.historicalUnsafeFactPromotion),
    unverifiedCitations: attribution.filter((item) => !item.citationVerified),
  };
}

export function demoteUnsafeHistoricalPromotions(draft, dossier, history = []) {
  const sources = new Map((dossier.sources || []).map((source) => [source.id, source]));
  const evidence = new Map((dossier.evidence || []).map((item) => [item.id, item]));
  const changes = [];
  for (const item of history.filter((entry) => entry.action === 'mechanical-classification-correction')) {
    for (const change of item.changes || []) {
      if (change.classification !== 'confirmed') continue;
      const claim = draft.claims?.[change.claimIndex];
      if (!claim || claim.classification !== 'confirmed' || SOURCE_ATTRIBUTION.test(String(claim.text || ''))) continue;
      const citedSources = [...new Set((claim.evidenceIds || []).map((id) => sources.get(evidence.get(id)?.sourceId)).filter(Boolean))];
      if (citedSources.length !== 1 || citedSources[0].type !== 'primary-organization') continue;
      changes.push({
        claimIndex: change.claimIndex,
        previousClassification: claim.classification,
        previousNature: claim.nature,
        classification: 'attributed',
        nature: 'attributed-statement',
        attribution: citedSources[0].organization,
        reason: 'Reversão de promoção mecânica anterior: fonte única não equivale a confirmação independente.',
      });
      claim.classification = 'attributed';
      claim.nature = 'attributed-statement';
      claim.attribution = citedSources[0].organization;
    }
  }
  return changes;
}
