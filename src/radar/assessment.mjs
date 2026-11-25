import {classify} from './classifier.mjs';
import {specificity} from './specificity.mjs';
import {indicators} from './indicators.mjs';
import {publishedReferences} from './deduplication.mjs';
import {hash} from './common.mjs';

export function decisionOrigin(topic){
  if(topic.statusDecision?.origin)return topic.statusDecision.origin;
  const last=[...topic.history].reverse().find(h=>h.to===topic.status&&['status','dismiss','reopen'].includes(h.action));
  if(last?.actor==='operador-local')return 'operator';
  if(last?.actor==='radar-regras')return 'rules';
  return ['queued','deferred'].includes(topic.status)?'operator':topic.status==='dismissed'?'unknown':'none';
}
export function assessmentKey(topic,config,articles){return hash({signals:topic.signals,classification:config.classification,specificity:config.specificity,score:config.score,editorial:config.editorialScore,articles});}
export function assessTopic(topic,config,articles,now){
  const classification=classify(topic.signals,config.classification);
  const duplicates=publishedReferences(topic.topic,topic.signals,articles,config.deduplication.titleSimilarity);
  const candidate=specificity(topic.topic,classification,duplicates,config.specificity);
  const metrics=indicators(topic.signals,classification,duplicates,candidate,config,now);
  return {schemaVersion:'1.1',suggestedCategory:classification.category,classificationReason:classification.reason,classificationSignals:classification,duplicateReferences:duplicates,candidateType:candidate.type,specificity:candidate,ruleVersion:config.classification.version,assessmentHash:assessmentKey(topic,config,articles),assessmentAt:new Date(now).toISOString(),...metrics};
}
const originalAssessment=t=>({score:t.score,priority:t.priority,scoreBreakdown:structuredClone(t.scoreBreakdown),suggestedCategory:t.suggestedCategory,classificationReason:t.classificationReason,classificationSignals:structuredClone(t.classificationSignals||{}),ruleVersion:t.ruleVersion||'1.0.0',recordedAt:[...t.history].reverse().find(h=>h.action==='score')?.at||t.assessmentAt||null});
export function applyAssessment(topic,config,articles,now,{action='reclassify',force=false}={}){
  const key=assessmentKey(topic,config,articles);
  if(!force&&topic.assessmentHash===key)return null;
  const before={category:topic.suggestedCategory,status:topic.status,score:topic.score,candidateType:topic.candidateType||null,ruleVersion:topic.ruleVersion||'1.0.0'};
  const origin=decisionOrigin(topic),previous=topic.assessmentHash||topic.history.some(h=>h.action==='score')?originalAssessment(topic):null,at=new Date(now).toISOString();
  if(previous)topic.legacyAssessment??=previous;
  Object.assign(topic,assessTopic(topic,config,articles,now));
  if(origin==='rules'&&topic.status==='dismissed'&&!topic.classificationSignals.outOfScope){
    topic.status='new';topic.statusReason='Reabertura por regra contextual; requer pesquisa humana.';
    topic.history.push({at,action:'reopen',from:'dismissed',to:'new',reason:topic.statusReason,actor:'radar-regras',ruleVersion:topic.ruleVersion});
  }else if(origin!=='operator'&&origin!=='unknown'&&topic.status==='new'&&topic.classificationSignals.outOfScope){
    topic.status='dismissed';topic.statusReason=topic.classificationReason;
    topic.history.push({at,action:'dismiss',from:'new',to:'dismissed',reason:topic.statusReason,actor:'radar-regras',ruleVersion:topic.ruleVersion});
  }
  topic.statusDecision={origin:origin==='operator'||origin==='unknown'?origin:topic.status==='dismissed'?'rules':'none'};
  topic.history.push({at,action,actor:'radar-regras',ruleVersion:topic.ruleVersion,previousAssessment:previous,assessmentHash:key,score:topic.score,pulsoEditorial:topic.pulsoEditorial.score,candidateType:topic.candidateType,reason:topic.classificationReason});
  return {id:topic.id,topic:topic.topic,before,after:{category:topic.suggestedCategory,status:topic.status,score:topic.score,candidateType:topic.candidateType,ruleVersion:topic.ruleVersion},manualDecisionPreserved:['operator','unknown'].includes(origin)};
}
export function rankingProjection(topic,config,now){
  // Só os indicadores novos são recalculados em leitura para não apresentar alta envelhecida.
  if(!topic.specificity)return topic;
  const {pulsoTrends,pulsoEditorial}=indicators(topic.signals,topic.classificationSignals,topic.duplicateReferences,topic.specificity,config,now);
  return {...topic,pulsoTrends,pulsoEditorial};
}
