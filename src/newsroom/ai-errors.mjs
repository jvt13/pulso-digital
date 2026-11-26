const TRANSPORT_CODES = new Set([
  'TRANSPORT_SCHEMA',
  'TRANSPORT_ALIAS',
  'TRANSPORT_POSITION',
  'TRANSPORT_TRACEABILITY',
  'TRANSPORT_COVERAGE',
]);

function messageOf(error) {
  return String(error?.apiError?.message || error?.message || '');
}

function classify(error) {
  const code = String(error?.code || 'AI_ERROR');
  const message = messageOf(error);

  if (code === 'CREDENTIALS') return ['CREDENTIALS_MISSING', 'configure-local-credential', 'auth'];
  if (code === 'FREE_TIER_UNCONFIRMED') return ['FREE_TIER_UNCONFIRMED', 'confirm-free-tier', 'auth'];
  if (code === 'PAID_BLOCKED') return ['PAID_BLOCKED', 'keep-paid-services-disabled', 'policy'];
  if (code === 'BUDGET') return ['BUDGET_EXHAUSTED', 'wait-for-budget-window-or-reduce-scope', 'budget'];
  if (code === 'RATE_LIMIT') return ['RATE_LIMITED', 'wait-for-minute-window', 'budget'];
  if (code === 'TOKEN_LIMIT') return ['REQUEST_TOO_LARGE', 'reduce-prompt-or-split-with-budget', 'input'];
  if (code === 'REVIEW_BUDGET') return ['BUDGET_EXHAUSTED', 'wait-for-review-budget-or-reduce-scope', 'budget'];
  if (code === 'REVIEW_TOO_LARGE') return ['REVIEW_TOO_LARGE', 'reduce-review-payload-or-split-with-budget', 'input'];
  if (code === 'TIMEOUT') return ['TIMEOUT', 'reduce-thinking-or-prompt-before-retry', 'transient'];
  if (code === 'TRUNCATED') return ['OUTPUT_TRUNCATED', 'reduce-output-or-increase-max-output-within-tpm', 'output'];
  if (code === 'INVALID_JSON') return ['JSON_MALFORMED', 'inspect-provider-output-and-fix-format', 'output'];
  if (code === 'RESPONSE_LIMIT') return ['RESPONSE_TOO_LARGE', 'reduce-output', 'output'];
  if (code === 'MODEL_INSUFFICIENT') return ['MODEL_INSUFFICIENT', 'return-to-research-before-retry', 'research'];
  if (code === 'DETERMINISTIC_BLOCKED') return ['DETERMINISTIC_BLOCKED', 'fix-deterministic-validation', 'validation'];
  if (code === 'SCHEMA_INVALID') return ['SCHEMA_INVALID', 'fix-schema-before-retry', 'schema'];
  if (code === 'REVIEW_CONTRACT') return ['REVIEW_CONTRACT', 'fix-review-output-contract', 'validation'];
  if (code === 'REVIEW_PROVIDER') return ['REVIEW_PROVIDER', 'use-configured-reviewer', 'policy'];
  if (TRANSPORT_CODES.has(code)) return [code, 'fix-transport-mapping-before-retry', 'validation'];

  if (code === 'HTTP_400') {
    if (/json[_ ]schema|invalid.*schema|required.*properties|properties.*required|is required to be supplied|must be listed in .*required|missing properties/i.test(message) || error?.apiError?.code === 'invalid_json_schema') {
      return ['SCHEMA_INVALID', 'fix-schema-before-retry', 'schema'];
    }
    if (/max completion tokens|output was truncated|truncated to fit|truncated.*max_completion_tokens/i.test(message)) {
      return ['OUTPUT_TRUNCATED', 'reduce-output-or-increase-max-output-within-tpm', 'output'];
    }
    if (/does not match the expected schema|jsonschema|minItems|maxItems|additionalProperties|properties\/.*required/i.test(message)) {
      return ['OUTPUT_SCHEMA_INVALID', 'fix-prompt-or-output-schema-before-retry', 'schema'];
    }
    return ['REQUEST_INVALID', 'inspect-request-before-retry', 'request'];
  }
  if (code === 'HTTP_401' || code === 'HTTP_403') return ['AUTH_FAILED', 'verify-credential-and-project', 'auth'];
  if (code === 'HTTP_429') return ['RATE_LIMITED', 'respect-retry-after-then-diagnose', 'rate-limit'];
  if (/^HTTP_5\d\d$/.test(code)) return ['PROVIDER_TRANSIENT', 'retry-later-with-backoff-after-diagnosis', 'transient'];

  return [code, 'inspect-error-before-any-retry', 'unknown'];
}

export function annotateAiError(error, context = {}) {
  if (!error || typeof error !== 'object') return error;
  const [category, recommendedAction, errorScope] = classify(error);
  error.category = category;
  error.recommendedAction = recommendedAction;
  error.errorScope = errorScope;
  if (context.provider && !error.provider) error.provider = context.provider;
  if (context.operation && !error.operation) error.operation = context.operation;
  return error;
}

export function aiErrorRecord(error) {
  return {
    code: error?.code || 'AI_ERROR',
    category: error?.category || null,
    recommendedAction: error?.recommendedAction || null,
    scope: error?.errorScope || null,
    message: error?.message || null,
    apiError: error?.apiError || null,
    finishReason: error?.finishReason || null,
  };
}
