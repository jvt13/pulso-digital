import fs from 'node:fs';
import path from 'node:path';
import {AutomationRepository} from './repository.mjs';
import {Pipeline, classify} from './pipeline.mjs';
import {automationHealth} from './health.mjs';
import {recoverAutomation} from './recovery.mjs';
import {appendEvent, defaultAutomationState, jobsToday} from './state.mjs';
import {advanceSchedule, dueSchedules, nextRunAt} from './scheduler.mjs';
import {RadarRepository} from '../radar/repository.mjs';
import {RadarEngine} from '../radar/engine.mjs';
import {NewsroomRepository} from '../newsroom/repository.mjs';
import {NewsroomEngine} from '../newsroom/engine.mjs';
import {ReviewEngine} from '../newsroom/review/engine.mjs';
import {evaluatePublicationEligibility} from '../newsroom/publication-eligibility.mjs';
import {createCheckpoint, loadProjectConfig, selectSnapshot} from '../storage/snapshots.mjs';
import {verifySnapshot} from '../storage/integrity.mjs';
import {loadStorageKey} from '../storage/env.mjs';

export class AutomationOrchestrator {
  constructor(root, {now = () => new Date().toISOString(), dependencies = {}} = {}) {
    this.root = fs.realpathSync(path.resolve(root));
    this.now = now;
    this.dependencies = dependencies;
    this.repository = new AutomationRepository(this.root, {now});
    this.config = this.repository.config;
    this.newsroomRepo = dependencies.newsroomRepo || new NewsroomRepository(this.root, {now});
    this.newsroom = dependencies.newsroom || new NewsroomEngine(this.newsroomRepo, dependencies.newsroomDependencies || {});
    this.reviewEngine = dependencies.reviewEngine || new ReviewEngine(this.newsroomRepo, {dependencies: {geminiTransport: dependencies.reviewTransport}});
    this.radar = dependencies.radarEngine || new RadarEngine(new RadarRepository(this.root), dependencies.radarDependencies || {});
    this.pipeline = new Pipeline({
      repository: this.repository,
      config: this.config,
      newsroom: this.newsroom,
      reviewEngine: this.reviewEngine,
      radarEngine: this.radar,
      publicationEligibility: dependencies.publicationEligibility || ((topicId) => evaluatePublicationEligibility(this.newsroomRepo, topicId)),
      backup: dependencies.backup || this._backup.bind(this),
      now,
    });
  }

  init() {
    const result = this.repository.init();
    return {backend: 'sqlite', initialized: true, alreadyInitialized: result.alreadyInitialized, paused: result.state.control.paused};
  }

  status() {
    const state = this.repository.readOrNull();
    const effective = state || defaultAutomationState(this.config, this.now());
    const metrics = this.repository.metrics();
    return {
      backend: 'sqlite',
      initialized: Boolean(state),
      paused: effective.control.paused,
      nextRunAt: state ? nextRunAt(state) : null,
      lastRunAt: effective.control.lastRunAt,
      lastBackupAt: effective.control.lastBackupAt,
      schedules: effective.schedules,
      jobs: {
        open: (state?.jobs || []).filter((job) => ['queued', 'running', 'recovery-required'].includes(job.status)).length,
        failed: (state?.jobs || []).filter((job) => job.status === 'failed').length,
        blocked: (state?.jobs || []).filter((job) => job.status === 'blocked').length,
        recoveryRequired: (state?.jobs || []).filter((job) => job.status === 'recovery-required').length,
        today: state ? jobsToday(state) : 0,
      },
      limits: {
        maxArticlesPerDay: this.config.maxArticlesPerDay,
        maxDailyTokens: this.config.maxDailyTokens,
        maxMonthlySpendUsd: this.config.maxMonthlySpendUsd,
        maxConcurrentAiRequests: this.config.maxConcurrentAiRequests,
      },
      ai: {enabled: this.config.ai.enabled, provider: this.config.ai.provider, model: this.config.ai.model, reviewProvider: this.config.ai.reviewProvider},
      databaseBytes: metrics.databaseBytes,
      automaticApproval: false,
      automaticPublication: false,
    };
  }

  plan() {
    const state = this.repository.readOrNull();
    if (!state) {
      return {backend: 'sqlite', initialized: false, paused: true, due: [], skipped: [], nextRunAt: null, persistentChanges: false, externalCalls: false};
    }
    const now = Date.parse(this.now());
    const plan = dueSchedules(state, now, this.config);
    return {
      backend: 'sqlite',
      initialized: true,
      paused: state.control.paused,
      due: plan.due.map((schedule) => ({id: schedule.id, activity: schedule.activity, nextRunAt: schedule.nextRunAt, plannedAt: schedule.plannedAt})),
      skipped: plan.skipped,
      nextRunAt: plan.nextRunAt,
      persistentChanges: false,
      externalCalls: false,
    };
  }

  async runOnce({dryRun = false, mode = 'once', freeTierConfirmed = false, maxArticles = this.config.maxArticlesPerDay, activity = null} = {}) {
    if (!Number.isInteger(maxArticles) || maxArticles < 1 || maxArticles > this.config.maxArticlesPerDay) {
      throw Object.assign(new Error('Limite de matérias da execução inválido.'), {code: 'LIMIT'});
    }
    if (dryRun) return {dryRun: true, ...this.plan()};
    return this.repository.withLease(async (lease) => {
      this.repository.markStaleRuns({lease});
      const state = this.repository.read();
      if (state.control.paused) throw Object.assign(new Error('Automação pausada.'), {code: 'PAUSED'});
      const now = Date.parse(this.now());
      const schedulePlan = dueSchedules(state, now, this.config);
      let due = schedulePlan.due;
      if (activity) {
        const requested = state.schedules.find((schedule) => schedule.activity === activity);
        if (!requested) throw Object.assign(new Error('Atividade não configurada.'), {code: 'AUTOMATION_ACTIVITY'});
        if (!requested.enabled) throw Object.assign(new Error('Atividade desabilitada.'), {code: 'ACTIVITY_DISABLED'});
        due = [{...requested, plannedAt: this.now(), manualTrigger: true}];
      }
      const runs = [];
      state.control.lastTickAt = this.now();
      for (const schedule of due) {
        lease.assertHeld();
        const index = state.schedules.findIndex((entry) => entry.id === schedule.id);
        const run = {
          id: this.repository.newId('run'),
          scheduleId: schedule.id,
          activity: schedule.activity,
          mode,
          status: 'running',
          startedAt: this.now(),
          finishedAt: null,
          leaseOwner: lease.token,
          leaseExpiresAt: lease.expiresAt,
          summary: null,
          error: null,
        };
        state.runs.push(run);
        if (schedule.manualTrigger) {
          appendEvent(state, {
            at: this.now(),
            type: 'scheduler',
            severity: 'info',
            runId: run.id,
            message: 'Execução manual de atividade solicitada explicitamente.',
            details: {scheduleId: schedule.id, activity: schedule.activity},
          }, this.config);
        }
        if (schedule.coalesced) {
          appendEvent(state, {
            at: this.now(),
            type: 'scheduler',
            severity: 'warning',
            runId: run.id,
            message: 'Execução atrasada consolidada em uma única recuperação.',
            details: {scheduleId: schedule.id, overdueMs: schedule.overdueMs, missedIntervals: schedule.missedIntervals},
          }, this.config);
        }
        state.schedules[index] = advanceSchedule(schedule, now, 'running', this.config);
        this.repository.save(state, {lease});
        try {
          await this._execute(state, run, {
            lease,
            persist: () => {
              lease.assertHeld();
              this.repository.save(state, {lease});
            },
            freeTierConfirmed,
            maxArticles,
          });
          run.status = 'completed';
        } catch (error) {
          run.status = error.code === 'PAUSED' ? 'cancelled' : classify(error);
          if (run.status === 'completed') run.status = 'failed';
          run.error = {code: error.code || 'ERROR', message: error.message || String(error), details: error.details || null};
          appendEvent(state, {at: this.now(), type: 'run', severity: run.status === 'deferred' ? 'warning' : 'error', runId: run.id, message: run.error.message, details: {code: run.error.code}}, this.config);
        }
        run.finishedAt = this.now();
        const current = state.schedules[index];
        state.schedules[index] = {...current, lastStatus: run.status, lastRunAt: run.finishedAt};
        state.control.lastRunAt = run.finishedAt;
        appendEvent(state, {at: run.finishedAt, type: 'run', severity: run.status === 'completed' ? 'info' : 'warning', runId: run.id, message: `Execução ${run.activity}: ${run.status}.`, details: {scheduleId: run.scheduleId}}, this.config);
        this.repository.save(state, {lease});
        runs.push(run);
      }
      this.repository.save(state, {lease});
      return {
        backend: 'sqlite',
        mode,
        runs,
        state: {paused: state.control.paused, jobsToday: jobsToday(state), openJobs: state.jobs.filter((job) => ['queued', 'running', 'recovery-required'].includes(job.status)).length},
        automaticApproval: false,
        automaticPublication: false,
      };
    });
  }

  async _execute(state, run, options) {
    if (run.activity === 'radar') return this.pipeline.runRadar(state, run, options);
    if (run.activity === 'health') return this.pipeline.runHealth(state, run, options);
    if (run.activity === 'backup') return this.pipeline.runBackup(state, run, options);
    if (run.activity === 'selection') {
      return this.pipeline.runSelection(state, run, {
        ...options,
        provider: this.dependencies.provider || this.config.ai.provider,
        model: this.dependencies.model || this.config.ai.model,
        fixture: this.dependencies.fixture || null,
        writeTransport: this.dependencies.writeTransport || null,
      });
    }
    throw Object.assign(new Error(`Atividade desconhecida: ${run.activity}.`), {code: 'AUTOMATION_ACTIVITY'});
  }

  async start({maxIterations = null, freeTierConfirmed = false, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))} = {}) {
    const initial = this.repository.read();
    if (initial.control.paused) throw Object.assign(new Error('Retome a automação antes de start.'), {code: 'PAUSED'});
    let iterations = 0;
    let stopped = false;
    const stop = () => { stopped = true; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      while (!stopped && (maxIterations === null || iterations < maxIterations)) {
        await this.runOnce({mode: 'continuous', freeTierConfirmed});
        iterations++;
        if (maxIterations !== null && iterations >= maxIterations) break;
        const state = this.repository.read();
        if (state.control.paused) break;
        const next = nextRunAt(state);
        const delay = next ? Math.max(1000, Math.min(60000, Date.parse(next) - Date.now())) : 60000;
        await sleep(delay);
      }
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
    return {stopped, iterations, paused: this.repository.read().control.paused};
  }

  pause(reason) {
    const state = this.repository.pause(reason);
    return {paused: state.control.paused, reason: state.control.pauseReason};
  }

  resume() {
    const state = this.repository.resume();
    return {paused: state.control.paused, nextRunAt: nextRunAt(state)};
  }

  jobs({limit = 50} = {}) {
    const state = this.repository.readOrNull();
    return (state?.jobs || []).slice(-limit).reverse();
  }

  history({limit = 50} = {}) {
    const state = this.repository.readOrNull();
    return (state?.runs || []).slice(-limit).reverse();
  }

  metrics() {
    const metrics = this.repository.metrics();
    const state = this.repository.readOrNull();
    return {
      ...metrics,
      automation: {
        initialized: Boolean(state),
        paused: state?.control.paused ?? true,
        nextRunAt: state ? nextRunAt(state) : null,
        lastRunAt: state?.control.lastRunAt || null,
        lastBackupAt: state?.control.lastBackupAt || null,
        jobsToday: state ? jobsToday(state) : 0,
        jobs: state?.jobs?.length || 0,
        runs: state?.runs?.length || 0,
      },
    };
  }

  health() {
    return automationHealth(this.repository, this.root);
  }

  recover(reason = 'Recuperação controlada da automação.') {
    return recoverAutomation(this.root, {reason, now: this.now});
  }

  async _backup() {
    const {config, packageJson} = loadProjectConfig(this.root);
    const loaded = loadStorageKey(this.root);
    const created = createCheckpoint(this.root, config, packageJson, loaded.key);
    const selected = selectSnapshot(this.root, config, created.snapshotId);
    const verified = verifySnapshot(selected.directory, loaded.key, config);
    return {snapshotId: created.snapshotId, databaseBytes: created.databaseBytes, files: created.files, totalBytes: created.totalBytes, verified: verified.authenticated};
  }
}
