const ROLE_PATTERNS = {
  'central-event': /\b(?:announc|launch|release|review|lock|introduc|unveil|beta\s+\d|benchmark|update)\w*/i,
  'technical-context': /\b(?:nuclear|propulsion|reactor|engine|api|model|llm|dataset|benchmark|capabilit|rendering|metal|audio|script|editor|godot|spacecraft|payload|helicopter)\w*/i,
  background: /\b(?:first|previous|earlier|since|before|after|last|history|evolved|beta\s+4|6 months)\b/i,
  impact: /\b(?:allow|enable|help|reduc|improv|requir|benefit|support|simplif|protect|consisten)\w*/i,
  limitation: /\b(?:but|however|still|not|cannot|target|planned|expected|risk|warning|revert|fix(?:es|ed)?|blocker)\b/i,
  date: /\b(?:19|20)\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i,
  future: /\b(?:will|planned|target|expected|next|through|by\s+(?:19|20)\d{2}|2028|2027)\b/i,
};

const ROLE_WEIGHTS = {
  'central-event': 5,
  'technical-context': 4,
  impact: 4,
  limitation: 3,
  background: 2,
  date: 2,
  future: 2,
};

const NOISE = /\b(?:cookie|subscribe|newsletter|privacy policy|donate|donations|support the project financially|all rights reserved)\b/i;

export const MAX_EXCERPT_CHARS = 600;

export function describeEvidence(excerpt, maxChars = MAX_EXCERPT_CHARS) {
  const text = String(excerpt || '').replace(/\s+/g, ' ').trim();
  const roles = Object.entries(ROLE_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([role]) => role);
  return {
    complete: text.length < maxChars,
    truncated: text.length >= maxChars,
    chars: text.length,
    roles,
  };
}

function scoreExcerpt(detail, index) {
  const roleScore = detail.roles.reduce((total, role) => total + (ROLE_WEIGHTS[role] || 1), 0);
  const earlyBonus = index < 3 ? 3 : index < 6 ? 1 : 0;
  const completenessBonus = detail.complete ? 1 : 0;
  return roleScore + earlyBonus + completenessBonus;
}

export function rankExcerpts(candidates, {limit = 14, maxChars = MAX_EXCERPT_CHARS} = {}) {
  const unique = [...new Set(candidates.map((text) => String(text || '').replace(/\s+/g, ' ').trim())
    .filter((text) => text.length >= 35 && !NOISE.test(text)))];
  const described = unique.map((text, index) => ({text, index, ...describeEvidence(text, maxChars)}));
  const selected = [];
  const selectedText = new Set();
  for (const role of ['central-event', 'technical-context', 'impact', 'limitation', 'background', 'date', 'future']) {
    const best = described
      .filter((item) => item.roles.includes(role) && !selectedText.has(item.text))
      .sort((left, right) => scoreExcerpt(right, right.index) - scoreExcerpt(left, left.index))[0];
    if (best) {
      selected.push(best);
      selectedText.add(best.text);
    }
    if (selected.length >= limit) break;
  }
  for (const item of [...described].sort((left, right) => scoreExcerpt(right, right.index) - scoreExcerpt(left, left.index))) {
    if (selected.length >= limit) break;
    if (selectedText.has(item.text)) continue;
    selected.push(item);
    selectedText.add(item.text);
  }
  return selected.map((item) => ({
    text: item.text.slice(0, maxChars),
    complete: item.text.length <= maxChars,
    truncated: item.text.length > maxChars,
    chars: Math.min(item.text.length, maxChars),
    roles: item.roles,
  }));
}

export function evidenceGroups(dossier) {
  const groups = Object.fromEntries(Object.keys(ROLE_PATTERNS).map((role) => [role, []]));
  for (const item of dossier?.evidence || []) {
    const described = describeEvidence(item.excerpt, MAX_EXCERPT_CHARS);
    const roles = item.roles?.length ? item.roles : described.roles;
    const complete = typeof item.complete === 'boolean' ? item.complete : described.complete;
    for (const role of roles) groups[role]?.push({id: item.id, complete, excerpt: item.excerpt});
  }
  return groups;
}

export function evidenceInstruction(dossier) {
  const groups = evidenceGroups(dossier);
  return Object.entries(groups)
    .filter(([, items]) => items.length)
    .map(([role, items]) => `${role}: ${items.slice(0, 4).map((item) => `${item.id}${item.complete ? '' : ' (truncado)'}`).join(', ')}`)
    .join('; ');
}

export function promptEvidence(dossier, {limit = 9} = {}) {
  const byPrefix = new Map();
  for (const [index, item] of (dossier?.evidence || []).entries()) {
    const text = String(item.excerpt || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const described = describeEvidence(text, MAX_EXCERPT_CHARS);
    const roles = item.roles?.length ? item.roles : described.roles;
    const complete = typeof item.complete === 'boolean' ? item.complete : described.complete;
    const candidate = {...item, roles, complete, truncated: !complete, index};
    const key = text.slice(0, 120).toLowerCase();
    const prior = byPrefix.get(key);
    if (!prior || (candidate.complete && !prior.complete) || (candidate.complete === prior.complete && text.length > prior.excerpt.length)) {
      byPrefix.set(key, candidate);
    }
  }
  const items = [...byPrefix.values()].map((item) => ({
    ...item,
    score: item.roles.length * 4 + (item.complete ? 4 : 0) + (item.roles.includes('central-event') ? 3 : 0) + (item.roles.includes('limitation') ? 2 : 0),
  }));
  const selected = [];
  const selectedIds = new Set();
  for (const role of ['central-event', 'technical-context', 'impact', 'limitation', 'background', 'future', 'date']) {
    const best = items.filter((item) => item.roles.includes(role) && !selectedIds.has(item.id)).sort((left, right) => right.score - left.score)[0];
    if (best) {
      selected.push(best);
      selectedIds.add(best.id);
    }
    if (selected.length >= limit) break;
  }
  for (const item of items.sort((left, right) => right.score - left.score)) {
    if (selected.length >= limit) break;
    if (selectedIds.has(item.id)) continue;
    selected.push(item);
    selectedIds.add(item.id);
  }
  return selected.map(({id, sourceId, excerpt, classification, complete, truncated, roles}) => ({
    id,
    sourceId,
    excerpt,
    classification,
    completeness: complete ? 'complete' : 'truncated',
    truncated,
    roles,
  }));
}
