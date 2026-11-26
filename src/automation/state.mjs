import crypto from 'node:crypto';
import {check, canonicalJson, sha256} from '../storage/common.mjs';

export const AUTOMATION_SCHEMA_VERSION = '1.0';
export const ACTIVITIES = ['health', 'radar', 'selection', 'backup'];
export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'blocked', 'deferred', 'cancelled', 'recovery-required'];
export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'blocked', 'deferred', 'cancelled', 'recovery-required'];

export function defaultAutomationState(config, now = new Date().toISOString()) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    control: {
      paused: true,
      pauseReason: 'default',
      initializedAt: now,
      lastPauseAt: now,
      lastResumeAt: null,
      lastTickAt: null,
      lastRunAt: null,
      lastBackupAt: null,
      leaseId: 'automation-orchestrator',
      version: 1,
    },
    schedules: (config.schedules || []).map((schedule) => ({
      id: schedule.id,
      activity: schedule.activity,
      intervalMs: schedule.intervalMs,
      enabled: schedule.enabled !== false,
      nextRunAt: now,
      lastRunAt: null,
      lastStatus: null,
    })),
    runs: [],
    jobs: [],
    steps: [],
    events: [],
  };
}

export function stateHash(state) {
  return sha256(canonicalJson(state));
}

export function validateAutomationState(state, config) {
  check(state && state.schemaVersion === AUTOMATION_SCHEMA_VERSION, 'AUTOMATION_STATE', 'Schema do estado da automação inválido.');
  check(state.control && typeof state.control.paused === 'boolean', 'AUTOMATION_STATE', 'Controle de pausa ausente.');
  for (const key of ['schedules', 'runs', 'jobs', 'steps', 'events']) check(Array.isArray(state[key]), 'AUTOMATION_STATE', `Lista ${key} inválida.`);
  check(new Set(state.schedules.map((schedule) => schedule.id)).size === state.schedules.length, 'AUTOMATION_STATE', 'Agendas duplicadas.');
  for (const schedule of state.schedules) {
    check(ACTIVITIES.includes(schedule.activity) && Number.isInteger(schedule.intervalMs) && schedule.intervalMs > 0, 'AUTOMATION_STATE', 'Agenda inválida.');
    check(typeof schedule.enabled === 'boolean' && typeof schedule.nextRunAt === 'string' && Number.isFinite(Date.parse(schedule.nextRunAt)), 'AUTOMATION_STATE', 'Próxima execução inválida.');
  }
  for (const run of state.runs) check(RUN_STATUSES.includes(run.status) && ACTIVITIES.includes(run.activity), 'AUTOMATION_STATE', 'Execução inválida.');
  for (const job of state.jobs) check(JOB_STATUSES.includes(job.status) && typeof job.topicId === 'string', 'AUTOMATION_STATE', 'Job inválido.');
  check(config.maxArticlesPerDay > 0 && config.maxArticlesPerDay <= 3, 'AUTOMATION_CONFIG', 'Limite diário inválido.');
  check(config.maxConcurrentAiRequests === 1, 'AUTOMATION_CONFIG', 'Uma chamada simultânea é obrigatória.');
  return state;
}

export function trimAutomationState(state, config) {
  const limits = config.historyLimits || {};
  const trim = (items, limit) => limit > 0 ? items.slice(-limit) : items;
  return {
    ...state,
    runs: trim(state.runs, limits.runs || 200),
    jobs: trim(state.jobs, limits.jobs || 500),
    steps: trim(state.steps, limits.steps || 1000),
    events: trim(state.events, limits.events || 1000),
  };
}

export function appendEvent(state, event, config) {
  state.events.push({
    id: event.id || `event-${crypto.randomUUID()}`,
    at: event.at || new Date().toISOString(),
    type: event.type || 'automation',
    severity: event.severity || 'info',
    runId: event.runId || null,
    jobId: event.jobId || null,
    message: event.message || null,
    details: event.details || {},
  });
  return trimAutomationState(state, config);
}

export function jobsToday(state) {
  const day = new Date().toISOString().slice(0, 10);
  return state.jobs.filter((job) => job.createdAt?.startsWith(day) && ['completed', 'running', 'queued'].includes(job.status)).length;
}
