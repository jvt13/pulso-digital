import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEditorialRisk,
  evaluateControlledPublication,
} from '../../src/editorial/publication-policy.mjs';

const now = '2026-11-26T16:00:00.000Z';
const config = {
  schemaVersion: '1.0',
  mode: 'manual',
  autonomousSimulationOnly: true,
  emergencyPause: false,
  limits: {
    maxArticlesPerDay: 3,
    minIntervalMinutes: 60,
    maxPerCategoryPerDay: 1,
    maxContentAgeHours: 168,
    maxConsecutiveFailures: 3,
  },
};

function draft(overrides = {}) {
  return {
    category: 'tecnologia',
    claims: [{
      text: 'A empresa publicou a atualização documentada.',
      classification: 'confirmed',
      nature: 'documented-fact',
      evidenceIds: ['evid-1'],
      attribution: '',
    }],
    ...overrides,
  };
}

function eligibility(overrides = {}) {
  return {
    checks: {
      deterministicValidation: true,
      semanticReview: true,
      evidence: true,
      imageRights: true,
      editorialImport: true,
      editorialValidation: true,
      approval: false,
      integrity: true,
      journal: true,
    },
    errors: [{code: 'HUMAN_APPROVAL_REQUIRED', message: 'Aprovação humana obrigatória.'}],
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    id: 'review-fixture',
    result: 'pass',
    severityCounts: {critical: 0, major: 0, minor: 0, informational: 0},
    claimStatusCounts: {supported: 1, 'partially-supported': 0, unsupported: 0, contradicted: 0, ambiguous: 0, 'insufficient-evidence': 0},
    evidenceCoverage: [{evidenceId: 'evid-1', coverage: 'complete', sourceTruncated: false}],
    ...overrides,
  };
}

function evaluate({mode = 'manual', riskDraft = draft(), sources = 2, reviewValue = review(), eligibilityValue = eligibility(), stats = {}, editorial = {state: 'validated', approval: null}} = {}) {
  const dossier = {
    sources: Array.from({length: sources}, (_, index) => ({organization: `org-${index}`, type: index ? 'independent' : 'primary-organization'})),
    evidence: [{id: 'evid-1', excerpt: 'Evidência documentada.', completeness: 'complete'}],
  };
  const quality = {score: 90, coverage: 85};
  const risk = classifyEditorialRisk({
    draft: riskDraft,
    dossier,
    review: reviewValue,
    eligibility: eligibilityValue,
    quality,
    validation: {errors: [], warnings: [{code: 'HUMAN_REVIEW_REQUIRED'}]},
  });
  return evaluateControlledPublication({
    mode,
    risk,
    eligibility: eligibilityValue,
    editorialRecord: editorial,
    draft: riskDraft,
    config,
    now,
    stats: {publishedToday: 0, byCategory: {}, lastPublishedAt: null, consecutiveFailures: 0, contentAgeHours: 24, duplicate: false, ...stats},
    contentHash: 'a'.repeat(64),
    reviewId: reviewValue.id,
  });
}

test('publication policy: manual exige aprovação explícita e nunca publica automaticamente', () => {
  const result = evaluate({mode: 'manual'});
  assert.equal(result.status, 'awaiting-human-approval');
  assert.equal(result.humanApprovalRequired, true);
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.automaticApproval, false);
});

test('publication policy: assisted enfileira para aprovação sem publicar', () => {
  const result = evaluate({mode: 'assisted'});
  assert(['queued-for-human-approval', 'simulation-human-approval-required'].includes(result.status) || result.status === 'blocked');
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.decisionType, 'policy-automated');
});

test('publication policy: autônomo é apenas simulação e exige risco baixo', () => {
  const low = evaluate({mode: 'autonomous-controlled'});
  assert.equal(low.risk.level, 'low');
  assert.equal(low.status, 'simulation-eligible');
  assert.equal(low.publicationSimulationOnly, true);
  assert.equal(low.publicationAllowed, false);
});

test('publication policy: fonte única e citação longa elevam o risco', () => {
  const riskDraft = draft({claims: [{
    text: `“${'Trecho longo '.repeat(40)}”`,
    classification: 'attributed',
    nature: 'attributed-statement',
    attribution: 'ORG',
    evidenceIds: ['evid-1'],
  }]});
  const result = evaluate({riskDraft, sources: 1});
  assert.equal(result.risk.level, 'medium');
  assert(result.risk.factors.some((item) => item.code === 'SINGLE_SOURCE'));
  assert(result.risk.factors.some((item) => item.code === 'LONG_DIRECT_QUOTE'));
});

test('publication policy: rumor ou revisão desatualizada bloqueiam todos os modos', () => {
  const rumor = draft({claims: [{
    text: 'Rumor não confirmado sobre um produto.',
    classification: 'rumor',
    nature: 'rumor',
    evidenceIds: ['evid-1'],
    attribution: '',
  }]});
  assert.equal(evaluate({riskDraft: rumor}).risk.level, 'high');
  const stale = evaluate({reviewValue: review({result: 'changes-required'}), eligibilityValue: eligibility({checks: {...eligibility().checks, semanticReview: false}, errors: [{code: 'SEMANTIC_REVIEW_REQUIRED'}]})});
  assert.equal(stale.status, 'blocked');
});

test('publication policy: direitos de imagem pendentes bloqueiam', () => {
  const result = evaluate({eligibilityValue: eligibility({checks: {...eligibility().checks, imageRights: false}, errors: [{code: 'IMAGE_RIGHTS_REQUIRED'}, {code: 'HUMAN_APPROVAL_REQUIRED'}]})});
  assert.equal(result.risk.level, 'high');
  assert.equal(result.status, 'blocked');
});

test('publication policy: limites diário, categoria, intervalo e falhas bloqueiam', () => {
  assert(evaluate({stats: {publishedToday: 3}}).blockers.some((item) => item.code === 'DAILY_LIMIT'));
  assert(evaluate({stats: {byCategory: {tecnologia: 1}}}).blockers.some((item) => item.code === 'CATEGORY_LIMIT'));
  assert(evaluate({stats: {lastPublishedAt: '2026-11-26T15:30:00.000Z'}}).blockers.some((item) => item.code === 'MIN_INTERVAL'));
  assert(evaluate({stats: {consecutiveFailures: 3}}).blockers.some((item) => item.code === 'FAILURE_CIRCUIT_BREAKER'));
});

test('publication policy: pausa, atualidade, duplicidade e integridade bloqueiam', () => {
  assert(evaluate({stats: {contentAgeHours: 200}}).blockers.some((item) => item.code === 'CONTENT_STALE'));
  assert(evaluate({stats: {duplicate: true}}).blockers.some((item) => item.code === 'ELIGIBILITY_BLOCKED'));
  const integrityFailure = evaluate({eligibilityValue: eligibility({checks: {...eligibility().checks, integrity: false}, errors: [{code: 'EDITORIAL_INTEGRITY'}]})});
  assert.equal(integrityFailure.status, 'blocked');
  assert(integrityFailure.risk.factors.some((item) => item.code === 'INTEGRITY_BLOCKED'));
  const paused = {...config, emergencyPause: true};
  const risk = classifyEditorialRisk({draft: draft(), dossier: {sources: [{organization: 'a'}, {organization: 'b'}], evidence: []}, review: review(), eligibility: eligibility(), quality: {score: 90, coverage: 85}, validation: {errors: [], warnings: []}});
  const decision = evaluateControlledPublication({mode: 'assisted', risk, eligibility: eligibility(), editorialRecord: {state: 'validated'}, draft: draft(), config: paused, now, stats: {publishedToday: 0, byCategory: {}, lastPublishedAt: null, consecutiveFailures: 0, contentAgeHours: 1, duplicate: false}, contentHash: 'b'.repeat(64), reviewId: 'review-fixture'});
  assert(decision.blockers.some((item) => item.code === 'EMERGENCY_PAUSE'));
});

test('publication policy: decisão é determinística e não representa aprovação humana', () => {
  const first = evaluate({mode: 'assisted'});
  const second = evaluate({mode: 'assisted'});
  assert.equal(first.decisionId, second.decisionId);
  assert.equal(first.humanApproval, null);
  assert.equal(first.automaticApproval, false);
});
