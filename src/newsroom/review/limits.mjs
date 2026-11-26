import {check} from '../common.mjs';

export function reviewTopicCallLimit(reviewConfig, topicId) {
  const override = (reviewConfig.topicOverrides || []).find((item) => item.topicId === topicId);
  return override?.maxCalls ?? reviewConfig.maxCallsPerTopic;
}

export function validateReviewTopicLimits(reviewConfig) {
  check(Number.isInteger(reviewConfig.maxCallsPerTopic) && reviewConfig.maxCallsPerTopic > 0 && reviewConfig.maxCallsPerTopic <= 4, 'CONFIG', 'Limite padrão por pauta inválido.');
  check(Array.isArray(reviewConfig.topicOverrides), 'CONFIG', 'Exceções de revisão inválidas.');
  const ids = new Set();
  for (const item of reviewConfig.topicOverrides) {
    check(/^pauta-[a-f0-9]{24}$/.test(item.topicId || '') && !ids.has(item.topicId), 'CONFIG', 'Pauta de exceção inválida ou repetida.');
    ids.add(item.topicId);
    check(Number.isInteger(item.maxCalls) && item.maxCalls > reviewConfig.maxCallsPerTopic && item.maxCalls <= 4, 'CONFIG', 'Exceção de chamadas por pauta inválida.');
    check(item.taskId === 'PD-006.6.1' && typeof item.reason === 'string' && item.reason.trim().length >= 20, 'CONFIG', 'Exceção de revisão sem escopo ou justificativa.');
  }
}
