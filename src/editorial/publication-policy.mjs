import {ensure, hash} from './schema.mjs';

export const PUBLICATION_MODES = ['manual', 'assisted', 'autonomous-controlled'];

function quoteLength(claim) {
  const match = String(claim.text || '').match(/^[“"]([^”"]+)[”"]$/);
  return match?.[1].length || 0;
}

export function classifyEditorialRisk({draft, dossier, review, eligibility, quality, validation}) {
  const factors = [];
  const add = (code, severity, message) => factors.push({code, severity, message});
  const sources = dossier?.sources || [];
  const organizations = new Set(sources.map((source) => source.organization).filter(Boolean));
  const classifications = Object.fromEntries(['confirmed', 'attributed', 'expectation', 'rumor', 'opinion'].map((name) => [name, (draft.claims || []).filter((claim) => claim.classification === name).length]));
  const maxQuote = Math.max(0, ...(draft.claims || []).map(quoteLength));
  const coverage = review?.evidenceCoverage || [];
  if (!eligibility?.checks?.deterministicValidation) add('DETERMINISTIC_BLOCKED', 'high', 'Validação determinística não aprovada.');
  if (!eligibility?.checks?.semanticReview || review?.result !== 'pass') add('SEMANTIC_REVIEW_BLOCKED', 'high', 'Revisão semântica atual não está em pass.');
  if (!eligibility?.checks?.evidence) add('EVIDENCE_BLOCKED', 'high', 'Evidências obrigatórias ausentes.');
  if (!eligibility?.checks?.imageRights) add('IMAGE_RIGHTS_PENDING', 'high', 'Direitos de imagem não documentados.');
  if (!eligibility?.checks?.integrity || !eligibility?.checks?.journal) add('INTEGRITY_BLOCKED', 'high', 'Integridade editorial ou journal não está estável.');
  if ((review?.severityCounts?.critical || 0) > 0) add('CRITICAL_FINDING', 'high', 'Revisão contém achado crítico.');
  if ((review?.severityCounts?.major || 0) > 0) add('MAJOR_FINDING', 'high', 'Revisão contém achado major.');
  if (classifications.rumor > 0) add('RUMOR_PRESENT', 'high', 'Conteúdo contém rumor.');
  if (organizations.size < 2) add('SINGLE_SOURCE', 'medium', 'Fonte única; independência não demonstrada.');
  if (classifications.attributed > 0 || classifications.expectation > 0) add('ATTRIBUTED_OR_EXPECTATION', 'medium', 'Conteúdo depende de declaração atribuída ou expectativa.');
  if (coverage.some((item) => item.sourceTruncated)) add('SOURCE_EXCERPT_TRUNCATED', 'medium', 'Extração de alguma fonte foi truncada.');
  if (maxQuote > 300) add('LONG_DIRECT_QUOTE', 'medium', `Citação direta com ${maxQuote} caracteres exige revisão de reprodução.`);
  if ((quality?.score ?? 0) < 75) add('QUALITY_LOW', 'high', 'Quality Score abaixo do mínimo.');
  else if ((quality?.score ?? 0) < 85) add('QUALITY_MEDIUM', 'medium', 'Quality Score exige revisão humana.');
  if ((quality?.coverage ?? 0) < 60) add('QUALITY_COVERAGE_LOW', 'medium', 'Cobertura diagnóstica insuficiente.');
  if (validation?.errors?.length) add('PUBLICATION_VALIDATION_ERRORS', 'high', 'Validação editorial contém erros.');
  const level = factors.some((item) => item.severity === 'high') ? 'high' : factors.length ? 'medium' : 'low';
  return {
    level,
    factors,
    sources: {total: sources.length, independentOrganizations: organizations.size},
    classifications,
    maxDirectQuoteChars: maxQuote,
    evidenceCoverage: coverage,
    quality: {score: quality?.score ?? null, coverage: quality?.coverage ?? null},
  };
}

export function publicationStats(repository, now = repository.now()) {
  const day = now.slice(0, 10);
  const records = repository.list().filter((record) => record.state === 'published' && record.receipt);
  const today = records.filter((record) => String(record.receipt.at || record.receipt.publishedAt || '').startsWith(day));
  const byCategory = {};
  for (const record of today) byCategory[record.input.article.category] = (byCategory[record.input.article.category] || 0) + 1;
  const latest = records.sort((left, right) => String(right.receipt.at).localeCompare(String(left.receipt.at)))[0] || null;
  return {
    publishedToday: today.length,
    byCategory,
    lastPublishedAt: latest?.receipt?.at || latest?.receipt?.publishedAt || null,
    consecutiveFailures: 0,
  };
}

export function evaluateControlledPublication({
  mode,
  risk,
  eligibility,
  editorialRecord,
  draft,
  config,
  now,
  stats,
  contentHash,
  reviewId,
}) {
  ensure(PUBLICATION_MODES.includes(mode), 'PUBLICATION_MODE', 'Modo de publicação inválido.');
  ensure(config?.schemaVersion === '1.0' && config.autonomousSimulationOnly === true, 'PUBLICATION_CONFIG', 'Política de publicação inválida.');
  const limits = config.limits;
  const humanApproval = editorialRecord?.state === 'approved'
    && editorialRecord.approval?.contentHash
    && editorialRecord.approval.factsReviewed === true
    && editorialRecord.approval.imageRightsReviewed === true;
  const blockers = [];
  const block = (code, message) => blockers.push({code, message});
  if (config.emergencyPause) block('EMERGENCY_PAUSE', 'Publicação suspensa por pausa emergencial.');
  if (risk.level === 'high') block('HIGH_EDITORIAL_RISK', 'Risco editorial alto exige intervenção humana.');
  if (stats.publishedToday >= limits.maxArticlesPerDay) block('DAILY_LIMIT', 'Limite diário de publicações atingido.');
  if ((stats.byCategory?.[draft.category] || 0) >= limits.maxPerCategoryPerDay) block('CATEGORY_LIMIT', 'Limite diário da categoria atingido.');
  if (stats.consecutiveFailures >= limits.maxConsecutiveFailures) block('FAILURE_CIRCUIT_BREAKER', 'Falhas sucessivas suspendem publicação.');
  if (stats.lastPublishedAt && Date.parse(now) - Date.parse(stats.lastPublishedAt) < limits.minIntervalMinutes * 60000) block('MIN_INTERVAL', 'Intervalo mínimo entre publicações não atingido.');
  const baseErrors = (eligibility?.errors || []).filter((item) => item.code !== 'HUMAN_APPROVAL_REQUIRED');
  if (baseErrors.length) {
    block('ELIGIBILITY_BLOCKED', 'Elegibilidade básica bloqueada.');
  }
  if (Number.isFinite(stats.contentAgeHours) && stats.contentAgeHours > limits.maxContentAgeHours) {
    block('CONTENT_STALE', 'Matéria excede a janela configurada de atualidade.');
  }
  if (stats.duplicate) {
    block('ELIGIBILITY_BLOCKED', 'Elegibilidade básica bloqueada.');
  }
  const riskNeedsHuman = risk.level !== 'low';
  let status;
  if (blockers.length) status = 'blocked';
  else if (mode === 'manual') status = humanApproval ? 'human-approved' : 'awaiting-human-approval';
  else if (mode === 'assisted') status = humanApproval ? 'ready-for-manual-publish' : 'queued-for-human-approval';
  else status = risk.level === 'low' ? 'simulation-eligible' : 'simulation-human-approval-required';
  return {
    decisionId: `publication-policy-${hash({contentHash, reviewId, mode, at: now, blockers}).slice(0, 20)}`,
    decisionType: 'policy-automated',
    mode,
    status,
    risk,
    blockers,
    limits: {...limits, ...stats},
    humanApproval: humanApproval ? {source: 'editorial-approval', at: editorialRecord.approval.at, reviewer: editorialRecord.approval.reviewer} : null,
    humanApprovalRequired: mode === 'manual' || riskNeedsHuman || config.autonomousSimulationOnly,
    publicationAllowed: false,
    publicationSimulationOnly: mode === 'autonomous-controlled' || config.autonomousSimulationOnly,
    contentHash,
    reviewId,
    approvedHashMatches: humanApproval ? editorialRecord.approval.contentHash === editorialRecord.validation?.contentHash : false,
    automaticApproval: false,
    automaticPublication: false,
  };
}
