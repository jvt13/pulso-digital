import fs from 'node:fs';
import path from 'node:path';
import {AutomationRepository} from './repository.mjs';
import {appendEvent} from './state.mjs';
import {Repository as EditorialRepository} from '../editorial/repository.mjs';
import {readOperationalLease, readOperationalStateWithHash} from '../storage/operational.mjs';
import {runtimeDataPath} from '../runtime/paths.mjs';

export function inspectJournal(root) {
  const file = runtimeDataPath(root, 'editorial/data/transaction.json');
  return {required: fs.existsSync(file), path: 'editorial/data/transaction.json'};
}

export function staleRuns(state, now = Date.now()) {
  return state.runs.filter((run) => run.status === 'running' && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) < now);
}

export function recoverAutomation(root, {reason = 'Recuperação controlada da automação.', now = () => new Date().toISOString()} = {}) {
  const repository = new AutomationRepository(root, {now});
  let state = repository.read();
  const radarState = readOperationalStateWithHash(root, 'radar').state;
  let reconciled = 0;
  for (const run of state.runs) {
    if (run.status !== 'running') continue;
    const activeLease = readOperationalLease(root, state.control.leaseId || 'automation-orchestrator');
    if (activeLease && activeLease.token === run.leaseOwner && Date.parse(activeLease.expires_at) > Date.parse(now())) continue;
    if (run.activity !== 'radar') continue;
    const persisted = [...radarState.runs].reverse().find((item) => item.dryRun === false && Date.parse(item.at) >= Date.parse(run.startedAt) && Date.parse(item.at) <= Date.parse(now()));
    if (!persisted) continue;
    run.status = 'completed';
    run.finishedAt = persisted.at;
    run.radarRunId = persisted.id;
    run.summary = {
      radarRunId: persisted.id,
      signals: persisted.signals,
      newTopics: persisted.newTopics,
      observedTopics: persisted.observedTopics,
      uniqueTopics: persisted.uniqueTopics,
    };
    run.error = null;
    const schedule = state.schedules.find((item) => item.id === run.scheduleId);
    if (schedule) {
      schedule.lastRunAt = persisted.at;
      schedule.lastStatus = 'completed';
    }
    appendEvent(state, {
      at: now(),
      type: 'recovery',
      severity: 'warning',
      runId: run.id,
      message: 'Run do orquestrador reconciliado com coleta real persistida; nenhuma coleta foi repetida.',
      details: {radarRunId: persisted.id, reason},
    }, repository.config);
    reconciled++;
  }
  if (reconciled) repository.save(state);
  repository.markStaleRuns();
  state = repository.read();
  const journal = inspectJournal(root);
  if (journal.required) {
    const editorial = new EditorialRepository(root);
    const recovered = editorial.withLock(() => editorial.recover(), {recovery: true});
    appendEvent(state, {
      at: now(),
      type: 'recovery',
      severity: recovered.action === 'reconciled-forward' ? 'warning' : 'info',
      message: `Journal editorial reconciliado: ${recovered.action || 'sem diário'}.`,
      details: {reason, recovered},
    }, repository.config);
    repository.save(state);
    return {journal: recovered, automation: {recovered: true, reconciled}};
  }
  return {journal: {recovered: false}, automation: {recovered: reconciled > 0, reconciled}};
}
