import {check,categories,normalize} from './common.mjs';
export const states=['new','queued','deferred','dismissed'];
export function validateTopic(t){
  check(t&&t.schemaVersion==='1.0'&&/^pauta-[a-f0-9]{24}$/.test(t.id),'TOPIC_CONTRACT','Contrato/ID de pauta inválido.');
  check(typeof t.topic==='string'&&t.topic.length>0&&t.normalizedTopic===normalize(t.topic),'TOPIC_CONTRACT','Assunto inválido.');
  check(t.suggestedCategory===null||categories.includes(t.suggestedCategory),'TOPIC_CONTRACT','Categoria inválida.');
  check(states.includes(t.status)&&Number.isFinite(t.score)&&t.score>=0&&t.score<=100&&['alta','media','baixa'].includes(t.priority),'TOPIC_CONTRACT','Estado/score inválido.');
  for(const key of ['firstSeenAt','lastSeenAt','collectedAt'])check(typeof t[key]==='string'&&Number.isFinite(Date.parse(t[key])),'TOPIC_CONTRACT','Data de pauta inválida.');
  check(t.firstSeenAt<=t.lastSeenAt&&t.collectedAt<=t.lastSeenAt,'TOPIC_CONTRACT','Datas incoerentes.');
  for(const key of ['relatedTerms','signals','sourceReferences','duplicateReferences','researchQueries','history'])check(Array.isArray(t[key]),'TOPIC_CONTRACT','Lista obrigatória ausente.');
  check(typeof t.classificationReason==='string'&&t.scoreBreakdown&&typeof t.scoreBreakdown.coverage==='number','TOPIC_CONTRACT','Explicação ausente.');
  check(!Object.hasOwn(t,'article')&&!Object.hasOwn(t,'approval')&&!Object.hasOwn(t,'body'),'TOPIC_CONTRACT','Pauta não é matéria editorial.');return t;
}
export function exportTopic(t){validateTopic(t);const {history,...output}=t;return {...output,purpose:'Candidato para pesquisa; sem verificação factual, redação, autorização de imagem ou aprovação editorial.'};}
