import {appendEvent, jobsToday} from './state.mjs';

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function classify(error) {
  const code = String(error?.code || 'ERROR');
  if (['BUDGET', 'RATE_LIMIT', 'REVIEW_BUDGET', 'BUDGET_EXHAUSTED'].includes(code)) return 'deferred';
  if (['AI_DISABLED', 'FREE_TIER_UNCONFIRMED', 'PAID_BLOCKED', 'CREDENTIALS', 'DETERMINISTIC_BLOCKED', 'REVIEW_CONTRACT', 'REVIEW_TOO_LARGE', 'REVIEW_BLOCKED', 'RESEARCH_INSUFFICIENT', 'MODEL_INSUFFICIENT', 'BLOCKED'].includes(code)) return 'blocked';
  return 'failed';
}

export class Pipeline {
  constructor({repository, config, newsroom, reviewEngine, radarEngine, publicationEligibility, backup, now = () => new Date().toISOString()}) {
    this.repository = repository;
    this.config = config;
    this.newsroom = newsroom;
    this.reviewEngine = reviewEngine;
    this.radarEngine = radarEngine;
    this.publicationEligibility = publicationEligibility;
    this.backup = backup;
    this.now = now;
  }

  _step(state, job, name, status, result = null, error = null) {
    const step = {
      id: this.repository.newId('step'),
      jobId: job.id,
      step: name,
      status,
      attempt: 1,
      startedAt: this.now(),
      finishedAt: status === 'running' ? null : this.now(),
      ...(result ? {result} : {}),
      ...(error ? {error: {code: error.code || 'ERROR', message: error.message || String(error)}} : {}),
    };
    state.steps.push(step);
    job.stage = name;
    job.updatedAt = this.now();
    return step;
  }

  _event(state, run, job, type, severity, message, details = {}) {
    appendEvent(state, {at: this.now(), type, severity, runId: run.id, jobId: job?.id || null, message, details}, this.config);
  }

  async runSelection(state, run, {persist, maxArticles = this.config.maxArticlesPerDay, provider = 'mock', model = 'mock-sintetico', freeTierConfirmed = false, fixture = null, writeTransport = null, reviewTransport = null} = {}) {
    const remaining = Math.max(0, Math.min(maxArticles, this.config.maxArticlesPerDay - jobsToday(state)));
    if (!remaining) {
      this._event(state, run, null, 'pipeline', 'warning', 'Limite diário de matérias atingido.');
      run.summary = {selected: 0, remaining: 0, reason: 'DAILY_ARTICLE_LIMIT'};
      return run;
    }
    const plan = this.newsroom.plan({limit: remaining});
    const selected = plan.selected.slice(0, remaining);
    run.summary = {
      selected: selected.length,
      remaining,
      decisions: (plan.decisions || []).map(({id, topic, category, eligible, reasons, editorialScore, trendsScore}) => ({
        id, topic, category, eligible, reasons, editorialScore, trendsScore,
      })),
      jobs: [],
    };
    if (!selected.length) {
      this._event(state, run, null, 'pipeline', 'info', 'Nenhuma pauta elegível.');
      return run;
    }
    for (const candidate of selected) {
      const reusable = [...state.jobs].reverse().find((entry) => entry.topicId === candidate.id
        && entry.status === 'blocked'
        && ['CREDENTIALS', 'AI_DISABLED', 'FREE_TIER_UNCONFIRMED', 'RATE_LIMIT', 'BUDGET', 'REVIEW_BUDGET', 'DETERMINISTIC_BLOCKED', 'REVIEW_BLOCKED'].includes(entry.error?.code));
      const job = reusable || {
        id: this.repository.newId('job'),
        runId: run.id,
        topicId: candidate.id,
        status: 'queued',
        stage: 'planned',
        attempts: 0,
        maxAttempts: 1,
        nextAttemptAt: null,
        createdAt: this.now(),
        updatedAt: this.now(),
        result: null,
        error: null,
      };
      if (reusable) {
        job.retryHistory = [...(job.retryHistory || []), {at: this.now(), priorError: job.error, reason: 'Retomada após bloqueio conhecido antes de chamada externa.'}];
        job.runId = run.id;
        job.status = 'queued';
        job.stage = 'planned';
        job.attempts = 0;
        job.error = null;
        job.result = null;
        job.updatedAt = this.now();
      }
      if (!reusable) state.jobs.push(job);
      this._event(state, run, job, 'pipeline', 'info', 'Pauta selecionada.', {
        editorialScore: candidate.editorialScore,
        trendsScore: candidate.trendsScore,
        reasons: candidate.reasons,
      });
      persist();
      try {
        if (!this.config.ai.enabled) {
          const error = Object.assign(new Error('IA real desativada na configuração da automação.'), {code: 'AI_DISABLED'});
          throw error;
        }
        if (!freeTierConfirmed || !this.config.ai.freeTierConfirmed) {
          const error = Object.assign(new Error('Modalidade gratuita da IA não confirmada.'), {code: 'FREE_TIER_UNCONFIRMED'});
          throw error;
        }
        job.status = 'running';
        job.attempts = 1;
        this._step(state, job, 'research', 'running');
        persist();
        let record;
        try {
          record = this.newsroom.show(candidate.id);
        } catch (error) {
          if (error?.code !== 'NOT_FOUND') throw error;
          record = {dossier: null};
        }
        if (!record.dossier) {
          record = await this.newsroom.research(candidate.id);
        }
        this._step(state, job, 'research', 'completed', {status: record.status, evidence: record.dossier?.evidence?.length || 0});
        if (record.status === 'research-insufficient' || !record.dossier || record.dossier.insufficient) {
          const error = Object.assign(new Error('Pesquisa insuficiente.'), {code: 'RESEARCH_INSUFFICIENT'});
          throw error;
        }
        persist();

        record = this.newsroom.show(candidate.id);
        if (!record.draft) {
          this._step(state, job, 'write', 'running');
          persist();
          await this.newsroom.write(candidate.id, {
            provider,
            model,
            freeTierConfirmed,
            transport: writeTransport || undefined,
            fixture: fixture || undefined,
            retryReason: 'Execução do orquestrador editorial.',
          });
          this._step(state, job, 'write', 'completed');
        } else {
          this._step(state, job, 'write', 'completed', {resumed: true, attemptId: record.ai?.attemptId || null});
        }
        persist();

        record = this.newsroom.show(candidate.id);
        let verification;
        if (record.verification?.valid) {
          verification = {id: candidate.id, status: record.status, verification: record.verification};
          this._step(state, job, 'verify', 'completed', {...verification.verification, resumed: true});
        } else {
          this._step(state, job, 'verify', 'running');
          verification = await this.newsroom.verify(candidate.id);
        }
        this._step(state, job, 'verify', verification.verification.valid ? 'completed' : 'blocked', verification.verification);
        persist();
        if (!verification.verification.valid) {
          const error = Object.assign(new Error('Validação determinística bloqueou o rascunho.'), {code: 'DETERMINISTIC_BLOCKED'});
          error.details = verification.verification.errors;
          throw error;
        }

        this._step(state, job, 'review', 'running');
        persist();
        const review = await this.reviewEngine.review(candidate.id, {provider: this.config.ai.reviewProvider, freeTierConfirmed});
        this._step(state, job, 'review', review.review.result === 'pass' ? 'completed' : 'blocked', {result: review.review.result, findings: review.review.findings?.length || 0});
        persist();
        if (review.review.result !== 'pass') {
          const error = Object.assign(new Error('Revisão semântica não autorizou o encaminhamento.'), {code: 'REVIEW_BLOCKED'});
          error.details = review.review.findings;
          throw error;
        }

        this._step(state, job, 'image', 'running');
        const image = await this.newsroom.prepareImage(candidate.id);
        this._step(state, job, 'image', 'completed', {status: image.status});
        persist();

        this._step(state, job, 'import', 'running');
        const imported = await this.newsroom.importDraft(candidate.id);
        this._step(state, job, 'import', 'completed', {editorialId: imported.editorialId, imageStatus: imported.imageStatus});
        this._step(state, job, 'eligibility', 'running');
        const eligibility = this.publicationEligibility
          ? this.publicationEligibility(candidate.id)
          : {status: 'unknown', eligible: false, errors: [{code: 'ELIGIBILITY_NOT_CONFIGURED'}]};
        const eligibilityBlocked = !['awaiting-human-approval', 'eligible', 'already-published'].includes(eligibility.status);
        this._step(state, job, 'eligibility', eligibilityBlocked ? 'blocked' : 'completed', {
          status: eligibility.status,
          eligible: eligibility.eligible,
          errors: eligibility.errors?.map((item) => item.code) || [],
        });
        if (eligibilityBlocked) {
          const error = Object.assign(new Error('Política de elegibilidade bloqueou a publicação.'), {code: 'ELIGIBILITY_BLOCKED'});
          error.details = eligibility.errors;
          throw error;
        }
        job.status = 'completed';
        job.stage = 'completed';
        job.result = {
          editorialId: imported.editorialId,
          imageStatus: imported.imageStatus,
          review: review.review.result,
          eligibility: eligibility.status,
          eligibleForPublication: eligibility.eligible,
        };
        job.updatedAt = this.now();
        this._event(state, run, job, 'pipeline', 'info', 'Rascunho privado importado.', job.result);
        run.summary.jobs.push({id: job.id, topicId: job.topicId, status: job.status, result: job.result});
        persist();
      } catch (caught) {
        job.status = classify(caught);
        job.error = {code: caught.code || 'ERROR', message: caught.message || String(caught), details: caught.details || null};
        job.updatedAt = this.now();
        this._step(state, job, job.stage || 'unknown', job.status, null, caught);
        this._event(state, run, job, 'pipeline', job.status === 'deferred' ? 'warning' : 'error', caught.message || String(caught), {code: job.error.code});
        run.summary.jobs.push({id: job.id, topicId: job.topicId, status: job.status, error: job.error});
        persist();
      }
    }
    return run;
  }

  async runRadar(state, run, {persist} = {}) {
    const result = await this.radarEngine.fetch({dryRun: false});
    run.summary = {
      radarRunId: result.id || null,
      signals: result.signals,
      newTopics: result.newTopics,
      observedTopics: result.observedTopics,
      uniqueTopics: result.uniqueTopics,
    };
    run.radarRunId = result.id || null;
    this._event(state, run, null, 'radar', 'info', 'Coleta do radar concluída.', run.summary);
    persist();
    return run;
  }

  async runHealth(state, run, {persist} = {}) {
    const metrics = this.repository.metrics();
    run.summary = {
      backend: metrics.backend,
      databaseBytes: metrics.databaseBytes,
      aiCalls: metrics.ai.calls,
      incomplete: metrics.ai.incomplete,
      reviews: metrics.reviews?.total || 0,
      imagesPending: metrics.statuses?.images?.['image-pending'] || 0,
      openJobs: state.jobs.filter((job) => ['queued', 'running', 'recovery-required'].includes(job.status)).length,
    };
    this._event(state, run, null, 'health', 'info', 'Health check concluído.', run.summary);
    persist();
    return run;
  }

  async runBackup(state, run, {persist} = {}) {
    const result = await this.backup();
    run.summary = result;
    state.control.lastBackupAt = this.now();
    this._event(state, run, null, 'backup', 'info', 'Backup concluído.', {snapshotId: result.snapshotId});
    persist();
    return run;
  }
}

export {classify, utcDay};
