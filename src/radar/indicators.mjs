import {score} from './scorer.mjs';
const round=n=>Math.round(n*100)/100;
export function indicators(signals,classification,duplicates,specific,config,now=Date.now()){
  const legacy=score(signals,classification,duplicates,config.score,now),base=legacy.scoreBreakdown.components,c=config.editorialScore;
  const dates=signals.map(s=>Date.parse(s.feedPublishedAt)).filter(d=>Number.isFinite(d)&&d<=now);
  const age=dates.length?(now-Math.max(...dates))/3600000:null;
  const exact=duplicates.some(d=>d.kind==='published-exact');
  const origin=signals.some(s=>typeof s.provider==='string'&&s.provider.length>0&&typeof s.organization==='string'&&s.organization.length>0&&s.feedUrl);
  const specificEvent=['specific-event','possible-update'].includes(specific.type);
  const relevant=!!classification.category||specific.type==='broad-topic'&&!!specific.discoveryCategory;
  const trendsEligible=base.popularity.value!==null&&relevant&&specific.type!=='insufficient-context'&&!exact;
  const components={};let points=0,available=0;
  for(const [key,weight] of Object.entries(c.weights)){const value=key==='origin'&&!origin?null:base[key].value;const contribution=value===null?0:Math.min(1,Math.max(0,value))*weight;components[key]={value,weight,points:contribution,reason:key==='origin'&&!origin?'Origem não identificada; componente indisponível.':base[key].reason};points+=contribution;if(value!==null)available+=weight;}
  const value=round(points/c.denominator*100),coverage=round(available/c.denominator*100);
  const reasons=[];
  if(!specificEvent)reasons.push('Candidato não é acontecimento suficientemente específico.');
  if(classification.relevance<c.minHighRelevance)reasons.push('Relevância editorial abaixo do mínimo para alta.');
  if(age===null||age>c.maxHighAgeHours)reasons.push('Data ausente, futura ou além da janela de prioridade alta.');
  if(!origin||base.origin.value<c.minHighOrigin)reasons.push('Origem não identificada ou peso abaixo do mínimo.');
  if(exact)reasons.push('Duplicidade exata com matéria publicada.');
  if(coverage<c.minHighCoverage)reasons.push('Cobertura insuficiente dos componentes editoriais.');
  if(specific.administrative)reasons.push('Comunicação administrativa/institucional.');
  const rawPriority=value>=c.high?'alta':value>=c.medium?'media':'baixa';
  const editorialEligible=specificEvent&&!!classification.category&&!specific.administrative&&!exact;
  return {...legacy,
    pulsoTrends:{score:legacy.score,priority:legacy.priority,coverage:legacy.scoreBreakdown.coverage,eligible:trendsEligible,reason:trendsEligible?'Popularidade aproximada efetivamente fornecida por sinal, sem soma regional.':'Ranking exige popularidade válida e conexão editorial/descoberta contextualizada, sem duplicidade exata.',breakdown:legacy.scoreBreakdown,calculatedAt:new Date(now).toISOString()},
    pulsoEditorial:{score:value,priority:rawPriority==='alta'&&reasons.length?'media':rawPriority,rawPriority,coverage,availableWeight:available,denominator:c.denominator,components,eligible:editorialEligible,highEligible:reasons.length===0,highIneligibilityReasons:reasons,reason:'Potencial editorial independente de volume, sem comprovação factual/popularidade/receita.',calculatedAt:new Date(now).toISOString(),ageHours:age}
  };
}
