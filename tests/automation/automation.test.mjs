import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {applyAssessment} from '../../src/radar/assessment.mjs';
import {hash, normalize} from '../../src/radar/common.mjs';
import {NewsroomRepository} from '../../src/newsroom/repository.mjs';
import {NewsroomEngine} from '../../src/newsroom/engine.mjs';
import {ReviewEngine} from '../../src/newsroom/review/engine.mjs';
import {evaluatePublicationEligibility} from '../../src/newsroom/publication-eligibility.mjs';
import {correctAttributedQuoteFromFinding, correctUnqualifiedRumorClaims} from '../../src/newsroom/claims.mjs';
import {Repository as EditorialRepository} from '../../src/editorial/repository.mjs';
import {transition} from '../../src/editorial/lifecycle.mjs';
import {migrateOperational, activateOperational} from '../../src/storage/operational-migration.mjs';
import {withOperationalLease} from '../../src/storage/operational.mjs';
import {createCheckpoint, selectSnapshot} from '../../src/storage/snapshots.mjs';
import {verifySnapshot} from '../../src/storage/integrity.mjs';
import {restoreSnapshot} from '../../src/storage/exporter.mjs';
import {AutomationRepository} from '../../src/automation/repository.mjs';
import {AutomationOrchestrator} from '../../src/automation/orchestrator.mjs';
import {dueSchedules} from '../../src/automation/scheduler.mjs';
import {runMigrations} from '../../src/storage/migrations.mjs';
import {openEncryptedDatabase, closeQuietly} from '../../src/storage/database.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const key = Buffer.alloc(32, 11);
const at = '2026-11-26T02:00:00.000Z';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd0065-automation-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const previousGroq = process.env.GROQ_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  process.env.GROQ_API_KEY = 'synthetic-test-only';
  process.env.GEMINI_API_KEY = 'synthetic-test-only';
  t.after(() => {
    if (previousGroq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousGroq;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGemini;
  });
  for (const name of ['package.json', 'config.json', 'content', 'public', 'storage/config.json', 'storage/migrations', 'automation/config.json', 'radar/config.json', 'radar/sources.json', 'newsroom/config.json', 'newsroom/prompts', 'newsroom/schemas', 'editorial/config.json']) {
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.cpSync(path.join(root, name), dest, {recursive: true});
  }
  fs.writeFileSync(path.join(dir, '.env'), `PULSO_STORAGE_KEY=${key.toString('base64url')}\n`);
  const automation = JSON.parse(fs.readFileSync(path.join(dir, 'automation/config.json'), 'utf8'));
  automation.schedules = [{id: 'selection', activity: 'selection', intervalMs: 7200000, enabled: true}];
  automation.ai.enabled = true;
  automation.ai.freeTierConfirmed = true;
  writeJson(path.join(dir, 'automation/config.json'), automation);
  const title = 'Synthetic automation benchmark launches update';
  const signal = {
    id: 'sig-' + hash(title).slice(0, 24),
    topic: title,
    normalizedTopic: normalize(title),
    provider: 'fixture-feed',
    providerType: 'rss',
    organization: 'fixture-org',
    region: 'US',
    language: 'en-US',
    weight: 1,
    suggestedCategory: 'ia',
    originalId: null,
    feedUrl: 'https://fixture.example/rss',
    url: 'https://fixture.example/story',
    feedPublishedAt: at,
    approximateTraffic: null,
    relatedTerms: [],
    relatedNews: [],
    collectedAt: at,
    observedAt: at,
    cached: false,
    cacheMode: 'live',
    metadata: {synthetic: true},
  };
  const topic = {
    schemaVersion: '1.0',
    id: 'pauta-' + hash(title + '|automation').slice(0, 24),
    topic: title,
    normalizedTopic: normalize(title),
    suggestedCategory: 'ia',
    relatedTerms: [],
    signals: [signal],
    sourceReferences: [{name: 'fixture-feed', url: signal.url, region: 'US'}],
    firstSeenAt: at,
    lastSeenAt: at,
    collectedAt: at,
    score: 50,
    scoreBreakdown: {coverage: 75},
    priority: 'baixa',
    status: 'new',
    classificationReason: 'fixture',
    duplicateReferences: [],
    researchQueries: [title],
    history: [{at, action: 'score', score: 50}],
  };
  const radarConfig = JSON.parse(fs.readFileSync(path.join(dir, 'radar/config.json'), 'utf8'));
  const articles = JSON.parse(fs.readFileSync(path.join(dir, 'content/articles.json'), 'utf8'));
  applyAssessment(topic, radarConfig, articles, Date.parse(at));
  topic.status = 'new';
  topic.statusDecision = {origin: 'none'};
  writeJson(path.join(dir, 'radar/data/state.json'), {schemaVersion: '1.0', topics: [topic], providers: {}, runs: []});
  const dossier = {
    schemaVersion: '1.0',
    topicId: topic.id,
    topic: topic.topic,
    category: 'ia',
    createdAt: at,
    centralEvent: topic.topic,
    insufficient: false,
    sources: [{id: 'fonte-fixture', organization: 'fixture-org', finalUrl: 'https://fixture.example/story', checkedAt: at, type: 'unclassified-manual', publishedAt: null, limitations: []}],
    evidence: [{
      id: 'evid-fixture',
      sourceId: 'fonte-fixture',
      excerpt: 'A synthetic organization announced a benchmark update in a controlled fixture.',
      hash: 'synthetic',
      classification: 'attributed',
      completeness: 'complete',
      roles: ['central-event'],
      checkedAt: at,
    }],
    conflicts: [],
    missing: [],
    errors: [],
  };
  writeJson(path.join(dir, 'newsroom/data/state.json'), {
    schemaVersion: '1.0',
    topics: {
      [topic.id]: {
        id: topic.id,
        topic: topic.topic,
        category: 'ia',
        status: 'ready-to-write',
        radarAssessmentHash: topic.assessmentHash,
        dossier,
        draft: null,
        verification: null,
        image: null,
        history: [],
      },
    },
    usage: [],
    researchCache: {},
  });
  const storageConfig = JSON.parse(fs.readFileSync(path.join(dir, 'storage/config.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  migrateOperational(dir, storageConfig, packageJson, key);
  activateOperational(dir, storageConfig, packageJson, key);
  return {dir, topic, dossier, storageConfig, packageJson};
}

const draft = () => ({
  insufficient: false,
  reason: '',
  title: 'Ferramenta sintética da automação para teste local',
  slug: 'ferramenta-sintetica-da-automacao-para-teste-local',
  summary: 'Uma organização sintética anunciou uma atualização de benchmark em ambiente controlado.',
  category: 'ia',
  tags: ['automação', 'fixture'],
  claimTaxonomyVersion: '1.1',
  titleEvidenceIds: ['evid-fixture'],
  summaryEvidenceIds: ['evid-fixture'],
  sections: [
    {title: 'Anúncio simulado', paragraphs: ['Uma organização sintética anunciou uma atualização de benchmark em ambiente controlado.']},
    {title: 'Limites', paragraphs: ['O conteúdo é uma fixture e não descreve um produto real.']},
  ],
  claims: [
    {section: 0, paragraph: 0, text: 'Uma organização sintética anunciou uma atualização de benchmark em ambiente controlado.', classification: 'confirmed', nature: 'documented-fact', attribution: '', evidenceIds: ['evid-fixture']},
    {section: 1, paragraph: 0, text: 'O conteúdo é uma fixture e não descreve um produto real.', classification: 'confirmed', nature: 'documented-fact', attribution: '', evidenceIds: ['evid-fixture']},
  ],
  imageSuggestion: null,
});

const compactDraft = () => ({
  insufficient: false,
  reason: '',
  title: draft().title,
  summary: draft().summary,
  tags: draft().tags,
  titleEvidence: ['e1'],
  summaryEvidence: ['e1'],
  sections: draft().sections,
  claims: draft().claims.map((claim) => ({s: claim.section, p: claim.paragraph, nature: claim.nature, attribution: claim.attribution, ev: ['e1']})),
  imageSuggestion: '',
});

const reviewFixture = () => ({
  schemaVersion: '1.0',
  result: 'pass',
  summary: 'Fixture revisada.',
  findings: [],
  claimAssessments: draft().claims.map((claim, index) => ({claimIndex: index, status: 'supported', reason: 'Sustentado pela fixture.', evidenceIds: claim.evidenceIds})),
  limitations: ['Amostra sintética; não certifica factualidade.'],
  humanReviewRequired: true,
});

function writeTransport() {
  return async () => new Response(JSON.stringify({
    choices: [{finish_reason: 'stop', message: {content: JSON.stringify(compactDraft())}}],
    usage: {prompt_tokens: 100, completion_tokens: 80, total_tokens: 180, completion_tokens_details: {reasoning_tokens: 10}},
  }), {status: 200, headers: {'x-request-id': 'automation-fixture'}});
}

function reviewTransport(value = reviewFixture()) {
  return async () => new Response(JSON.stringify({
    candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(value)}]}}],
    usageMetadata: {promptTokenCount: 50, candidatesTokenCount: 40, totalTokenCount: 90, thoughtsTokenCount: 5},
  }), {status: 200});
}

function makeOrchestrator(fx, overrides = {}) {
  let tick = 0;
  const now = overrides.now || (() => new Date(Date.parse('2026-11-26T02:00:00.000Z') + (++tick * 61000)).toISOString());
  const newsroomRepo = overrides.newsroomRepo || new NewsroomRepository(fx.dir, {now});
  const realNewsroom = overrides.newsroomEngine || new NewsroomEngine(newsroomRepo, overrides.newsroomDependencies || {});
  const newsroom = overrides.newsroom || {
    plan: () => ({selected: [{id: fx.topic.id}]}),
    show: realNewsroom.show.bind(realNewsroom),
    research: realNewsroom.research.bind(realNewsroom),
    write: realNewsroom.write.bind(realNewsroom),
    verify: realNewsroom.verify.bind(realNewsroom),
    prepareImage: realNewsroom.prepareImage.bind(realNewsroom),
    importDraft: realNewsroom.importDraft.bind(realNewsroom),
  };
  const reviewEngine = overrides.reviewEngine || new ReviewEngine(newsroomRepo, {dependencies: {geminiTransport: overrides.reviewTransport || reviewTransport()}});
  return new AutomationOrchestrator(fx.dir, {
    now,
    dependencies: {
      newsroomRepo,
      newsroom,
      reviewEngine,
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      writeTransport: overrides.writeTransport || writeTransport(),
      radarEngine: overrides.radarEngine || {fetch: async () => ({signals: 0, newTopics: 0, observedTopics: 0, uniqueTopics: 0})},
      backup: overrides.backup,
    },
  });
}

test('automation: scheduler persistente, pausa, resume e plano', async t => {
  const fx = fixture(t);
  const orchestrator = makeOrchestrator(fx);
  assert.equal(orchestrator.status().initialized, false);
  assert.equal(orchestrator.init().initialized, true);
  const before = orchestrator.repository.read();
  assert.equal(before.control.paused, true);
  assert.equal(orchestrator.plan().due.length, 0);
  orchestrator.resume();
  const plan = orchestrator.plan();
  assert.equal(plan.paused, false);
  assert.equal(plan.due.length, 1);
  assert.equal(plan.due[0].activity, 'selection');
  const restarted = makeOrchestrator(fx);
  assert.equal(restarted.status().schedules[0].activity, 'selection');
  restarted.pause('Pausa de teste');
  assert.equal(restarted.status().paused, true);
  await assert.rejects(() => restarted.runOnce({freeTierConfirmed: true}), {code: 'PAUSED'});
});

test('automation: pipeline completo com motores reais e IA mockada', async t => {
  const fx = fixture(t);
  const orchestrator = makeOrchestrator(fx);
  orchestrator.init();
  orchestrator.resume();
  const result = await orchestrator.runOnce({freeTierConfirmed: true});
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].status, 'completed', JSON.stringify(result.runs[0].error));
  const state = orchestrator.repository.read();
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].status, 'completed', JSON.stringify(state.jobs[0].error));
  assert.equal(state.jobs[0].stage, 'completed');
  assert(state.jobs[0].result.editorialId);
  assert.equal(state.jobs[0].result.imageStatus, 'ready-to-import');
  const editorial = new EditorialRepository(fx.dir).get(state.jobs[0].result.editorialId);
  assert.equal(editorial.state, 'draft');
  assert.equal(editorial.input.article.title, draft().title);
  assert.equal(fs.existsSync(path.join(fx.dir, 'public/noticias', draft().slug + '.html')), false);
  const eligibility = evaluatePublicationEligibility(orchestrator.newsroomRepo, fx.topic.id);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.status, 'awaiting-human-approval');
  assert.equal(eligibility.checks.deterministicValidation, true);
  assert.equal(eligibility.checks.semanticReview, true);
  assert.equal(eligibility.checks.editorialImport, true);
  assert.equal(eligibility.checks.approval, false);
  assert.equal(eligibility.automaticApproval, false);
  assert.equal(eligibility.automaticPublication, false);
  assert.equal(eligibility.checks.imageRights, true);
  assert(!eligibility.errors.some((item) => item.code === 'IMAGE_RIGHTS_REQUIRED'));
  assert(eligibility.errors.some((item) => item.code === 'HUMAN_APPROVAL_REQUIRED'));
});

test('automation: lease impede duas instâncias concorrentes', async t => {
  const fx = fixture(t);
  const repository = new AutomationRepository(fx.dir);
  repository.init();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = withOperationalLease(fx.dir, {id: 'automation-orchestrator', ttlMs: 60000}, async () => {
    await gate;
    return 'first';
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(() => withOperationalLease(fx.dir, {id: 'automation-orchestrator', ttlMs: 60000}, async () => 'second'), {code: 'LEASE_BUSY'});
  release();
  assert.equal(await first, 'first');
});

test('automation: lease renova fencing e bloqueia proprietário expirado', async t => {
  const fx = fixture(t);
  const repository = new AutomationRepository(fx.dir);
  repository.init();
  let expiredLease;
  await withOperationalLease(fx.dir, {
    id: 'automation-orchestrator',
    ttlMs: 80,
    autoRenew: false,
  }, async (lease) => {
    expiredLease = lease;
    await new Promise((resolve) => setTimeout(resolve, 120));
    await withOperationalLease(fx.dir, {
      id: 'automation-orchestrator',
      ttlMs: 5000,
      autoRenew: false,
    }, async (replacement) => {
      assert.notEqual(replacement.fencingToken, lease.fencingToken);
      await replacement.renew();
    });
    assert.throws(() => expiredLease.renew(), {code: 'LEASE_FENCED'});
    assert.throws(() => repository.save(repository.read(), {lease: expiredLease}), {code: 'LEASE_FENCED'});
  });
});

test('automation: agenda atrasada por mais de 24 horas é recuperada uma vez', async t => {
  const fx = fixture(t);
  const orchestrator = makeOrchestrator(fx);
  orchestrator.init();
  const state = orchestrator.repository.read();
  const schedule = state.schedules[0];
  schedule.nextRunAt = new Date(Date.parse(orchestrator.now()) - 24 * 60 * 60 * 1000).toISOString();
  orchestrator.repository.save(state);
  orchestrator.resume();
  const plan = dueSchedules(orchestrator.repository.read(), Date.parse(orchestrator.now()), orchestrator.config);
  assert.equal(plan.due.length, 1);
  assert.equal(plan.due[0].coalesced, true);
  assert(plan.due[0].missedIntervals >= 12);
  await orchestrator.runOnce({freeTierConfirmed: true});
  const recovered = orchestrator.repository.read();
  assert.equal(recovered.runs.length, 1);
  assert.equal(recovered.runs[0].status, 'completed');
  assert(recovered.events.some((event) => event.type === 'scheduler' && event.details?.missedIntervals >= 12));
  assert(Date.parse(recovered.schedules[0].nextRunAt) > Date.parse(orchestrator.now()));
});

test('automation: execução de radar não tenta projetar etapa sem job', async t => {
  const fx = fixture(t);
  const orchestrator = makeOrchestrator(fx, {
    radarEngine: {
      fetch: async () => ({id: 'radar-run-fixture', signals: 2, newTopics: 1, observedTopics: 2, uniqueTopics: 3}),
    },
  });
  orchestrator.init();
  const configured = orchestrator.repository.read();
  configured.schedules[0].activity = 'radar';
  configured.schedules[0].id = 'radar';
  orchestrator.repository.save(configured);
  orchestrator.resume();
  const result = await orchestrator.runOnce({freeTierConfirmed: true});
  assert.equal(result.runs[0].status, 'completed', JSON.stringify(result.runs[0].error));
  const persisted = orchestrator.repository.read();
  assert.equal(persisted.runs[0].radarRunId, 'radar-run-fixture');
  assert.equal(persisted.steps.length, 0);
  assert.equal(orchestrator.repository.metrics().automation.steps, 0);
});

test('automation: correção mecânica limitada não promove rumor sem atribuição explícita', () => {
  const value = draft();
  value.claims[0].classification = 'rumor';
  value.claims[0].nature = 'rumor';
  value.claims[0].text = 'A rede registra 150 membros e 64 relatórios oficiais.';
  value.sections[0].paragraphs[0] = value.claims[0].text;
  const dossier = {
    sources: [{id: 'source-primary', type: 'primary-organization'}],
    evidence: [{
      id: 'evid-fixture',
      sourceId: 'source-primary',
      excerpt: 'The network has 150 registered members and contributed to 64 official reports.',
    }],
  };
  const changes = correctUnqualifiedRumorClaims(value, dossier);
  assert.equal(changes.length, 0);
  assert.equal(value.claims[0].classification, 'rumor');
  assert.equal(value.claims[0].nature, 'rumor');

  const qualified = structuredClone(value);
  qualified.claims[0].classification = 'rumor';
  qualified.claims[0].nature = 'rumor';
  qualified.claims[0].text = 'Rumor não confirmado: a rede registra 150 membros.';
  assert.equal(correctUnqualifiedRumorClaims(qualified, dossier).length, 0);
});

test('automation: correção mecânica de atribuição usa citação literal da evidência', () => {
  const value = draft();
  value.claims[1].classification = 'attributed';
  value.claims[1].nature = 'attributed-statement';
  value.claims[1].attribution = 'the researcher';
  value.claims[1].text = 'A pesquisadora destaca a necessidade de mais olhos humanos e envolvimento de diferentes origens.';
  value.sections[1].paragraphs[0] = value.claims[1].text;
  const dossier = {
    evidence: [{
      id: 'evid-fixture',
      excerpt: '"We need more human minds, more people with their eyes on the sky and on the data, both literally and figuratively," said the researcher.',
    }],
  };
  const change = correctAttributedQuoteFromFinding(value, dossier, {
    findingId: 'finding-attribution',
    severity: 'major',
    category: 'attribution',
    field: 'body',
    sectionIndex: 1,
    paragraphIndex: 0,
    claimIndex: 1,
    evidenceIds: ['evid-fixture'],
  });
  assert.equal(change.claimIndex, 1);
  assert.match(value.claims[1].text, /^“We need more human minds/);
  assert.equal(value.sections[1].paragraphs[0], value.claims[1].text);
});

test('automation: journal editorial reconcilia commit SQL após interrupção', async t => {
  const fx = fixture(t);
  const orchestrator = makeOrchestrator(fx);
  orchestrator.init();
  orchestrator.resume();
  await orchestrator.runOnce({freeTierConfirmed: true});
  const state = orchestrator.repository.read();
  const editorialId = state.jobs[0].result.editorialId;
  const faulty = new EditorialRepository(fx.dir, {fault: (point) => {
    if (point === 'after-record-write') {
      const error = new Error('interrupção simulada após commit SQL');
      error.simulatedInterruption = true;
      throw error;
    }
  }});
  const current = faulty.get(editorialId);
  const validated = transition(current, 'validated', {action: 'validate', reason: 'fixture validation', at, patch: {validation: {valid: true, contentHash: 'fixture'}, approval: null}});
  assert.throws(() => faulty.withLock(() => faulty.transaction([
    {relative: `editorial/data/records/${editorialId}.json`, bytes: Buffer.from(JSON.stringify(validated))},
    {relative: 'public/automation-recovery.txt', bytes: Buffer.from('recovery')},
  ])), {simulatedInterruption: true});
  assert.equal(fs.existsSync(path.join(fx.dir, 'editorial/data/transaction.json')), true);
  const recovery = orchestrator.recover('Recuperação de teste do journal.');
  assert.equal(recovery.journal.action, 'reconciled-forward');
  assert.equal(new EditorialRepository(fx.dir).get(editorialId).state, 'validated');
  assert.equal(fs.readFileSync(path.join(fx.dir, 'public/automation-recovery.txt'), 'utf8'), 'recovery');
});

test('automation: orçamento insuficiente deixa job deferred sem chamada', async t => {
  const fx = fixture(t);
  const repo = new NewsroomRepository(fx.dir);
  await repo.withLock(async () => {
    const state = repo.read();
    state.usage.push({id: 'budget-fixture', topicId: 'pauta-externa', provider: 'groq', model: 'openai/gpt-oss-120b', at: new Date().toISOString(), status: 'complete', reservedTokens: 50000, chargedTokens: 50000, actualTokens: 50000});
    repo.save(state);
  });
  const orchestrator = makeOrchestrator(fx);
  orchestrator.init();
  orchestrator.resume();
  const result = await orchestrator.runOnce({freeTierConfirmed: true});
  assert.equal(orchestrator.repository.read().jobs[0].status, 'deferred', JSON.stringify(orchestrator.repository.read().jobs[0].error));
});

test('automation: falha de provedor e revisão bloqueante são preservadas', async t => {
  const fx = fixture(t);
  const failing = makeOrchestrator(fx, {writeTransport: async () => new Response('', {status: 500})});
  failing.init();
  failing.resume();
  const failed = await failing.runOnce({freeTierConfirmed: true});
  assert.equal(failing.repository.read().jobs[0].status, 'failed', JSON.stringify(failing.repository.read().jobs[0].error));

  const fx2 = fixture(t);
  const blocking = makeOrchestrator(fx2, {reviewTransport: reviewTransport({...reviewFixture(), result: 'changes-required', findings: [{findingId: 'f1', severity: 'major', category: 'factual', field: 'body', sectionIndex: 0, paragraphIndex: 0, claimIndex: 0, evidenceIds: ['evid-fixture'], message: 'Ajustar', justification: 'Fixture', suggestion: 'Ajustar'}]})});
  blocking.init();
  blocking.resume();
  const blocked = await blocking.runOnce({freeTierConfirmed: true});
  assert.equal(blocking.repository.read().jobs[0].status, 'blocked', JSON.stringify(blocking.repository.read().jobs[0].error));
  assert.equal(new EditorialRepository(fx2.dir).list().length, 0);
});

test('automation: checkpoint inclui estado da automação e restaura em diretório isolado', t => {
  const fx = fixture(t);
  const orchestrator = makeOrchestrator(fx);
  orchestrator.init();
  const checkpoint = createCheckpoint(fx.dir, fx.storageConfig, fx.packageJson, key);
  const selected = selectSnapshot(fx.dir, fx.storageConfig, checkpoint.snapshotId);
  const verified = verifySnapshot(selected.directory, key, fx.storageConfig);
  assert.equal(verified.authenticated, true);
  assert.equal(verified.metrics.counts.automationSchedules, 1);
  const target = path.join(fx.dir, 'automation-restored');
  const restored = restoreSnapshot({snapshotDir: selected.directory, key, config: fx.storageConfig, target});
  assert(restored.restoredFiles > 0);
  assert.equal(fs.existsSync(path.join(target, 'automation/data/state.json')), true);
  assert.equal(fs.existsSync(path.join(target, 'storage/data/operational.sqlcipher')), false);
});

test('automation: marcador ausente com banco existente bloqueia sem fallback JSON', t => {
  const fx = fixture(t);
  const marker = path.join(fx.dir, 'storage/data/operational.json');
  fs.unlinkSync(marker);
  const repository = new AutomationRepository(fx.dir);
  assert.throws(() => repository.init(), {code: 'BACKEND_UNAVAILABLE'});
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/operational.sqlcipher')), true);
  assert.equal(fs.existsSync(path.join(fx.dir, 'radar/data/state.json')), true);
});

test('automation: CLI status/plan/init retornam JSON e não publicam', t => {
  const fx = fixture(t);
  const cli = path.join(root, 'src/automation/cli.mjs');
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--json', '--root', fx.dir], {encoding: 'utf8', timeout: 20000, env: {...process.env, PULSO_STORAGE_KEY: key.toString('base64url')}});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(run('init').result.initialized, true);
  assert.equal(run('status').result.backend, 'sqlite');
  assert.equal(run('plan').result.paused, true);
  assert.equal(run('metrics').result.automation.initialized, true);
});
