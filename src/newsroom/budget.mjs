import {check} from './common.mjs';
export function estimateTokens(text,maxOutputTokens){return Math.ceil(text.length/3)+maxOutputTokens;}
export function usageSummary(state,now){const day=now.slice(0,10),month=now.slice(0,7);const charged=e=>e.chargedTokens??e.reservedTokens;return {dayTokens:state.usage.filter(e=>e.at.startsWith(day)).reduce((n,e)=>n+charged(e),0),monthTokens:state.usage.filter(e=>e.at.startsWith(month)).reduce((n,e)=>n+charged(e),0),calls:state.usage.length,incomplete:state.usage.filter(e=>e.status!=='complete').length};}
export function reserve(state,config,{topicId,provider,model,prompt,now}){
  const held=estimateTokens(prompt,config.maxOutputTokens),summary=usageSummary(state,now);
  check(held<=config.maxInputTokens+config.maxOutputTokens,'TOKEN_LIMIT','Prompt acima do limite.');
  check(summary.dayTokens+held<=config.maxDailyTokens,'BUDGET','Limite diário interno excedido.');
  check(state.usage.filter(e=>e.topicId===topicId).length<config.maxAiCallsPerTopic,'BUDGET','Limite de chamadas da pauta excedido.');
  check(config.paidProvidersEnabled===false&&config.maxMonthlySpendUsd===0,'PAID_BLOCKED','Serviços pagos bloqueados.');
  const entry={id:'call-'+crypto.randomUUID(),topicId,provider,model,at:now,reservedTokens:held,chargedTokens:held,status:'reserved',actualTokens:null};state.usage.push(entry);return entry;
}
import crypto from 'node:crypto';
export function finish(entry,result,error){entry.status=error?'incomplete':'complete';entry.finishedAt=new Date().toISOString();entry.errorCode=error?.code||null;const tokens=result?.usage?.totalTokens;if(Number.isInteger(tokens)&&tokens>=0){entry.actualTokens=tokens;entry.chargedTokens=error?Math.max(entry.reservedTokens,tokens):tokens;}else entry.chargedTokens=entry.reservedTokens;return entry;}
