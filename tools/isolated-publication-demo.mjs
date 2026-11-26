import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Repository,atomicWrite,jsonBytes} from '../src/editorial/repository.mjs';
import {EditorialEngine} from '../src/editorial/engine.mjs';
import {evaluateControlledPublication,classifyEditorialRisk} from '../src/editorial/publication-policy.mjs';
import {hash} from '../src/editorial/schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'reports', 'evidence', 'latest', 'isolated-publication-demo');
if (fs.existsSync(destination)) throw new Error('Destino da demonstração já existe; preserve a evidência anterior.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-policy-demo-'));
try {
  for (const relative of ['src', 'public', 'content', 'editorial', 'package.json', 'config.json']) {
    fs.cpSync(path.join(root, relative), path.join(temp, relative), {
      recursive: true,
      filter: (source) => !source.startsWith(path.join(root, 'editorial', 'data')),
    });
  }
  const configFile = path.join(temp, 'editorial/config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.allowSyntheticPublication = true;
  config.publicationPolicy.emergencyPause = false;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const now = '2026-11-26T18:00:00.000Z';
  const repository = new Repository(temp, {now: () => now});
  const engine = new EditorialEngine(repository, {allowPolicyAuthorization: true});
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'editorial/fixtures/valid-create.json'), 'utf8'));
  const incoming = `editorial/data/incoming/${fixture.id}-policy-demo.json`;
  atomicWrite(repository.file(incoming), jsonBytes(fixture));
  engine.import(incoming);
  const validation = engine.validate(fixture.id).result;
  const editorial = repository.get(fixture.id);
  const draft = {category: 'tecnologia', claims: [{text: 'Atualização sintética documentada.', classification: 'confirmed', nature: 'documented-fact', attribution: '', evidenceIds: ['evid-demo']}]};
  const dossier = {sources: [{organization: 'ORG-A', type: 'primary-organization'}, {organization: 'ORG-B', type: 'independent'}], evidence: [{id: 'evid-demo', excerpt: 'Fixture sintética documentada.', completeness: 'complete'}]};
  const eligibility = {checks: {deterministicValidation: true, semanticReview: true, evidence: true, imageRights: true, editorialImport: true, editorialValidation: true, approval: false, integrity: true, journal: true}, errors: [{code: 'HUMAN_APPROVAL_REQUIRED'}], warnings: []};
  const review = {id: 'review-policy-demo', result: 'pass', severityCounts: {critical: 0, major: 0, minor: 0, informational: 0}, claimStatusCounts: {supported: 1}, evidenceCoverage: [{evidenceId: 'evid-demo', coverage: 'complete', sourceTruncated: false}]};
  const quality = {score: 92, coverage: 85};
  const risk = classifyEditorialRisk({draft, dossier, review, eligibility, quality, validation});
  const decision = evaluateControlledPublication({
    mode: 'autonomous-controlled',
    risk,
    eligibility,
    editorialRecord: editorial,
    draft,
    config: config.publicationPolicy,
    now,
    stats: {publishedToday: 0, byCategory: {}, lastPublishedAt: null, consecutiveFailures: 0, contentAgeHours: 2, duplicate: false},
    contentHash: hash({fixture: fixture.id, review: review.id}),
    reviewId: review.id,
  });
  const contextHash = hash({contentHash: validation.contentHash, reviewHash: decision.contentHash, policy: config.publicationPolicy, evidence: dossier.evidence, imageRights: true});
  const authorization = engine.authorizePolicy(fixture.id, {
    decision,
    contextHash,
    expiresAt: '2026-11-26T19:00:00.000Z',
  });
  const first = engine.publish(fixture.id, {policyContextHash: contextHash});
  const second = engine.publish(fixture.id, {policyContextHash: contextHash});
  fs.mkdirSync(destination, {recursive: true});
  fs.cpSync(path.join(temp, 'public'), path.join(destination, 'site'), {recursive: true});
  fs.writeFileSync(path.join(destination, 'publication-result.json'), JSON.stringify({
    synthetic: true,
    decision,
    authorization: {
      id: authorization.policyAuthorization.id,
      origin: authorization.policyAuthorization.origin,
      contentHash: authorization.policyAuthorization.contentHash,
      contextHash: authorization.policyAuthorization.contextHash,
      riskLevel: authorization.policyAuthorization.riskLevel,
      isolated: authorization.policyAuthorization.isolated,
    },
    first,
    idempotentSecondRun: second,
    humanApproval: authorization.approval,
    publicationPerformedIn: 'temporary isolated directory',
    rootPublicModified: false,
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    decisionStatus: decision.status,
    risk: risk.level,
    approval: authorization.approval,
    authorizationOrigin: authorization.policyAuthorization.origin,
    receiptAuthorizationType: first.receipt.authorizationType,
    idempotent: second.idempotent,
    destination: path.relative(root, destination).split(path.sep).join('/'),
  }));
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
