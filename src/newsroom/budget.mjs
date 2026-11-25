import {check} from './common.mjs';
const REQUEST_OVERHEAD_TOKENS=800;
export function estimateTokens(text,maxOutputTokens){return Math.ceil(text.length/3)+REQUEST_OVERHEAD_TOKENS+maxOutputTokens;}
export function usageSummary(state,now){const day=now.slice(0,10),month=now.slice(0,7);const charged=e=>e.chargedTokens??e.reservedTokens;const provider={},operation={};for(const e of state.usage){const p=e.provider||'unknown',o=e.operation||'write';provider[p]=(provider[p]||0)+charged(e);operation[o]=(operation[o]||0)+charged(e);}return {dayTokens:state.usage.filter(e=>e.at.startsWith(day)).reduce((n,e)=>n+charged(e),0),monthTokens:state.usage.filter(e=>e.at.startsWith(month)).reduce((n,e)=>n+charged(e),0),calls:state.usage.length,incomplete:state.usage.filter(e=>e.status!=='complete').length,byProvider:provider,byOperation:operation};}
export function reserve(state,config,{topicId,provider,model,prompt,now,operation='write',taskId=null,maxOutputTokens=config.maxOutputTokens,maxInputTokens=config.maxInputTokens,maxCallsPerTopic=operation==='review'?(config.review?.maxCallsPerTopic??3):config.maxAiCallsPerTopic}){
  const held=estimateTokens(prompt,maxOutputTokens),summary=usageSummary(state,now);
  check(held<=maxInputTokens+maxOutputTokens,'TOKEN_LIMIT','Prompt acima do limite.');
  check(held<=config.maxTokensPerMinute,'TOKEN_LIMIT','Requisição excede o teto interno por minuto.');
  const minuteStart=Date.parse(now)-60000;
  const recent=state.usage.filter(e=>Date.parse(e.at)>minuteStart&&Date.parse(e.at)<=Date.parse(now));
  const minuteTokens=recent.reduce((n,e)=>n+(e.chargedTokens??e.reservedTokens),0);
  check(minuteTokens+held<=config.maxTokensPerMinute,'RATE_LIMIT','Aguarde a janela de um minuto antes de outra chamada IA.');
  check(!recent.length||Date.parse(now)-Math.max(...recent.map(e=>Date.parse(e.at)))>=config.minAiIntervalMs,'RATE_LIMIT','Aguarde o intervalo mínimo entre chamadas IA.');
  check(summary.dayTokens+held<=config.maxDailyTokens,'BUDGET','Limite diário interno excedido.');
  check(state.usage.filter(e=>e.topicId===topicId&&(e.operation||'write')===operation).length<maxCallsPerTopic,'BUDGET','Limite de chamadas da pauta excedido.');
  check(config.paidProvidersEnabled===false&&config.maxMonthlySpendUsd===0,'PAID_BLOCKED','Serviços pagos bloqueados.');
  const entry={id:'call-'+crypto.randomUUID(),topicId,provider,model,operation,taskId,at:now,reservedTokens:held,chargedTokens:held,status:'reserved',actualTokens:null};state.usage.push(entry);return entry;
}
import crypto from 'node:crypto';
export function finish(entry,result,error){entry.status=error?'incomplete':'complete';entry.finishedAt=new Date().toISOString();entry.errorCode=error?.code||null;entry.errorDetails=error?.apiError??null;entry.finishReason=error?.finishReason??null;entry.finishMessage=error?.finishMessage??null;entry.requestId=error?.requestId??result?.requestId??null;entry.durationMs=result?.durationMs??error?.durationMs??null;const usage=result?.usage??error?.usage??null;entry.inputTokens=usage?.inputTokens??null;entry.outputTokens=usage?.outputTokens??null;entry.reasoningTokens=usage?.reasoningTokens??null;entry.rateLimits=result?.rateLimits??error?.rateLimits??null;entry.retryAfterSeconds=error?.retryAfterSeconds??null;const tokens=usage?.totalTokens;if(Number.isInteger(tokens)&&tokens>=0){entry.actualTokens=tokens;entry.chargedTokens=error?Math.max(entry.reservedTokens,tokens):tokens;}else entry.chargedTokens=entry.reservedTokens;return entry;}
