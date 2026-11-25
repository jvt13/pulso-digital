import {normalize} from './common.mjs';
const has=(s,t)=>(' '+s+' ').includes(' '+normalize(t)+' ');
export function classify(signals,config){
  const topic=normalize(signals.map(s=>s.topic).join(' '));let terms=topic;
  for(const [alias,value] of Object.entries(config.aliases))if(has(topic,alias))terms+=' '+normalize(value);
  const negatives=config.offTopic.filter(t=>has(topic,t));const matches=[];
  for(const rule of config.rules){const blocked=rule.negative.filter(t=>has(terms,t));const found=Object.entries(rule.terms).filter(([t])=>has(terms,t));let weight=found.reduce((s,[,w])=>s+w,0);
    if(blocked.length)weight=0;
    // A editoria do feed é contexto fraco; sozinha não transforma título genérico em pauta.
    const context=signals.some(s=>s.providerType!=='google-trends'&&s.suggestedCategory===rule.category)?1:0;
    if(found.length)matches.push({category:rule.category,weight:blocked.length?0:weight+context,terms:found.map(([t])=>t),context,negativeRules:blocked});
  }
  matches.sort((a,b)=>b.weight-a.weight);const best=matches[0];
  if(!best||best.weight<config.minimum)return {category:null,relevance:0,outOfScope:true,reason:negatives.length?'Fora do escopo: '+negatives.join(', '):matches.some(r=>r.negativeRules.length)?'Regra negativa impede classificação: '+matches.flatMap(r=>r.negativeRules).join(', '):'Sem contexto editorial suficiente; termos ausentes ou ambíguos.',rules:matches,negativeTerms:negatives};
  // Uma conexão explícita com editoria é necessária mesmo quando há assunto popular fora de escopo.
  const penalty=negatives.length?0.5:1;return {category:best.category,relevance:Math.min(1,best.weight/5)*penalty,outOfScope:false,reason:`${best.category}: regras ${best.terms.join(', ')}; contexto de feed ${best.context}.`+(negatives.length?' Conexão mista com assunto fora do escopo; prioridade reduzida.':''),rules:matches,negativeTerms:negatives};
}
