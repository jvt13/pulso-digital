import { ensure, hash, canonical, STATES } from './schema.mjs';

const transitions = {
  pending: ['draft', 'rejected'], draft: ['validated', 'rejected'],
  validated: ['approved', 'draft', 'rejected'], approved: ['published', 'draft', 'rejected'],
  rejected: ['draft'], published: []
};
export const permittedTransitions = transitions;
export function verifyRecord(record) {
  ensure(record?.recordVersion==='1.0' && Array.isArray(record.history) && record.history.length, 'HISTORY_INTEGRITY', 'Versão de registro inválida ou histórico editorial ausente.');
  let previousHash = null, previousState = null;
  for (const [i, event] of record.history.entries()) {
    const { hash: digest, ...material } = event;
    ensure(event.sequence === i + 1 && event.previousHash === previousHash && hash(material) === digest && event.from === previousState && STATES.includes(event.to), 'HISTORY_INTEGRITY', 'Histórico alterado ou inconsistente.');
    ensure(event.snapshot.state === event.to, 'HISTORY_INTEGRITY', 'Snapshot incompatível com a transição.');
    if (i === 0) ensure(event.action === 'import' && event.to === 'pending', 'HISTORY_INTEGRITY', 'Origem do histórico inválida.');
    else ensure(event.from === event.to ? event.action === 'validation-failed' : transitions[event.from]?.includes(event.to), 'HISTORY_INTEGRITY', 'Transição histórica inválida.');
    previousHash = digest; previousState = event.to;
  }
  const { history, ...snapshot } = record;
  ensure(canonical(snapshot) === canonical(history.at(-1).snapshot), 'HISTORY_INTEGRITY', 'Dados foram alterados fora do fluxo editorial.');
  return record;
}
export function transition(record, to, { action, actor = 'motor-editorial-local', reason, at = new Date().toISOString(), patch = {} }) {
  if (record) verifyRecord(record);
  const from = record?.state || null;
  ensure(from === null ? to === 'pending' : from === to ? action === 'validation-failed' : transitions[from]?.includes(to), 'INVALID_TRANSITION', `Transição não permitida: ${from} → ${to}.`);
  ensure(typeof reason === 'string' && reason.trim().length >= 5, 'REASON_REQUIRED', 'Informe uma justificativa com pelo menos cinco caracteres.');
  const { history: oldHistory = [], ...old } = record || {};
  const snapshot = { ...old, ...patch, state: to };
  const event = { sequence: oldHistory.length + 1, at, from, to, action, actor, reason, previousHash: oldHistory.at(-1)?.hash || null, snapshot: structuredClone(snapshot) };
  return { ...snapshot, history: [...oldHistory, { ...event, hash: hash(event) }] };
}
