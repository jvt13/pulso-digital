import fs from 'node:fs';
import path from 'node:path';
import {check, canonicalJson, mediaTypeFor, safeRelativePath, sha256, toPosix} from './common.mjs';
import {queryMetrics, withTransaction} from './database.mjs';
import {reviewContentFingerprint} from '../newsroom/review/hash.mjs';

const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.svg']);
const CONFIG_NAMES = new Set(['config.json', 'sources.json', 'package.json']);
const CREDENTIAL_PATTERN = /(?:gsk_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|PULSO_STORAGE_KEY\s*=\s*[A-Za-z0-9_+/=-]{20,})/;

function categoryFor(relative) {
  if (CONFIG_NAMES.has(path.posix.basename(relative))) return 'configuration';
  if (relative.startsWith('radar/data/')) return 'radar';
  if (relative.startsWith('newsroom/data/images/')) return 'image';
  if (relative.startsWith('newsroom/data/')) return 'newsroom';
  if (relative.startsWith('editorial/data/')) return 'editorial';
  if (relative.startsWith('content/')) return 'publication';
  return 'metadata';
}

function excluded(relative, name, config) {
  const lowerName = name.toLowerCase();
  if (lowerName === '.env' || lowerName.startsWith('.env.')) return true;
  if (config.sources.excludeNames.includes(name) || config.sources.excludeNames.includes(relative)) return true;
  return config.sources.excludeExtensions.some((extension) => lowerName.endsWith(extension));
}

function assertSourceIdle(root, config) {
  const active = config.sources.sourceLockPaths.filter((relative) => fs.existsSync(path.join(root, relative)));
  check(active.length === 0, 'SOURCE_BUSY', `Há operação ativa nos dados de origem: ${active.join(', ')}.`);
}

function stableRead(root, absolute, relative, config) {
  const before = fs.lstatSync(absolute);
  check(before.isFile() && !before.isSymbolicLink(), 'SOURCE_INVALID', `Origem não é arquivo regular: ${relative}.`);
  check(before.size <= config.sources.maxFileBytes, 'SOURCE_LIMIT', `Arquivo acima do limite: ${relative}.`);
  const content = fs.readFileSync(absolute);
  check(!CREDENTIAL_PATTERN.test(content.toString('utf8')), 'SECRET_EXCLUDED', `Conteúdo semelhante a credencial bloqueado: ${relative}.`);
  const after = fs.lstatSync(absolute);
  check(after.isFile() && !after.isSymbolicLink() && after.size === before.size && after.mtimeMs === before.mtimeMs,
    'SOURCE_CHANGED', `Arquivo mudou durante a leitura: ${relative}.`);
  return {
    path: relative,
    absolute,
    category: categoryFor(relative),
    bytes: content.length,
    sha256: sha256(content),
    modifiedAt: after.mtime.toISOString(),
    content,
    root,
  };
}

export function collectSourceFiles(root, config) {
  const projectRoot = path.resolve(root);
  assertSourceIdle(projectRoot, config);
  for (const required of config.sources.requiredFiles) {
    check(fs.existsSync(path.join(projectRoot, required)), 'SOURCE_REQUIRED', `Arquivo obrigatório ausente: ${required}.`);
  }
  const collected = new Map();
  function addFile(absolute) {
    const relative = safeRelativePath(toPosix(path.relative(projectRoot, absolute)));
    if (collected.has(relative)) return;
    const name = path.basename(absolute);
    if (excluded(relative, name, config)) return;
    collected.set(relative, stableRead(projectRoot, absolute, relative, config));
    check(collected.size <= config.sources.maxFiles, 'SOURCE_LIMIT', 'Quantidade de arquivos acima do limite.');
  }
  function walk(absolute) {
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    check(!stat.isSymbolicLink(), 'SOURCE_INVALID', `Link simbólico não permitido: ${absolute}.`);
    if (stat.isDirectory()) {
      const name = path.basename(absolute);
      if (config.sources.excludeNames.includes(name)) return;
      for (const child of fs.readdirSync(absolute).sort()) walk(path.join(absolute, child));
      return;
    }
    if (stat.isFile()) addFile(absolute);
  }
  for (const relative of config.sources.directories) walk(path.join(projectRoot, relative));
  for (const relative of config.sources.files) {
    const absolute = path.join(projectRoot, relative);
    if (fs.existsSync(absolute)) addFile(absolute);
  }
  const files = [...collected.values()].sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  check(totalBytes <= config.sources.maxTotalBytes, 'SOURCE_LIMIT', 'Conjunto de origem acima do limite total.');
  const fingerprint = sha256(canonicalJson(files.map((file) => ({path: file.path, bytes: file.bytes, sha256: file.sha256}))));
  assertSourceIdle(projectRoot, config);
  return {root: projectRoot, files, totalBytes, fingerprint};
}

function parseJson(source, name) {
  if (!source) return null;
  try {
    return JSON.parse(source.content.toString('utf8'));
  } catch {
    throw Object.assign(new Error(`JSON inválido: ${name}.`), {code: 'SOURCE_JSON'});
  }
}

function sourceMap(collection) {
  return new Map(collection.files.map((file) => [file.path, file]));
}

function insertSourceFiles(db, files) {
  const statement = db.prepare(`INSERT INTO source_files (path, category, bytes, sha256, modified_at, content)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const file of files) statement.run(file.path, file.category, file.bytes, file.sha256, file.modifiedAt, file.content);
}

function importConfigs(db, files) {
  const statement = db.prepare('INSERT INTO configs (path, category, canonical_json) VALUES (?, ?, ?)');
  for (const file of files.filter((item) => item.category === 'configuration')) {
    statement.run(file.path, file.category, file.content.toString('utf8'));
  }
}

function importRadar(db, state) {
  if (!state) return;
  for (const topic of state.topics || []) {
    db.prepare(`INSERT INTO radar_topics
      (id, topic, category, status, priority, score, first_seen_at, last_seen_at, collected_at, assessment_hash, candidate_type, canonical_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      topic.id,
      topic.topic,
      topic.suggestedCategory || null,
      topic.status || 'unknown',
      topic.priority || null,
      Number.isFinite(topic.score) ? topic.score : null,
      topic.firstSeenAt || null,
      topic.lastSeenAt || null,
      topic.collectedAt || null,
      topic.assessmentHash || null,
      topic.candidateType || null,
      canonicalJson(topic),
    );
    for (const signal of topic.signals || []) {
      db.prepare(`INSERT OR REPLACE INTO radar_signals
        (topic_id, signal_id, provider, organization, region, language, url, feed_published_at, observed_at, weight, canonical_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        topic.id,
        signal.id || `${topic.id}-${signal.observedAt || signal.collectedAt || 'signal'}`,
        signal.provider || null,
        signal.organization || null,
        signal.region || null,
        signal.language || null,
        signal.url || null,
        signal.feedPublishedAt || null,
        signal.observedAt || signal.collectedAt || null,
        Number.isFinite(signal.weight) ? signal.weight : null,
        canonicalJson(signal),
      );
    }
    (topic.history || []).forEach((event, index) => {
      db.prepare('INSERT INTO radar_history (topic_id, sequence, at, action, canonical_json) VALUES (?, ?, ?, ?, ?)')
        .run(topic.id, index + 1, event.at || null, event.action || null, canonicalJson(event));
    });
  }
  (state.runs || []).forEach((run, index) => {
    db.prepare('INSERT INTO radar_runs (run_id, at, status, canonical_json) VALUES (?, ?, ?, ?)')
      .run(run.id || run.runId || `run-${index + 1}`, run.at || run.startedAt || null, run.status || null, canonicalJson(run));
  });
}

function importNewsroom(db, state) {
  if (!state) return;
  for (const [url, entry] of Object.entries(state.researchCache || {})) {
    if (url.startsWith('__')) continue;
    db.prepare('INSERT INTO research_cache (url, title, checked_at, content_hash, canonical_json) VALUES (?, ?, ?, ?, ?)')
      .run(url, entry.title || null, entry.checkedAt || null, entry.contentHash || null, canonicalJson(entry));
  }
  for (const [topicId, record] of Object.entries(state.topics || {})) {
    if (record.dossier) {
      const dossier = record.dossier;
      db.prepare(`INSERT INTO dossiers
        (topic_id, schema_version, category, created_at, insufficient, central_event, canonical_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        topicId,
        dossier.schemaVersion || null,
        dossier.category || record.category || null,
        dossier.createdAt || null,
        dossier.insufficient ? 1 : 0,
        dossier.centralEvent || null,
        canonicalJson(dossier),
      );
      for (const source of dossier.sources || []) {
        db.prepare(`INSERT INTO dossier_sources
          (source_id, topic_id, organization, original_url, final_url, title, published_at, checked_at, content_hash, canonical_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          source.id,
          topicId,
          source.organization || null,
          source.originalUrl || null,
          source.finalUrl || null,
          source.title || null,
          source.publishedAt || null,
          source.checkedAt || null,
          source.contentHash || null,
          canonicalJson(source),
        );
      }
      for (const item of dossier.evidence || []) {
        db.prepare(`INSERT INTO evidence
          (evidence_id, topic_id, source_id, classification, checked_at, excerpt_hash, canonical_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          item.id,
          topicId,
          item.sourceId || null,
          item.classification || null,
          item.checkedAt || null,
          item.hash || null,
          canonicalJson(item),
        );
      }
      for (const error of dossier.errors || []) {
        db.prepare(`INSERT INTO operational_errors (source, entity_type, entity_id, code, message, at, canonical_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run('newsroom-dossier', 'topic', topicId, error.code || null, error.message || null, null, canonicalJson(error));
      }
    }
    if (record.draft) {
      const draft = record.draft;
      db.prepare(`INSERT INTO drafts
        (topic_id, editorial_id, status, title, slug, category, synthetic, verification_json, image_suggestion, canonical_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        topicId,
        record.editorialId || null,
        record.status || 'unknown',
        draft.title || null,
        draft.slug || null,
        draft.category || record.category || null,
        record.synthetic ? 1 : 0,
        record.verification ? canonicalJson(record.verification) : null,
        draft.imageSuggestion || null,
        canonicalJson(draft),
      );
      (draft.sections || []).forEach((section, index) => {
        db.prepare('INSERT INTO draft_sections (topic_id, section_index, title, paragraph_count, canonical_json) VALUES (?, ?, ?, ?, ?)')
          .run(topicId, index, section.title || null, (section.paragraphs || []).length, canonicalJson(section));
      });
      (draft.claims || []).forEach((claim, index) => {
        db.prepare(`INSERT INTO draft_claims
          (topic_id, claim_index, section_index, paragraph_index, classification, canonical_json)
          VALUES (?, ?, ?, ?, ?, ?)`).run(
          topicId,
          index,
          claim.section ?? null,
          claim.paragraph ?? null,
          claim.classification || null,
          canonicalJson(claim),
        );
      });
    }
    (record.history || []).forEach((event, index) => {
      db.prepare('INSERT INTO newsroom_history (topic_id, sequence, at, action, canonical_json) VALUES (?, ?, ?, ?, ?)')
        .run(topicId, index + 1, event.at || null, event.action || null, canonicalJson(event));
    });
    const image = record.image || {status: 'image-pending', reason: 'Sem manifesto', manifest: null};
    const manifest = image.manifest || {};
    db.prepare(`INSERT INTO images
      (topic_id, status, reason, credit, source_url, license, license_url, checked_at, alt, caption, canonical_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      topicId,
      image.status || 'image-pending',
      image.reason || null,
      manifest.credit || null,
      manifest.sourceUrl || null,
      manifest.license || null,
      manifest.licenseUrl || null,
      manifest.checkedAt || null,
      manifest.alt || null,
      manifest.caption || null,
      canonicalJson({topicId, image: record.image || null}),
    );
  }
  for (const entry of state.usage || []) {
    db.prepare(`INSERT INTO ai_calls
      (attempt_id, topic_id, provider, model, at, finished_at, status, error_code, reserved_tokens, charged_tokens,
       actual_tokens, input_tokens, output_tokens, reasoning_tokens, duration_ms, request_id, rate_limits_json, error_json, canonical_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      entry.id,
      entry.topicId || null,
      entry.provider || null,
      entry.model || null,
      entry.at || null,
      entry.finishedAt || null,
      entry.status || 'unknown',
      entry.errorCode || null,
      entry.reservedTokens || 0,
      entry.chargedTokens ?? entry.reservedTokens ?? 0,
      entry.actualTokens ?? null,
      entry.inputTokens ?? null,
      entry.outputTokens ?? null,
      entry.reasoningTokens ?? null,
      entry.durationMs ?? null,
      entry.requestId || null,
      entry.rateLimits ? canonicalJson(entry.rateLimits) : null,
      entry.errorDetails ? canonicalJson(entry.errorDetails) : null,
      canonicalJson(entry),
    );
    if (entry.status !== 'complete') {
      db.prepare(`INSERT INTO operational_errors (source, entity_type, entity_id, code, message, at, canonical_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        'newsroom-ai',
        'ai-call',
        entry.id,
        entry.errorCode || null,
        entry.errorDetails?.message || null,
        entry.at || null,
        canonicalJson(entry),
      );
    }
  }
}

function importEditorial(db, files) {
  const records = files.filter((file) => /^editorial\/data\/records\/[^/]+\.json$/.test(file.path));
  for (const file of records) {
    const record = parseJson(file, file.path);
    const article = record.input?.article || {};
    db.prepare(`INSERT INTO editorial_records
      (id, record_version, state, title, slug, category, synthetic, created_at, approval_state, canonical_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.input?.id || path.posix.basename(file.path, '.json'),
      record.recordVersion || null,
      record.state || 'unknown',
      article.title || null,
      article.slug || null,
      article.category || null,
      article.synthetic || record.input?.synthetic ? 1 : 0,
      record.createdAt || null,
      record.approval?.state || record.approval?.status || null,
      canonicalJson(record),
    );
    (record.history || []).forEach((event, index) => {
      db.prepare(`INSERT INTO editorial_events
        (record_id, sequence, at, action, from_state, to_state, actor, canonical_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        record.input?.id || path.posix.basename(file.path, '.json'),
        event.sequence || index + 1,
        event.at || null,
        event.action || null,
        event.from || null,
        event.to || null,
        event.actor || null,
        canonicalJson(event),
      );
    });
  }
}

function importPublications(db, articles, images) {
  if (Array.isArray(articles)) {
    for (const article of articles) {
      db.prepare(`INSERT INTO publications (slug, title, category, published_at, updated_at, canonical_json)
        VALUES (?, ?, ?, ?, ?, ?)`).run(
        article.slug,
        article.title,
        article.category || null,
        article.date || article.publishedAt || null,
        article.updatedAt || null,
        canonicalJson(article),
      );
    }
  }
  if (images && typeof images === 'object') {
    for (const [key, image] of Object.entries(images)) {
      db.prepare('INSERT INTO publication_images (image_key, source, alt, canonical_json) VALUES (?, ?, ?, ?)')
        .run(key, image.source || image.src || null, image.alt || null, canonicalJson(image));
    }
  }
}

function importReviews(db, state) {
  const statement=db.prepare(`INSERT INTO editorial_reviews
    (id, topic_id, sample_id, status, provider, model, prompt_version, schema_version, task_id,
     content_hash, configuration_hash, model_result, effective_result, human_review_required,
     findings_count, critical_count, major_count, minor_count, informational_count,
     findings_json, assessments_json, limitations_json, comparison_json, usage_json, error_json, created_at, stale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insert=(review,topicId,currentHash)=>{
    const severityCounts=review.severityCounts||{};
    statement.run(
      review.id,
      topicId,
      review.sampleId||null,
      review.status||'unknown',
      review.provider||null,
      review.model||null,
      review.promptVersion||null,
      review.schemaVersion||null,
      review.taskId||null,
      review.contentHash,
      review.configurationHash,
      review.modelResult||null,
      review.result||null,
      review.humanReviewRequired===false?0:1,
      review.findings?.length||0,
      severityCounts.critical||0,
      severityCounts.major||0,
      severityCounts.minor||0,
      severityCounts.informational||0,
      canonicalJson(review.findings||[]),
      canonicalJson(review.claimAssessments||[]),
      canonicalJson(review.limitations||[]),
      review.comparison?canonicalJson(review.comparison):null,
      review.usage?canonicalJson(review.usage):null,
      review.error?canonicalJson(review.error):null,
      review.createdAt||new Date().toISOString(),
      topicId&&currentHash&&review.contentHash!==currentHash?1:0,
    );
  };
  for(const [topicId,record] of Object.entries(state.topics||{})){
    const currentHash=record.draft&&record.dossier?reviewContentFingerprint(record,record.dossier):null;
    for(const review of record.reviews||[])insert(review,topicId,currentHash);
  }
  for(const review of state.reviewSamples||[])insert(review,null,null);
}

function importImageAssets(db, files) {
  const statement = db.prepare(`INSERT INTO image_assets
    (path, topic_id, scope, name, bytes, sha256, media_type, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const file of files) {
    const extension = path.posix.extname(file.path).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) continue;
    let scope = null;
    let topicId = null;
    if (file.path.startsWith('newsroom/data/images/')) {
      const parts = file.path.split('/');
      scope = 'newsroom-image';
      topicId = parts[3] || null;
    } else if (file.path.startsWith('editorial/data/incoming/')) {
      const parts = file.path.split('/');
      scope = 'editorial-incoming';
      topicId = parts[3] || null;
    }
    if (!scope) continue;
    statement.run(
      file.path,
      topicId,
      scope,
      path.posix.basename(file.path),
      file.bytes,
      file.sha256,
      mediaTypeFor(file.path),
      null,
      null,
    );
  }
}

export function importSnapshot(db, collection, {
  snapshotId,
  createdAt = new Date().toISOString(),
  appVersion = 'unknown',
  gitCommit = null,
  host = null,
  pid = process.pid,
} = {}) {
  check(snapshotId, 'SNAPSHOT_ID', 'Identificador do snapshot obrigatório.');
  const prior = db.prepare('SELECT status, counts_json FROM import_runs WHERE fingerprint = ?').get(collection.fingerprint);
  if (prior?.status === 'completed') {
    return {alreadyImported: true, counts: JSON.parse(prior.counts_json)};
  }
  check(!prior, 'IMPORT_IN_PROGRESS', 'Importação anterior incompleta; reconstrua o snapshot.');
  const result = withTransaction(db, () => {
    const startedAt = new Date().toISOString();
    db.prepare('INSERT INTO import_runs (fingerprint, snapshot_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run(collection.fingerprint, snapshotId, 'importing', startedAt);
    const meta = db.prepare('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries({
      format_version: '1.0',
      snapshot_id: snapshotId,
      created_at: createdAt,
      source_fingerprint: collection.fingerprint,
      app_version: appVersion,
      git_commit: gitCommit || '',
      cipher: 'sqlcipher',
      cipher_legacy: '4',
    })) meta.run(key, value);
    insertSourceFiles(db, collection.files);
    importConfigs(db, collection.files);
    const byPath = sourceMap(collection);
    importRadar(db, parseJson(byPath.get('radar/data/state.json'), 'radar/data/state.json'));
    importNewsroom(db, parseJson(byPath.get('newsroom/data/state.json'), 'newsroom/data/state.json'));
    importEditorial(db, collection.files);
    importPublications(
      db,
      parseJson(byPath.get('content/articles.json'), 'content/articles.json'),
      parseJson(byPath.get('content/images.json'), 'content/images.json'),
    );
    importImageAssets(db, collection.files);
    importReviews(db, parseJson(byPath.get('newsroom/data/state.json'), 'newsroom/data/state.json'));
    const metrics = queryMetrics(db);
    db.prepare('UPDATE import_runs SET status = ?, completed_at = ?, counts_json = ? WHERE fingerprint = ?')
      .run('completed', new Date().toISOString(), canonicalJson(metrics.counts), collection.fingerprint);
    db.prepare(`INSERT INTO execution_runs
      (id, kind, started_at, finished_at, status, host, pid, git_commit, app_version, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `checkpoint-${snapshotId}`,
      'checkpoint',
      startedAt,
      new Date().toISOString(),
      'completed',
      host,
      pid,
      gitCommit || null,
      appVersion,
      canonicalJson({files: collection.files.length, bytes: collection.totalBytes, sourceFingerprint: collection.fingerprint}),
    );
    return {alreadyImported: false, counts: metrics.counts, metrics};
  });
  return result;
}
