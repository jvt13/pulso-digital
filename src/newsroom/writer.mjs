import {check} from './common.mjs';
import {annotateAiError} from './ai-errors.mjs';
import {assertReviewHeadroom, estimateTokens, finish, reserve} from './budget.mjs';
import {generateGroq} from './providers/groq.mjs';
import {generateGemini} from './providers/gemini.mjs';
import {generateMock} from './providers/mock.mjs';
import {DRAFT_TRANSPORT_VERSION, buildTransportContext, reconstructDraft} from './transport.mjs';

export function prompt(dossier, root) {
  return buildTransportContext(dossier, root).prompt;
}

export async function writeWithBudget(
  repo,
  state,
  topicId,
  dossier,
  {
    provider = repo.config.provider,
    model = repo.config.models[provider],
    freeTierConfirmed = false,
    transport,
    fixture,
  } = {},
) {
  check(!dossier.insufficient, 'RESEARCH_INSUFFICIENT', 'Pesquisa insuficiente para redação.');
  check(['groq', 'gemini', 'mock'].includes(provider), 'PROVIDER', 'Provedor desconhecido.');
  if (provider !== 'mock') {
    check(freeTierConfirmed, 'FREE_TIER_UNCONFIRMED', 'Confirme modalidade gratuita antes de chamar IA real.');
    check(repo.config.paidProvidersEnabled === false && repo.config.maxMonthlySpendUsd === 0, 'PAID_BLOCKED', 'Provedor pago bloqueado.');
    check(model && typeof model === 'string', 'MODEL', 'Modelo não configurado.');
    check(process.env[provider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'], 'CREDENTIALS', 'Credencial ausente no ambiente local.');
  }

  const context = buildTransportContext(dossier, repo.root);
  const message = context.prompt;
  const maxOutputTokens = repo.config.maxOutputTokens;
  const projectedHold = estimateTokens(message, maxOutputTokens);
  try {
    assertReviewHeadroom(state, repo.config, repo.now(), projectedHold);
  } catch (error) {
    throw annotateAiError(error, {provider, operation: 'write'});
  }

  let entry;
  try {
    entry = reserve(state, repo.config, {
      topicId,
      provider,
      model: model || 'mock-sintetico',
      prompt: message,
      now: repo.now(),
      maxOutputTokens,
    });
  } catch (error) {
    throw annotateAiError(error, {provider, operation: 'write'});
  }
  repo.save(state);

  let response;
  let error;
  try {
    const common = {
      apiKey: process.env[provider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'],
      model,
      prompt: message,
      maxOutputTokens,
      timeoutMs: repo.config.aiTimeoutMs,
      transport,
      responseSchema: context.schema,
    };
    if (provider === 'groq') {
      response = await generateGroq({
        ...common,
        schemaName: 'pulso_draft_transport_v2',
        reasoningEffort: repo.config.reasoning?.groq || 'low',
      });
    } else if (provider === 'gemini') {
      response = await generateGemini({
        ...common,
        thinkingLevel: repo.config.reasoning?.gemini || 'minimal',
        operation: 'write',
      });
    } else {
      response = await generateMock({fixture});
    }
    check(!response.synthetic || provider === 'mock', 'SYNTHETIC', 'Resposta sintética incompatível.');
    const draft = provider === 'mock' ? response.value : reconstructDraft(response.value, context);
    return {
      response: {...response, value: draft},
      entry,
      transport: {
        version: DRAFT_TRANSPORT_VERSION,
        compact: provider !== 'mock',
        promptChars: context.promptChars,
        evidenceAliases: context.evidenceCount,
      },
    };
  } catch (caught) {
    error = annotateAiError(caught, {provider, operation: 'write'});
    throw error;
  } finally {
    finish(entry, response, error);
    repo.save(state);
  }
}
