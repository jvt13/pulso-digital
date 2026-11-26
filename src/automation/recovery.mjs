import fs from 'node:fs';
import path from 'node:path';
import {AutomationRepository} from './repository.mjs';
import {appendEvent} from './state.mjs';
import {Repository as EditorialRepository} from '../editorial/repository.mjs';

export function inspectJournal(root) {
  const file = path.join(root, 'editorial/data/transaction.json');
  return {required: fs.existsSync(file), path: 'editorial/data/transaction.json'};
}

export function staleRuns(state, now = Date.now()) {
  return state.runs.filter((run) => run.status === 'running' && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) < now);
}

export function recoverAutomation(root, {reason = 'Recuperação controlada da automação.', now = () => new Date().toISOString()} = {}) {
  const repository = new AutomationRepository(root, {now});
  repository.markStaleRuns();
  const state = repository.read();
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
    return {journal: recovered, automation: {recovered: true}};
  }
  return {journal: {recovered: false}, automation: {recovered: false}};
}
