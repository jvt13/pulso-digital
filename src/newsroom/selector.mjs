import {RadarRepository} from '../radar/repository.mjs';
import {RadarEngine} from '../radar/engine.mjs';
import {check} from './common.mjs';

export function candidates(root,newsroomState,config,{limit=config.maxTopicsPerRun,category=null}={}){
  check(Number.isInteger(limit)&&limit>0&&limit<=config.maxTopicsPerRun,'LIMIT','Limite de pautas inválido.');
  const radar=new RadarRepository(root),radarState=radar.read(),engine=new RadarEngine(radar);
  // Exportação 1.1 do radar; o snapshot privado fornece também decisões manuais.
  const exported=engine.export({mode:'editorial',limit:2000}).topics;
  const eligibleIds=new Set(exported.map(t=>t.id));
  const choices=[];
  for(const topic of radarState.topics){
    const reasons=[];
    if(!eligibleIds.has(topic.id))reasons.push('Fora do ranking editorial específico/atual.');
    if(topic.status==='dismissed'||topic.status==='deferred')reasons.push('Descartada ou adiada.');
    if(topic.statusDecision?.origin==='operator'&&topic.status==='dismissed')reasons.push('Descarte manual preservado.');
    if(category&&topic.suggestedCategory!==category)reasons.push('Categoria diferente.');
    const prior=newsroomState.topics[topic.id];
    if(prior&&['imported','review-required','research-insufficient'].includes(prior.status)&&prior.radarAssessmentHash===topic.assessmentHash)reasons.push('Pauta concluída ou aguardando intervenção humana sem alteração relevante.');
    if(topic.candidateType==='broad-topic'||topic.candidateType==='insufficient-context')reasons.push('Tema amplo/contexto insuficiente.');
    const organization=topic.signals?.[0]?.organization||'desconhecida';
    choices.push({id:topic.id,topic:topic.topic,category:topic.suggestedCategory,organization,status:topic.status,editorialScore:topic.pulsoEditorial?.score||0,trendsScore:topic.pulsoTrends?.score||0,manual:topic.status==='queued',eligible:reasons.length===0,reasons,assessmentHash:topic.assessmentHash});
  }
  choices.sort((a,b)=>Number(b.manual)-Number(a.manual)||b.editorialScore-a.editorialScore||a.id.localeCompare(b.id));
  const selected=[],byCategory=new Map(),byOrg=new Map();
  for(const diversity of [true,false])for(const c of choices.filter(x=>x.eligible&&!selected.includes(x))){
    if(selected.length>=limit)break;
    if(diversity&&byCategory.has(c.category))continue;
    if((byCategory.get(c.category)||0)>=config.maxTopicsPerCategory)continue;
    if((byOrg.get(c.organization)||0)>=config.maxTopicsPerOrganization)continue;
    selected.push(c);byCategory.set(c.category,(byCategory.get(c.category)||0)+1);byOrg.set(c.organization,(byOrg.get(c.organization)||0)+1);
  }
  for(const c of choices.filter(x=>x.eligible&&!selected.includes(x))){c.eligible=false;c.reasons.push('Limite ou diversidade desta execução.');}
  return {selected,decisions:choices};
}
