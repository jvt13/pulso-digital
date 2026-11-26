import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {StorageError, check, readJson} from '../storage/common.mjs';
import {
  operationalActive,
  operationalDatabaseExists,
  operationalMetrics,
  readOperationalLease,
  readOperationalStateWithHash,
  withOperationalLease,
  writeOperationalState,
} from '../storage/operational.mjs';
import {appendEvent, defaultAutomationState, trimAutomationState, validateAutomationState} from './state.mjs';

export class AutomationRepository {
  constructor(root, {now = () => new Date().toISOString()} = {}) {
    this.root = fs.realpathSync(path.resolve(root));
    this.now = now;
    check(readJson(path.join(this.root, 'package.json'), 65536).name === 'pulso-digital', 'ROOT', 'Raiz inválida.');
    this.config = readJson(path.join(this.root, 'automation/config.json'), 65536);
    this._validateConfig();
    this.hash = null;
  }

  _validateConfig() {
    const c = this.config;
    check(c.schemaVersion === '1.0' && c.pausedByDefault === true, 'AUTOMATION_CONFIG', 'Configuração da automação inválida.');
    check(c.maxArticlesPerDay > 0 && c.maxArticlesPerDay <= 3 && c.maxConcurrentAiRequests === 1, 'AUTOMATION_CONFIG', 'Limites editoriais inválidos.');
    check(c.maxDailyTokens === 50000 && c.maxMonthlySpendUsd === 0, 'AUTOMATION_CONFIG', 'Orçamento da automação inválido.');
    check(c.missedPolicy === 'coalesce' && Number.isInteger(c.maxCatchUpMs) && c.maxCatchUpMs > 0, 'AUTOMATION_CONFIG', 'Política de atraso inválida.');
    check(Number.isInteger(c.leaseTtlMs) && c.leaseTtlMs >= 60000, 'AUTOMATION_CONFIG', 'Lease inválida.');
    check(Array.isArray(c.schedules) && c.schedules.length > 0 && new Set(c.schedules.map((item) => item.id)).size === c.schedules.length, 'AUTOMATION_CONFIG', 'Agendas inválidas.');
    for (const schedule of c.schedules) check(['health', 'radar', 'selection', 'backup'].includes(schedule.activity) && Number.isInteger(schedule.intervalMs) && schedule.intervalMs > 0, 'AUTOMATION_CONFIG', 'Agenda inválida.');
    check(c.ai && typeof c.ai.enabled === 'boolean' && c.ai.provider === 'groq' && c.ai.reviewProvider === 'gemini' && typeof c.ai.freeTierConfirmed === 'boolean', 'AUTOMATION_CONFIG', 'Configuração de IA inválida.');
  }

  _backend() {
    if (operationalActive(this.root)) return 'sqlite';
    if (operationalDatabaseExists(this.root)) throw new StorageError('BACKEND_UNAVAILABLE', 'Banco operacional existe sem marcador válido; recuperação explícita necessária.');
    throw new StorageError('BACKEND_REQUIRED', 'Automação requer o backend SQLite operacional ativo; instalações legadas devem migrar primeiro.');
  }

  _readOrNull() {
    this._backend();
    try {
      const loaded = readOperationalStateWithHash(this.root, 'automation');
      this.hash = loaded.hash;
      return loaded.state;
    } catch (error) {
      if (error?.code === 'OPERATIONAL_STATE') {
        this.hash = null;
        return null;
      }
      throw error;
    }
  }

  read() {
    const state = this._readOrNull();
    if (!state) throw new StorageError('AUTOMATION_NOT_INITIALIZED', 'Execute automation init antes de operar.');
    return validateAutomationState(state, this.config);
  }

  readOrNull() {
    return this._readOrNull();
  }

  init() {
    const existing = this._readOrNull();
    if (existing) return {alreadyInitialized: true, state: existing};
    const state = defaultAutomationState(this.config, this.now());
    validateAutomationState(state, this.config);
    this.hash = writeOperationalState(this.root, 'automation', state, {expectedHash: null, action: 'automation-init'});
    return {alreadyInitialized: false, state};
  }

  save(state, {lease = null} = {}) {
    validateAutomationState(state, this.config);
    const trimmed = trimAutomationState({...state, updatedAt: this.now()}, this.config);
    this.hash = writeOperationalState(this.root, 'automation', trimmed, {
      expectedHash: this.hash,
      action: 'automation-state',
      lease,
    });
    return trimmed;
  }

  async withLease(callback) {
    const state = this.read();
    return withOperationalLease(this.root, {
      id: state.control.leaseId || 'automation-orchestrator',
      ttlMs: this.config.leaseTtlMs,
      key: null,
    }, callback);
  }

  pause(reason = 'Pausa explícita do operador.') {
    check(typeof reason === 'string' && reason.trim().length >= 5, 'REASON_REQUIRED', 'Informe o motivo da pausa.');
    const state = this.read();
    state.control.paused = true;
    state.control.pauseReason = reason.trim();
    state.control.lastPauseAt = this.now();
    appendEvent(state, {at: this.now(), type: 'control', severity: 'info', message: 'Automação pausada.', details: {reason: reason.trim()}}, this.config);
    return this.save(state);
  }

  resume() {
    const state = this.read();
    state.control.paused = false;
    state.control.pauseReason = null;
    state.control.lastResumeAt = this.now();
    appendEvent(state, {at: this.now(), type: 'control', severity: 'info', message: 'Automação retomada.'}, this.config);
    return this.save(state);
  }

  markStaleRuns({lease = null} = {}) {
    const state = this.read();
    const now = Date.parse(this.now());
    let changed = false;
    for (const run of state.runs) {
      const activeLease = run.status === 'running'
        ? readOperationalLease(this.root, run.leaseOwner ? state.control.leaseId || 'automation-orchestrator' : null)
        : null;
      const lostLease = !activeLease || activeLease.token !== run.leaseOwner || !(Date.parse(activeLease.expires_at) > now);
      if (run.status === 'running' && lostLease) {
        run.status = 'recovery-required';
        run.error = {code: activeLease ? 'LEASE_EXPIRED' : 'LEASE_MISSING', message: 'Processo anterior não confirmou a execução; resultado externo é desconhecido.'};
        appendEvent(state, {at: this.now(), type: 'recovery', severity: 'error', runId: run.id, message: 'Execução órfã marcada para recuperação.'}, this.config);
        changed = true;
      }
    }
    if (changed) this.save(state, {lease});
    return {changed};
  }

  metrics() {
    this._backend();
    return operationalMetrics(this.root);
  }

  newId(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
}
