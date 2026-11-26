import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  loadProjectConfig,
  checkpointPlan,
  createCheckpoint,
  listSnapshots,
  selectSnapshot,
  withStorageLock,
  recoverStorageLock,
} from '../../src/storage/snapshots.mjs';
import {
  openEncryptedDatabase,
  closeQuietly,
  integrityCheck,
  queryMetrics,
} from '../../src/storage/database.mjs';
import {runMigrations, discoverMigrations} from '../../src/storage/migrations.mjs';
import {collectSourceFiles, importSnapshot} from '../../src/storage/importer.mjs';
import {verifySnapshot, withManifestSignature, readSnapshotManifest} from '../../src/storage/integrity.mjs';
import {restoreSnapshot} from '../../src/storage/exporter.mjs';
import {parseStorageKey, writeStorageKey, loadStorageKey} from '../../src/storage/env.mjs';
import {safeRelativePath, sha256} from '../../src/storage/common.mjs';
import {migrationPlan, migrateOperational, compareOperational, activateOperational, migrationStatus, upgradePlan, upgradeOperational} from '../../src/storage/operational-migration.mjs';
import {verifyOperationalDatabase, writeOperationalState} from '../../src/storage/operational.mjs';
import {NewsroomRepository} from '../../src/newsroom/repository.mjs';
import {RadarRepository} from '../../src/radar/repository.mjs';
import {Repository as EditorialRepository} from '../../src/editorial/repository.mjs';
import {transition} from '../../src/editorial/lifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const key = Buffer.alloc(32, 5);
const at = '2026-11-25T20:00:00.000Z';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd0061-storage-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  writeJson(path.join(dir, 'package.json'), {name: 'pulso-digital', version: '1.4.2'});
  fs.mkdirSync(path.join(dir, 'storage'), {recursive: true});
  fs.copyFileSync(path.join(root, 'storage/config.json'), path.join(dir, 'storage/config.json'));
  fs.cpSync(path.join(root, 'storage/migrations'), path.join(dir, 'storage/migrations'), {recursive: true});
  for (const name of ['config.json', 'radar/config.json', 'radar/sources.json', 'newsroom/config.json', 'editorial/config.json']) {
    writeJson(path.join(dir, name), {schemaVersion: '1.0'});
  }
  writeJson(path.join(dir, 'radar/data/state.json'), {
    schemaVersion: '1.0',
    topics: [{
      id: 'pauta-fixture',
      schemaVersion: '1.0',
      topic: 'Fixture storage topic',
      normalizedTopic: 'fixture storage topic',
      suggestedCategory: 'ia',
      status: 'queued',
      priority: 'media',
      score: 72.5,
      firstSeenAt: at,
      lastSeenAt: at,
      collectedAt: at,
      assessmentHash: 'a'.repeat(64),
      candidateType: 'event',
      relatedTerms: [],
      signals: [{id: 'sig-fixture', provider: 'fixture', organization: 'fixture-org', region: 'BR', language: 'pt-BR', url: 'https://fixture.example/story', observedAt: at, weight: 1}],
      sourceReferences: [],
      duplicateReferences: [],
      researchQueries: [],
      history: [{at, action: 'signal'}, {at, action: 'score', score: 72.5}],
      classificationReason: 'fixture',
      scoreBreakdown: {coverage: 75},
    }],
    providers: {fixture: {}},
    runs: [{id: 'run-fixture', at, status: 'complete'}],
    reclassifications: [],
  });
  writeJson(path.join(dir, 'newsroom/data/state.json'), {
    schemaVersion: '1.0',
    topics: {
      'pauta-fixture': {
        id: 'pauta-fixture',
        topic: 'Fixture storage topic',
        category: 'ia',
        status: 'imported',
        editorialId: 'newsroom-pauta-fixture',
        synthetic: false,
        dossier: {
          schemaVersion: '1.0',
          topicId: 'pauta-fixture',
          topic: 'Fixture storage topic',
          category: 'ia',
          createdAt: at,
          centralEvent: 'Fixture storage topic',
          insufficient: false,
          sources: [{id: 'fonte-fixture', organization: 'fixture', finalUrl: 'https://fixture.example/story', checkedAt: at, contentHash: 'b'.repeat(64)}],
          evidence: [{id: 'evid-fixture', sourceId: 'fonte-fixture', excerpt: 'Fixture evidence excerpt.', hash: 'c'.repeat(64), classification: 'attributed', checkedAt: at}],
          errors: [],
        },
        draft: {
          insufficient: false,
          reason: '',
          title: 'Fixture draft',
          slug: 'fixture-draft',
          summary: 'Fixture summary.',
          category: 'ia',
          tags: ['fixture'],
          sections: [{title: 'Section one', paragraphs: ['Fixture paragraph one.']}, {title: 'Section two', paragraphs: ['Fixture paragraph two.']}],
          claims: [
            {section: 0, paragraph: 0, text: 'Fixture paragraph one.', classification: 'opinion', evidenceIds: ['evid-fixture']},
            {section: 1, paragraph: 0, text: 'Fixture paragraph two.', classification: 'opinion', evidenceIds: ['evid-fixture']},
          ],
          imageSuggestion: 'Fixture image',
        },
        verification: {valid: true, errors: [], warnings: [{code: 'HUMAN_FACT_REVIEW'}]},
        image: {
          status: 'ready-to-import',
          reason: null,
          manifest: {credit: 'Fixture', sourceUrl: 'https://fixture.example/image', license: 'Fixture license', licenseUrl: 'https://fixture.example/license', alt: 'Fixture', caption: 'Fixture', checkedAt: '2026-11-25'},
        },
        history: [{at, action: 'research'}, {at, action: 'import'}],
        reviews: [{
          id: 'review-fixture',
          status: 'completed',
          provider: 'gemini',
          model: 'gemini-fixture',
          promptVersion: 'review-v1',
          schemaVersion: '1.0',
          taskId: 'fixture-task',
          contentHash: 'fixture-stale-hash',
          configurationHash: 'fixture-config',
          modelResult: 'pass',
          result: 'changes-required',
          humanReviewRequired: true,
          findings: [{findingId: 'fixture-finding', severity: 'major', category: 'factual', field: 'body', sectionIndex: 0, paragraphIndex: 0, claimIndex: 0, evidenceIds: ['evid-fixture'], message: 'Fixture finding'}],
          claimAssessments: [{claimIndex: 0, status: 'unsupported', reason: 'Fixture', evidenceIds: ['evid-fixture']}],
          limitations: ['Fixture'],
          severityCounts: {critical: 0, major: 1, minor: 0, informational: 0},
          usage: {totalTokens: 42, chargedTokens: 42},
          createdAt: at,
        }],
      },
    },
    usage: [{
      id: 'call-fixture',
      topicId: 'pauta-fixture',
      provider: 'fixture',
      model: 'fixture-model',
      at,
      finishedAt: at,
      status: 'complete',
      reservedTokens: 1500,
      chargedTokens: 1234,
      actualTokens: 1234,
      inputTokens: 500,
      outputTokens: 734,
      reasoningTokens: 100,
      durationMs: 321,
    }],
    researchCache: {},
  });
  writeJson(path.join(dir, 'newsroom/data/images/pauta-fixture/manifest.json'), {kind: 'illustration', credit: 'Fixture'});
  fs.writeFileSync(path.join(dir, 'newsroom/data/images/pauta-fixture/main.webp'), Buffer.from('RIFFfixtureWEBPdata'));
  writeJson(path.join(dir, 'editorial/data/records/newsroom-pauta-fixture.json'), {
    recordVersion: '1.0',
    input: {schemaVersion: '1.0', id: 'newsroom-pauta-fixture', synthetic: false, article: {title: 'Fixture draft', slug: 'fixture-draft', category: 'ia'}},
    createdAt: at,
    validation: null,
    approval: null,
    receipt: null,
    state: 'draft',
    history: [
      {sequence: 1, at, from: null, to: 'pending', action: 'import', actor: 'fixture', reason: 'fixture', previousHash: null, snapshot: {}},
      {sequence: 2, at, from: 'pending', to: 'draft', action: 'draft', actor: 'fixture', reason: 'fixture', previousHash: 'd'.repeat(64), snapshot: {}},
    ],
  });
  fs.mkdirSync(path.join(dir, 'editorial/data/incoming/newsroom-pauta-fixture'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'editorial/data/incoming/newsroom-pauta-fixture/main.webp'), Buffer.from('RIFFincomingWEBP'));
  writeJson(path.join(dir, 'content/articles.json'), [{slug: 'fixture-draft', title: 'Fixture draft', category: 'ia', date: '2026-11-25'}]);
  writeJson(path.join(dir, 'content/images.json'), {fixture: {source: 'fixture', alt: 'Fixture'}});
  writeJson(path.join(dir, 'radar/data/note.json'), {secretMarker: 'THIS_SECRET_MUST_BE_ENCRYPTED'});
  fs.writeFileSync(path.join(dir, 'radar/data/credentials.key'), 'MUST_NOT_BE_IMPORTED');
  fs.writeFileSync(path.join(dir, '.env'), 'GROQ_API_KEY=fixture\nGEMINI_API_KEY=fixture\n');
  fs.mkdirSync(path.join(dir, 'public'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'public/index.html'), '<h1>fixture</h1>');
  const {config, packageJson} = loadProjectConfig(dir);
  return {dir, config, packageJson};
}

function openTestDatabase(file) {
  const db = openEncryptedDatabase(file, key);
  runMigrations(db, path.join(root, 'storage/migrations'), {now: () => at});
  return db;
}

function makeCheckpoint(t, fx, now = at) {
  return createCheckpoint(fx.dir, fx.config, fx.packageJson, key, {now});
}

function prepareOperationalFixture(t) {
  const fx = fixture(t);
  for (const name of ['radar/config.json', 'radar/sources.json', 'newsroom/config.json', 'editorial/config.json']) {
    fs.copyFileSync(path.join(root, name), path.join(fx.dir, name));
  }
  const radarState = JSON.parse(fs.readFileSync(path.join(fx.dir, 'radar/data/state.json'), 'utf8'));
  radarState.topics[0].id = 'pauta-' + 'a'.repeat(24);
  writeJson(path.join(fx.dir, 'radar/data/state.json'), radarState);
  const input = {
    schemaVersion: '1.0',
    id: 'newsroom-pauta-fixture',
    operation: 'create',
    targetSlug: null,
    synthetic: false,
    article: {
      title: 'Fixture draft',
      slug: 'fixture-draft',
      summary: 'Fixture summary.',
      category: 'ia',
      tags: ['fixture'],
      sections: [{title: 'Section one', paragraphs: ['Fixture paragraph.']}],
      language: 'pt-BR',
      editorial: {name: 'Pulso Digital', role: 'Edição institucional provisória'},
      sources: [],
      claims: [],
      image: null,
    },
  };
  const pending = transition(null, 'pending', {
    action: 'import',
    reason: 'fixture import',
    at,
    patch: {recordVersion: '1.0', input, createdAt: at, validation: null, approval: null, receipt: null},
  });
  const record = transition(pending, 'draft', {action: 'draft', reason: 'fixture draft', at});
  writeJson(path.join(fx.dir, 'editorial/data/records/newsroom-pauta-fixture.json'), record);
  const previousKey = process.env.PULSO_STORAGE_KEY;
  process.env.PULSO_STORAGE_KEY = key.toString('base64url');
  t.after(() => {
    if (previousKey === undefined) delete process.env.PULSO_STORAGE_KEY;
    else process.env.PULSO_STORAGE_KEY = previousKey;
  });
  return fx;
}

test('storage: migrations inicializam, repetem sem efeito e detectam alteração', t => {
  const fx = fixture(t);
  const dbFile = path.join(fx.dir, 'storage/data/test.sqlcipher');
  const first = openTestDatabase(dbFile);
  assert.equal(first.pragma('user_version', {simple: true}), 5);
  assert.equal(first.prepare('SELECT count(*) AS n FROM sqlite_master WHERE type = ?').get('table').n >= 10, true);
  const second = runMigrations(first, path.join(root, 'storage/migrations'), {now: () => at});
  assert.equal(second.applied.length, 0);
  closeQuietly(first);
  fs.appendFileSync(path.join(fx.dir, 'storage/migrations/002_indices_views.sql'), '\n-- changed\n');
  const reopened = openEncryptedDatabase(dbFile, key);
  assert.throws(() => runMigrations(reopened, path.join(fx.dir, 'storage/migrations')), {code: 'MIGRATION_CONFLICT'});
  closeQuietly(reopened);
});

test('storage: SQLCipher não deixa cabeçalho SQLite e rejeita chave incorreta', t => {
  const fx = fixture(t);
  const dbFile = path.join(fx.dir, 'storage/data/test.sqlcipher');
  const db = openTestDatabase(dbFile);
  db.prepare('INSERT INTO storage_meta (key, value) VALUES (?, ?)').run('fixture', 'plain-value');
  assert.deepEqual(integrityCheck(db).integrity, ['ok']);
  closeQuietly(db);
  const bytes = fs.readFileSync(dbFile);
  assert.notEqual(bytes.subarray(0, 16).toString('utf8'), 'SQLite format 3\u0000');
  assert.throws(() => openEncryptedDatabase(dbFile, Buffer.alloc(32, 6), {readonly: true}), {code: 'KEY_MISMATCH'});
  const reopened = openEncryptedDatabase(dbFile, key, {readonly: true});
  assert.equal(reopened.prepare('SELECT value FROM storage_meta WHERE key = ?').get('fixture').value, 'plain-value');
  closeQuietly(reopened);
});

test('storage: coleta exclui .env, credenciais e arquivos públicos', t => {
  const fx = fixture(t);
  const collection = collectSourceFiles(fx.dir, fx.config);
  const paths = collection.files.map((file) => file.path);
  assert(paths.includes('radar/data/state.json'));
  assert(paths.includes('newsroom/data/images/pauta-fixture/main.webp'));
  assert(!paths.some((item) => item.endsWith('.env')));
  assert(!paths.some((item) => item.endsWith('credentials.key')));
  assert(!paths.some((item) => item.startsWith('public/')));
});

test('storage: conteúdo semelhante a credencial é bloqueado mesmo sem nome suspeito', t => {
  const fx = fixture(t);
  writeJson(path.join(fx.dir, 'radar/data/notes.json'), {value: 'gsk_' + 'A'.repeat(32)});
  assert.throws(() => collectSourceFiles(fx.dir, fx.config), {code: 'SECRET_EXCLUDED'});
});

test('storage: dry-run não cria diretório persistente', t => {
  const fx = fixture(t);
  const plan = checkpointPlan(fx.dir, fx.config);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.persistentChanges, false);
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data')), false);
});

test('storage: checkpoint criptografado preserva métricas e imagens', t => {
  const fx = fixture(t);
  const created = makeCheckpoint(t, fx);
  assert.equal(created.imported, 'imported');
  const selected = selectSnapshot(fx.dir, fx.config);
  const verified = verifySnapshot(selected.directory, key, fx.config);
  assert.equal(verified.authenticated, true);
  assert.deepEqual(verified.integrity.integrity, ['ok']);
  assert.equal(verified.metrics.counts.radarTopics, 1);
  assert.equal(verified.metrics.counts.radarSignals, 1);
  assert.equal(verified.metrics.counts.radarHistory, 2);
  assert.equal(verified.metrics.counts.drafts, 1);
  assert.equal(verified.metrics.counts.newsroomHistory, 2);
  assert.equal(verified.metrics.counts.editorialRecords, 1);
  assert.equal(verified.metrics.counts.editorialEvents, 2);
  assert.equal(verified.metrics.counts.reviews, 1);
  assert.equal(verified.metrics.reviews.stale, 1);
  assert.equal(verified.metrics.reviews.severity.major, 1);
  assert.equal(verified.metrics.ai.chargedTokens, 1234);
  assert.equal(verified.metrics.storage.imageAssets, 2);
  assert.equal(selected.manifest.encryption.plainSqliteHeader, false);
  const snapshotBytes = fs.readFileSync(path.join(selected.directory, 'snapshot.sqlcipher'));
  assert.equal(snapshotBytes.includes(Buffer.from('THIS_SECRET_MUST_BE_ENCRYPTED')), false);
});

test('storage: importer é idempotente por fingerprint', t => {
  const fx = fixture(t);
  const dbFile = path.join(fx.dir, 'storage/data/import.sqlcipher');
  const db = openTestDatabase(dbFile);
  const collection = collectSourceFiles(fx.dir, fx.config);
  const first = importSnapshot(db, collection, {snapshotId: 'snapshot-1', createdAt: at, appVersion: '1.4.2'});
  const second = importSnapshot(db, collection, {snapshotId: 'snapshot-1', createdAt: at, appVersion: '1.4.2'});
  assert.equal(first.alreadyImported, false);
  assert.equal(second.alreadyImported, true);
  assert.deepEqual(first.counts, second.counts);
  assert.equal(queryMetrics(db).counts.radarTopics, 1);
  closeQuietly(db);
});

test('storage: chave errada e banco/manifesto adulterados são rejeitados', t => {
  const fx = fixture(t);
  makeCheckpoint(t, fx);
  const selected = selectSnapshot(fx.dir, fx.config);
  assert.throws(() => verifySnapshot(selected.directory, Buffer.alloc(32, 8), fx.config), {code: 'KEY_MISMATCH'});
  const tamperedDatabase = path.join(fx.dir, 'storage/data/snapshots/tampered-db');
  fs.cpSync(selected.directory, tamperedDatabase, {recursive: true});
  const dbFile = path.join(tamperedDatabase, 'snapshot.sqlcipher');
  const bytes = fs.readFileSync(dbFile);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(dbFile, bytes);
  assert.throws(() => verifySnapshot(tamperedDatabase, key, fx.config), {code: 'TAMPERED'});
  const tamperedManifest = path.join(fx.dir, 'storage/data/snapshots/tampered-manifest');
  fs.cpSync(selected.directory, tamperedManifest, {recursive: true});
  const manifest = readSnapshotManifest(tamperedManifest);
  manifest.database.bytes += 1;
  writeJson(path.join(tamperedManifest, 'manifest.json'), manifest);
  assert.throws(() => verifySnapshot(tamperedManifest, key, fx.config), {code: 'TAMPERED'});
});

test('storage: restauração isolada preserva bytes e não sobrescreve destino', t => {
  const fx = fixture(t);
  makeCheckpoint(t, fx);
  const selected = selectSnapshot(fx.dir, fx.config);
  const target = path.join(fx.dir, 'restored');
  const dry = restoreSnapshot({snapshotDir: selected.directory, key, config: fx.config, target, dryRun: true});
  assert.equal(dry.dryRun, true);
  assert.equal(fs.existsSync(target), false);
  const restored = restoreSnapshot({snapshotDir: selected.directory, key, config: fx.config, target});
  assert.equal(restored.dryRun, false);
  assert.equal(fs.existsSync(target), true);
  const collection = collectSourceFiles(fx.dir, fx.config);
  for (const file of collection.files) {
    const targetFile = path.join(target, ...file.path.split('/'));
    assert.equal(fs.readFileSync(targetFile).equals(file.content), true);
    assert.equal(sha256(fs.readFileSync(targetFile)), file.sha256);
  }
  assert.equal(fs.existsSync(path.join(target, '.env')), false);
  assert.equal(fs.existsSync(path.join(target, 'snapshot.sqlcipher')), false);
  assert.throws(() => restoreSnapshot({snapshotDir: selected.directory, key, config: fx.config, target}), {code: 'TARGET_EXISTS'});
});

test('storage: locks impedem concorrência e recuperação preserva processo vivo', t => {
  const fx = fixture(t);
  withStorageLock(fx.dir, fx.config, () => {
    assert.throws(() => makeCheckpoint(t, fx, '2026-11-25T20:01:00.000Z'), {code: 'LOCK_BUSY'});
    assert.throws(() => recoverStorageLock(fx.dir, fx.config, 'teste de lock ativo'), {code: 'LOCK_BUSY'});
  });
  fs.mkdirSync(path.join(fx.dir, 'storage/data/lock'), {recursive: true});
  writeJson(path.join(fx.dir, 'storage/data/lock/owner.json'), {pid: 9999999, host: os.hostname(), token: 'dead', at});
  assert.equal(recoverStorageLock(fx.dir, fx.config, 'proprietário inexistente').recovered, true);
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/lock')), false);
});

test('storage: lock de fonte ativa bloqueia checkpoint', t => {
  const fx = fixture(t);
  fs.mkdirSync(path.join(fx.dir, 'radar/data/lock'), {recursive: true});
  assert.throws(() => checkpointPlan(fx.dir, fx.config), {code: 'SOURCE_BUSY'});
});

test('storage: chave local é gerada sem expor valor e preserva outras variáveis', t => {
  const fx = fixture(t);
  fs.writeFileSync(path.join(fx.dir, '.env'), 'GROQ_API_KEY=fixture-value\nPULSO_STORAGE_KEY=\n');
  const generated = parseStorageKey('A'.repeat(43)).toString('base64url');
  const written = writeStorageKey(fx.dir, generated);
  assert.equal(written.created, true);
  const text = fs.readFileSync(path.join(fx.dir, '.env'), 'utf8');
  assert.match(text, /GROQ_API_KEY=fixture-value/);
  assert.match(text, /PULSO_STORAGE_KEY=/);
  assert.equal(text.includes(generated), true);
  assert.equal(JSON.stringify(written).includes(generated), false);
  const loaded = loadStorageKey(fx.dir, {required: false});
  assert(Buffer.isBuffer(loaded.key));
  assert.equal(loaded.key.length, 32);
  assert.equal(loaded.source, '.env');
});

test('storage: CLI dry-run e status retornam JSON estruturado', t => {
  const fx = fixture(t);
  const cli = path.join(root, 'src/storage/cli.mjs');
  const status = spawnSync(process.execPath, [cli, 'status', '--json', '--root', fx.dir], {encoding: 'utf8', timeout: 10000});
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).ok, true);
  const dry = spawnSync(process.execPath, [cli, 'checkpoint', '--dry-run', '--json', '--root', fx.dir], {encoding: 'utf8', timeout: 10000});
  assert.equal(dry.status, 0, dry.stderr);
  const dryJson = JSON.parse(dry.stdout);
  assert.equal(dryJson.result.persistentChanges, false);
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/snapshots')), false);
});

test('storage: migrations descobertas são versionadas e não beta', () => {
  const migrations = discoverMigrations(path.join(root, 'storage/migrations'));
  assert.equal(migrations.length, 5);
  assert.deepEqual(migrations.map((migration) => migration.version), [1, 2, 3, 4, 5]);
});

test('storage: banco privado não entra em public e storage/data é ignorado', t => {
  const fx = fixture(t);
  makeCheckpoint(t, fx);
  const publicFiles = fs.readdirSync(path.join(fx.dir, 'public'), {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  assert.equal(publicFiles.some((name) => /\.(sqlcipher|sqlite|db)$/i.test(name)), false);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^storage\/data\/$/m);
});

test('storage: caminhos de restauração rejeitam traversal e absolutos', () => {
  assert.equal(safeRelativePath('radar/data/state.json'), 'radar/data/state.json');
  assert.throws(() => safeRelativePath('../outside'), {code: 'PATH_INVALID'});
  assert.throws(() => safeRelativePath('/absolute'), {code: 'PATH_INVALID'});
  assert.throws(() => safeRelativePath('C:/absolute'), {code: 'PATH_INVALID'});
  assert.throws(() => safeRelativePath('radar//state.json'), {code: 'PATH_INVALID'});
});

test('storage: migração, comparação e ativação SQLite preservam JSON e dados', async t => {
  const fx = prepareOperationalFixture(t);
  const radarBefore = fs.readFileSync(path.join(fx.dir, 'radar/data/state.json'));
  const newsroomBefore = fs.readFileSync(path.join(fx.dir, 'newsroom/data/state.json'));
  const dry = migrationPlan(fx.dir, fx.config);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.alreadyActive, false);
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/operational.json')), false);
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/operational.sqlcipher')), false);

  const migrated = migrateOperational(fx.dir, fx.config, fx.packageJson, key);
  assert.equal(migrated.status, 'pending');
  assert.equal(fs.existsSync(path.join(fx.dir, migrated.pendingDatabase)), true);
  assert.equal(migrated.comparison.equal, true);
  assert.equal(migrated.comparison.differences.length, 0);
  assert.equal(migrationStatus(fx.dir, fx.config, key).active, false);

  const activeCompare = compareOperational(fx.dir, fx.config, key, {pending: true});
  assert.equal(activeCompare.equal, true);
  assert.equal(activeCompare.expected.counts.radarTopics, 1);
  assert.equal(activeCompare.expected.counts.editorialRecords, 1);
  assert.equal(activeCompare.expected.counts.assets, 3);

  const activation = activateOperational(fx.dir, fx.config, fx.packageJson, key);
  assert.equal(activation.backend, 'sqlite');
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/operational.sqlcipher')), true);
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/operational.json')), true);
  assert.equal(migrationStatus(fx.dir, fx.config, key).active, true);
  assert.equal(migrationStatus(fx.dir, fx.config, key).receipt.status, 'active');
  assert.deepEqual(fs.readFileSync(path.join(fx.dir, 'radar/data/state.json')), radarBefore);
  assert.deepEqual(fs.readFileSync(path.join(fx.dir, 'newsroom/data/state.json')), newsroomBefore);

  const newsroomRepo = new NewsroomRepository(fx.dir);
  const initialNewsroom = newsroomRepo.read();
  assert.equal(Object.keys(initialNewsroom.topics).length, 1);
  await newsroomRepo.withLock(async () => {
    const state = newsroomRepo.read();
    state.researchCache['https://fixture.example/new'] = {checkedAt: at, title: 'fixture new'};
    newsroomRepo.save(state);
  });
  assert.equal(newsroomRepo.read().researchCache['https://fixture.example/new'].title, 'fixture new');
  assert.deepEqual(fs.readFileSync(path.join(fx.dir, 'newsroom/data/state.json')), newsroomBefore);
  assert.throws(
    () => writeOperationalState(fx.dir, 'newsroom', initialNewsroom, {expectedHash: 'stale-hash'}),
    {code: 'OPERATIONAL_CONFLICT'},
  );

  const radarRepo = new RadarRepository(fx.dir);
  assert.equal(radarRepo.read().topics.length, 1);
  await radarRepo.withLock(async () => {
    const state = radarRepo.read();
    state.runs.push({id: 'run-after-activation', at, status: 'complete'});
    radarRepo.save(state);
  });
  assert.equal(radarRepo.read().runs.length, 2);
  assert.deepEqual(fs.readFileSync(path.join(fx.dir, 'radar/data/state.json')), radarBefore);

  const editorialRepo = new EditorialRepository(fx.dir);
  assert.equal(editorialRepo.list().length, 1);
  assert.equal(editorialRepo.exists('newsroom-pauta-fixture'), true);
  const editorialRecord = editorialRepo.get('newsroom-pauta-fixture');
  assert.equal(editorialRecord.state, 'draft');
  editorialRepo.withLock(() => editorialRepo.save(editorialRecord));
  const legacyRecordBefore = fs.readFileSync(path.join(fx.dir, 'editorial/data/records/newsroom-pauta-fixture.json'));
  editorialRepo.withLock(() => {
    const validated = transition(editorialRepo.get('newsroom-pauta-fixture'), 'validated', {
      action: 'validate',
      reason: 'fixture validation',
      at,
      patch: {validation: {valid: true, contentHash: 'fixture'}, approval: null},
    });
    const result = editorialRepo.transaction([
      {relative: 'editorial/data/records/newsroom-pauta-fixture.json', bytes: Buffer.from(JSON.stringify(validated))},
      {relative: 'public/fixture-operational.txt', bytes: Buffer.from('operational public fixture\n')},
    ]);
    assert(result.files.includes('editorial/data/records/newsroom-pauta-fixture.json'));
    assert(result.files.includes('public/fixture-operational.txt'));
  });
  assert.equal(editorialRepo.get('newsroom-pauta-fixture').state, 'validated');
  assert.deepEqual(fs.readFileSync(path.join(fx.dir, 'editorial/data/records/newsroom-pauta-fixture.json')), legacyRecordBefore);
  assert.equal(fs.readFileSync(path.join(fx.dir, 'public/fixture-operational.txt'), 'utf8'), 'operational public fixture\n');

  const checkpoint = createCheckpoint(fx.dir, fx.config, fx.packageJson, key);
  const selected = selectSnapshot(fx.dir, fx.config);
  const verified = verifySnapshot(selected.directory, key, fx.config);
  assert.equal(verified.authenticated, true);
  assert.equal(verified.metrics.counts.radarTopics, 1);
  assert.equal(verified.metrics.counts.drafts, 1);
  assert.equal(verified.metrics.counts.editorialRecords, 1);
  assert(verified.metrics.ai.chargedTokens >= 1234);
  assert.equal(selected.manifest.migrations.total, 5);

  const target = path.join(fx.dir, 'operational-restored');
  const restored = restoreSnapshot({snapshotDir: selected.directory, key, config: fx.config, target});
  assert.equal(restored.restoredFiles, verified.manifest.content.files);
  assert.equal(fs.existsSync(path.join(target, 'radar/data/state.json')), true);
  assert.equal(fs.existsSync(path.join(target, 'newsroom/data/state.json')), true);
  assert.equal(fs.existsSync(path.join(target, 'editorial/data/records/newsroom-pauta-fixture.json')), true);
  assert.equal(fs.existsSync(path.join(target, 'newsroom/data/images/pauta-fixture/main.webp')), true);
  assert.equal(fs.existsSync(path.join(target, 'storage/data/operational.sqlcipher')), false);
  assert.throws(() => verifyOperationalDatabase(fx.dir, {key: Buffer.alloc(32, 9)}), {code: 'KEY_MISMATCH'});
});

test('storage: ativação bloqueia fonte alterada após a migração', t => {
  const fx = prepareOperationalFixture(t);
  const migrated = migrateOperational(fx.dir, fx.config, fx.packageJson, key);
  assert.equal(migrated.status, 'pending');
  const radar = JSON.parse(fs.readFileSync(path.join(fx.dir, 'radar/data/state.json'), 'utf8'));
  radar.topics[0].status = 'dismissed';
  writeJson(path.join(fx.dir, 'radar/data/state.json'), radar);
  assert.throws(
    () => activateOperational(fx.dir, fx.config, fx.packageJson, key),
    error => ['MIGRATION_DIVERGENCE', 'SOURCE_CHANGED'].includes(error.code),
  );
  assert.equal(fs.existsSync(path.join(fx.dir, 'storage/data/operational.json')), false);
});

test('storage: CLI operacional expõe migrate, compare, activate, status e metrics', t => {
  const fx = prepareOperationalFixture(t);
  const cli = path.join(root, 'src/storage/cli.mjs');
  const env = {...process.env, PULSO_STORAGE_KEY: key.toString('base64url')};
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--json', '--root', fx.dir], {encoding: 'utf8', timeout: 20000, env});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const dry = run('migrate', '--dry-run');
  assert.equal(dry.result.dryRun, true);
  assert.equal(dry.result.alreadyActive, false);
  const migrated = run('migrate');
  assert.equal(migrated.result.status, 'pending');
  const compared = run('compare');
  assert.equal(compared.result.equal, true);
  const activated = run('activate');
  assert.equal(activated.result.backend, 'sqlite');
  assert(activated.result.postMigrationCheckpoint.snapshotId);
  const status = run('status');
  assert.equal(status.result.backend, 'sqlite');
  assert.equal(status.result.operational.active, true);
  const metrics = run('metrics');
  assert.equal(metrics.result.backend, 'sqlite');
  assert.equal(metrics.result.counts.radarTopics, 1);
  assert.equal(metrics.result.counts.editorialRecords, 1);
});

test('storage: upgrade reconhece schema operacional atual', t => {
  const fx = prepareOperationalFixture(t);
  migrateOperational(fx.dir, fx.config, fx.packageJson, key);
  activateOperational(fx.dir, fx.config, fx.packageJson, key);
  const plan = upgradePlan(fx.dir);
  assert.equal(plan.backend, 'sqlite');
  assert.equal(plan.currentSchema, 5);
  assert.equal(plan.targetSchema, 5);
  assert.equal(plan.needsUpgrade, false);
  const result = upgradeOperational(fx.dir, fx.config, fx.packageJson, key);
  assert.equal(result.alreadyCurrent, true);
});
