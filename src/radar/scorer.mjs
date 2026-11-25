import {normalize} from './common.mjs';
const clamp=n=>Math.min(1,Math.max(0,n));
// Apenas um piso aproximado para faixa ordinal; nunca exposto como contagem exata.
export function trafficBand(raw,bands){if(typeof raw!=='string')return null;const s=normalize(raw);let minimum;const unit=/^([\d.,]+)\s*(mil|k|m|mi|million)?\s*\+?$/i.exec(raw.trim());if(!unit)return null;
  let number=unit[1];const suffix=(unit[2]||'').toLowerCase();if(suffix){number=number.replace(',','.');minimum=Number(number)*(suffix==='k'||suffix==='mil'?1000:1000000);}else minimum=Number(number.replace(/[.,]/g,''));
  if(!Number.isFinite(minimum))return null;return bands.find(b=>minimum>=b.minimum)?.value??null;
}
export function score(signals,classification,duplicates,config,now=Date.now()){
  const bands=signals.map(s=>({region:s.region,raw:s.approximateTraffic,value:trafficBand(s.approximateTraffic,config.bands)})).filter(s=>s.value!==null);
  // Maior faixa individual, sem somar volumes ou atribuir comparabilidade regional.
  const popularity=bands.length?Math.max(...bands.map(b=>b.value)):null;
  const dates=signals.map(s=>Date.parse(s.feedPublishedAt)).filter(d=>Number.isFinite(d)&&d<=now);
  const age=dates.length?Math.max(0,(now-Math.max(...dates))/3600000):null;
  const recency=age===null?null:2**(-age/config.halfLifeHours);
  const components={
    relevance:{value:classification.relevance,reason:classification.reason},
    popularity:{value:popularity,reason:bands.length?'Maior faixa ordinal individual; volumes aproximados mantidos por região, sem soma.':'Volume não informado; interesse desconhecido, não comprovadamente baixo.',signals:bands},
    recency:{value:recency,reason:age===null?'Sem data válida de feed; coleta não substitui data do acontecimento.':`Decaimento pela data mais recente do feed: ${age.toFixed(2)} h; não comprova início do evento.`},
    origin:{value:signals.length?Math.max(...signals.map(s=>s.weight)):0,reason:'Maior peso configurado de origem; quantidade de feeds/organizações não presume independência.'},
    novelty:{value:duplicates.some(d=>d.kind==='published-exact')?0:duplicates.some(d=>d.kind==='possible-update')?0.4:1,reason:'Novidade relativa ao acervo local publicado; não certifica originalidade.'}
  };
  let points=0,coverage=0;for(const [key,c] of Object.entries(components)){c.weight=config.weights[key];c.points=c.value===null?0:clamp(c.value)*c.weight;if(c.value!==null)coverage+=c.weight;points+=c.points;}
  const value=Math.max(0,Math.min(100,Math.round(points*100)/100));return {score:value,priority:value>=config.high?'alta':value>=config.medium?'media':'baixa',scoreBreakdown:{components,coverage,maximum:100,policy:'Soma ponderada sem redistribuir pesos ausentes. Componente indisponível contribui zero pontos, mas permanece desconhecido; cobertura explicitada. Pontuação não verifica fatos.'}};
}
