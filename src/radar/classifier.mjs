import {normalize} from './common.mjs';
export const hasTerm=(text,term)=>(' '+normalize(text)+' ').includes(' '+normalize(term)+' ');
export function hasVersion(text,entity){const words=normalize(text).split(' '),parts=normalize(entity).split(' ');return words.some((_,i)=>parts.every((p,j)=>words[i+j]===p)&&/^v?\d+$/.test(words[i+parts.length]||''));}

export function classify(signals,config){
  const title=normalize(signals.map(s=>s.topic).join(' '));
  const related=normalize(signals.flatMap(s=>[...(s.relatedTerms||[]),...(s.relatedNews||[]).map(n=>n.title||'')]).join(' '));
  let terms=title;
  for(const [alias,value] of Object.entries(config.aliases))if(hasTerm(title,alias))terms+=' '+normalize(value);
  const negatives=config.offTopic.filter(t=>hasTerm(title,t));
  const administrative=(config.administrative||[]).filter(t=>hasTerm(title,t));
  const matches=[];
  for(const rule of config.rules){
    const blocked=rule.negative.filter(t=>hasTerm(terms,t));
    const found=Object.entries(rule.terms).filter(([t])=>hasTerm(terms,t));
    const contextual=(config.contextualRules||[]).filter(r=>r.category===rule.category).flatMap(r=>{
      const entities=r.entities.filter(e=>hasTerm(terms,e));if(!entities.length)return [];
      const titleTerms=r.terms.filter(t=>hasTerm(terms,t)),relatedTerms=r.terms.filter(t=>hasTerm(related,t));
      const sourceContext=signals.some(s=>s.providerType!=='google-trends'&&r.sourceCategories.includes(s.suggestedCategory));
      const version=!!r.version&&entities.some(e=>hasVersion(terms,e));
      return titleTerms.length||relatedTerms.length||sourceContext||version?[{id:r.id,entities,titleTerms,relatedTerms,sourceContext,version,weight:r.weight}]:[];
    });
    // Nomes fracos de organizações não ganham categoria apenas pelo bônus do feed.
    const substantive=found.some(([,weight])=>weight>=2)||contextual.length>0;
    const context=substantive&&signals.some(s=>s.providerType!=='google-trends'&&s.suggestedCategory===rule.category)?1:0;
    const weight=blocked.length||!substantive?0:Math.max(found.reduce((sum,[,v])=>sum+v,0),...contextual.map(r=>r.weight),0)+context;
    if(found.length||contextual.length)matches.push({category:rule.category,weight,terms:found.map(([t])=>t),context,negativeRules:blocked,contextual});
  }
  matches.sort((a,b)=>b.weight-a.weight);const best=matches[0];
  const broadCategory=config.broadEntities?.[title]||null;
  if(!best||best.weight<config.minimum){
    const reason=broadCategory?'Entidade reconhecida somente como tema amplo para descoberta; não é acontecimento contextualizado.':negatives.length?'Fora do escopo: '+negatives.join(', '):matches.some(r=>r.negativeRules.length)?'Regra negativa impede classificação: '+matches.flatMap(r=>r.negativeRules).join(', '):'Sem contexto editorial suficiente; termos ausentes ou ambíguos.';
    return {category:null,relevance:broadCategory?0.2:0,outOfScope:!broadCategory,discoveryCategory:broadCategory,reason,rules:matches,negativeTerms:negatives,administrative,version:config.version||'1.0.0'};
  }
  const penalty=negatives.length?0.5:1;
  let relevance=Math.min(1,best.weight/5)*penalty;
  if(administrative.length)relevance=Math.min(relevance,config.administrativeRelevanceCap);
  return {category:best.category,relevance,outOfScope:false,reason:`${best.category}: termos ${best.terms.join(', ')||'contextuais'}; regras ${(best.contextual||[]).map(r=>r.id).join(', ')||'lexicais'}; contexto de feed ${best.context}.`+(administrative.length?' Comunicação administrativa/institucional: '+administrative.join(', ')+'.':negatives.length?' Conexão mista fora do escopo; relevância reduzida.':''),rules:matches,negativeTerms:negatives,administrative,version:config.version||'1.0.0'};
}
