import {check} from './common.mjs';
const REQUEST_OVERHEAD_TOKENS=800;
export function estimateTokens(text,maxOutputTokens){return Math.ceil(text.length/3)+REQUEST_OVERHEAD_TOKENS+maxOutputTokens;}
export function usageSummary(state,now){const day=now.slice(0,10),month=now.slice(0,7);const charged=e=>e.chargedTokens??e.reservedTokens;return {dayTokens:state.usage.filter(e=>e.at.startsWith(day)).reduce((n,e)=>n+charged(e),0),monthTokens:state.usage.filter(e=>e.at.startsWith(month)).reduce((n,e)=>n+charged(e),0),calls:state.usage.length,incomplete:state.usage.filter(e=>e.status!=='complete').length};}
export function reserve(state,config,{topicId,provider,model,prompt,now}){
  const held=estimateTokens(prompt,config.maxOutputTokens),summary=usageSummary(state,now);
  check(held<=config.maxInputTokens+config.maxOutputTokens,'TOKEN_LIMIT','Prompt acima do limite.');
  check(held<=config.maxTokensPerMinute,'TOKEN_LIMIT','Requisição excede o teto interno por minuto.');
  const minuteStart=Date.parse(now)-60000;
  const recent=state.usage.filter(e=>Date.parse(e.at)>minuteStart&&Date.parse(e.at)<=Date.parse(now));
  const minuteTokens=recent.reduce((n,e)=>n+(e.chargedTokens??e.reservedTokens),0);
  check(minuteTokens+held<=config.maxTokensPerMinute,'RATE_LIMIT','Aguarde a janela de um minuto antes de outra chamada IA.');
  check(!recent.length||Date.parse(now)-Math.max(...recent.map(e=>Date.parse(e.at)))>=config.minAiIntervalMs,'RATE_LIMIT','Aguarde o intervalo mínimo entre chamadas IA.');
  check(summary.dayTokens+held<=config.maxDailyTokens,'BUDGET','Limite diário interno excedido.');
  check(state.usage.filter(e=>e.topicId===topicId).length<config.maxAiCallsPerTopic,'BUDGET','Limite de chamadas da pauta excedido.');
  check(config.paidProvidersEnabled===false&&config.maxMonthlySpendUsd===0,'PAID_BLOCKED','Serviços pagos bloqueados.');
  const entry={id:'call-'+crypto.randomUUID(),topicId,provider,model,at:now,reservedTokens:held,chargedTokens:held,status:'reserved',actualTokens:null};state.usage.push(entry);return entry;
}
import crypto from 'node:crypto';
export function finish(entry,result,error){entry.status=error?'incomplete':'complete';entry.finishedAt=new Date().toISOString();entry.errorCode=error?.code||null;entry.errorDetails=error?.apiError??null;entry.requestId=error?.requestId??result?.requestId??null;entry.durationMs=result?.durationMs??error?.durationMs??null;entry.inputTokens=result?.usage?.inputTokens??null;entry.outputTokens=result?.usage?.outputTokens??null;entry.reasoningTokens=result?.usage?.reasoningTokens??null;entry.rateLimits=result?.rateLimits??error?.rateLimits??null;entry.retryAfterSeconds=error?.retryAfterSeconds??null;const tokens=result?.usage?.totalTokens;if(Number.isInteger(tokens)&&tokens>=0){entry.actualTokens=tokens;entry.chargedTokens=error?Math.max(entry.reservedTokens,tokens):tokens;}else entry.chargedTokens=entry.reservedTokens;return entry;}
