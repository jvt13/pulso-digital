import {check,categories,normalize} from './common.mjs';
export const states=['new','queued','deferred','dismissed'];
export function validateTopic(t){
  check(t&&['1.0','1.1'].includes(t.schemaVersion)&&/^pauta-[a-f0-9]{24}$/.test(t.id),'TOPIC_CONTRACT','Contrato/ID de pauta inválido.');
  check(typeof t.topic==='string'&&t.topic.length>0&&t.normalizedTopic===normalize(t.topic),'TOPIC_CONTRACT','Assunto inválido.');
  check(t.suggestedCategory===null||categories.includes(t.suggestedCategory),'TOPIC_CONTRACT','Categoria inválida.');
  check(states.includes(t.status)&&Number.isFinite(t.score)&&t.score>=0&&t.score<=100&&['alta','media','baixa'].includes(t.priority),'TOPIC_CONTRACT','Estado/score inválido.');
  for(const key of ['firstSeenAt','lastSeenAt','collectedAt'])check(typeof t[key]==='string'&&Number.isFinite(Date.parse(t[key])),'TOPIC_CONTRACT','Data de pauta inválida.');
  check(t.firstSeenAt<=t.lastSeenAt&&t.collectedAt<=t.lastSeenAt,'TOPIC_CONTRACT','Datas incoerentes.');
  for(const key of ['relatedTerms','signals','sourceReferences','duplicateReferences','researchQueries','history'])check(Array.isArray(t[key]),'TOPIC_CONTRACT','Lista obrigatória ausente.');
  check(typeof t.classificationReason==='string'&&t.scoreBreakdown&&typeof t.scoreBreakdown.coverage==='number','TOPIC_CONTRACT','Explicação ausente.');
  check(!Object.hasOwn(t,'article')&&!Object.hasOwn(t,'approval')&&!Object.hasOwn(t,'body'),'TOPIC_CONTRACT','Pauta não é matéria editorial.');
  if(t.schemaVersion==='1.1'){
    check(['broad-topic','specific-event','possible-update','insufficient-context'].includes(t.candidateType)&&t.specificity&&typeof t.ruleVersion==='string'&&/^[a-f0-9]{64}$/.test(t.assessmentHash),'TOPIC_CONTRACT','Avaliação contextual inválida.');
    for(const key of ['pulsoTrends','pulsoEditorial'])check(t[key]&&Number.isFinite(t[key].score)&&t[key].score>=0&&t[key].score<=100&&typeof t[key].eligible==='boolean'&&Number.isFinite(t[key].coverage)&&t[key].coverage>=0&&t[key].coverage<=100,'TOPIC_CONTRACT','Indicador inválido.');
  }return t;
}
const legacyFields=['id','topic','normalizedTopic','suggestedCategory','relatedTerms','signals','sourceReferences','firstSeenAt','lastSeenAt','collectedAt','score','scoreBreakdown','priority','status','statusReason','classificationReason','classificationSignals','duplicateReferences','researchQueries'];
export function exportTopic(t,{version='1.0'}={}){validateTopic(t);check(version==='1.0'||version==='1.1'&&t.schemaVersion==='1.1','MIGRATION_REQUIRED','Execute reclassify antes de exportar pautas legadas como 1.1.');const {history,...output}=t;const data=version==='1.0'?Object.fromEntries(legacyFields.filter(k=>Object.hasOwn(t,k)).map(k=>[k,t[k]])):output;return {...data,schemaVersion:version,purpose:'Candidato para pesquisa; sem verificação factual, redação, autorização de imagem ou aprovação editorial.'};}
