import {check} from '../common.mjs';

const OMITTED = (count) => `\n[... ${count} caracteres omitidos ...]\n`;

function quoteAnchors(text) {
  return [...String(text || '').matchAll(/[“"]([^”"]{8,})[”"]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function anchorPositions(excerpt, claims) {
  const positions = new Set();
  const tokens = [];
  for (const claim of claims) {
    for (const quote of quoteAnchors(claim.text)) {
      const start = excerpt.indexOf(quote);
      if (start >= 0) {
        positions.add(start);
        positions.add(start + quote.length);
      }
    }
    if (claim.attribution) {
      const start = excerpt.indexOf(claim.attribution);
      if (start >= 0) positions.add(start);
    }
    tokens.push(...String(claim.text || '').matchAll(/\d+(?:[.,]\d+)?/g));
  }
  for (const match of tokens) {
    let start = excerpt.indexOf(match[0]);
    while (start >= 0) {
      positions.add(start);
      start = excerpt.indexOf(match[0], start + match[0].length);
    }
  }
  return [...positions].sort((left, right) => left - right);
}

function targetedText(excerpt, positions, budget) {
  if (excerpt.length <= budget) {
    return {text: excerpt, coverage: 'complete', omittedChars: 0, windows: [[0, excerpt.length]], anchorsCovered: positions.length};
  }
  const windowCount = Math.max(1, positions.length);
  const windowSize = Math.max(180, Math.floor(budget / windowCount));
  const radius = Math.max(70, Math.floor((windowSize - 20) / 2));
  const ranges = [];
  for (const position of positions) {
    const start = Math.max(0, position - radius);
    const end = Math.min(excerpt.length, position + radius);
    const previous = ranges.at(-1);
    if (previous && start <= previous[1] + 80) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  if (!ranges.length) ranges.push([0, Math.min(excerpt.length, budget)]);
  let remaining = budget;
  const bounded = [];
  for (const [start, end] of ranges) {
    if (remaining <= 0) break;
    const size = Math.min(end - start, remaining);
    bounded.push([start, start + size]);
    remaining -= size;
  }
  const included = bounded.reduce((total, [start, end]) => total + end - start, 0);
  const chunks = [];
  let cursor = 0;
  for (const [start, end] of bounded) {
    if (start > cursor) chunks.push(OMITTED(start - cursor));
    chunks.push(excerpt.slice(start, end));
    cursor = end;
  }
  if (cursor < excerpt.length) chunks.push(OMITTED(excerpt.length - cursor));
  const covered = positions.filter((position) => bounded.some(([start, end]) => position >= start && position <= end)).length;
  return {
    text: chunks.join(''),
    coverage: positions.length > 0 && covered === positions.length ? 'targeted' : 'partial',
    omittedChars: excerpt.length - included,
    windows: bounded,
    anchorsCovered: covered,
  };
}

export function buildEvidenceContexts(claims, evidence, {maxChars = 6000} = {}) {
  check(Number.isInteger(maxChars) && maxChars >= 800 && maxChars <= 8000, 'REVIEW_CONFIG', 'Orçamento de evidências da revisão inválido.');
  const usedIds = new Set(claims.flatMap((claim) => claim.evidenceIds || []));
  const used = evidence.filter((item) => usedIds.has(item.id));
  check(used.length > 0, 'REVIEW_EVIDENCE_INSUFFICIENT', 'Nenhuma evidência vinculada aos claims.');
  const fullChars = used.reduce((total, item) => total + String(item.excerpt || '').length, 0);
  const contexts = new Map();
  let remaining = maxChars;
  for (const [index, item] of used.entries()) {
    const excerpt = String(item.excerpt || '');
    const referencingClaims = claims.filter((claim) => (claim.evidenceIds || []).includes(item.id));
    const positions = anchorPositions(excerpt, referencingClaims);
    const slots = Math.max(1, used.length - index);
    const budget = fullChars <= maxChars ? excerpt.length : Math.max(256, Math.floor(remaining / slots));
    const selected = targetedText(excerpt, positions, budget);
    remaining = Math.max(0, remaining - Math.min(excerpt.length, budget));
    contexts.set(item.id, {
      id: item.id,
      chars: selected.text.length,
      originalChars: excerpt.length,
      omittedChars: selected.omittedChars,
      coverage: selected.coverage,
      windows: selected.windows,
      anchors: positions.length,
      anchorsCovered: selected.anchorsCovered,
      truncated: selected.coverage !== 'complete',
      sourceTruncated: item.completeness === 'truncated',
      text: selected.text,
    });
  }
  const coverage = [...contexts.values()].map(({id, chars, originalChars, omittedChars, coverage, truncated, sourceTruncated, anchorsCovered, anchors}) => ({
    evidenceId: id,
    chars,
    originalChars,
    omittedChars,
    coverage,
    truncated,
    sourceTruncated,
    anchorsCovered,
    anchors,
  }));
  const insufficient = coverage.filter((item) => item.coverage === 'partial');
  check(!insufficient.length, 'REVIEW_EVIDENCE_INSUFFICIENT', 'A evidência necessária não cabe integralmente em janelas relevantes; revisão semântica não pode prosseguir.', {coverage});
  return {contexts, coverage, truncated: coverage.some((item) => item.truncated)};
}
