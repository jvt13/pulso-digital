import {normalize,referenceUrl} from './common.mjs';
export function similarity(a,b){const A=new Set(normalize(a).split(' ').filter(t=>t.length>1)),B=new Set(normalize(b).split(' ').filter(t=>t.length>1));const intersection=[...A].filter(t=>B.has(t)).length;return A.size+B.size?intersection/(A.size+B.size-intersection):0;}
const numbered=s=>normalize(s).split(' ').filter(t=>/\d/.test(t)).sort().join(' ');
export function sameEvent(a,b,config){
  if(a.provider===b.provider&&a.region===b.region&&a.id===b.id)return true;
  if(a.url&&b.url&&a.providerType!=='google-trends'&&b.providerType!=='google-trends'&&referenceUrl(a.url)===referenceUrl(b.url))return true;
  const da=Date.parse(a.feedPublishedAt),db=Date.parse(b.feedPublishedAt);const recent=Number.isFinite(da)&&Number.isFinite(db)&&Math.abs(da-db)<=config.eventWindowHours*3600000;
  if(!recent)return false;
  if(a.normalizedTopic===b.normalizedTopic)return true;
  return numbered(a.topic)===numbered(b.topic)&&similarity(a.topic,b.topic)>=config.titleSimilarity&&normalize(a.topic).split(' ').length>=5&&normalize(b.topic).split(' ').length>=5;
}
export function publishedReferences(topic,signals,articles,threshold){
  const urls=new Set(signals.flatMap(s=>[s.url,...s.relatedNews.map(n=>n.url)]).filter(Boolean).map(referenceUrl));
  return articles.flatMap(a=>{const exact=normalize(a.title)===normalize(topic);const similar=similarity(a.title,topic)>=threshold;const sameSource=a.sources?.some(s=>urls.has(referenceUrl(s.url)));
    return exact||similar||sameSource?[{kind:exact?'published-exact':'possible-update',slug:a.slug,title:a.title,reason:exact?'Título normalizado idêntico.':similar?'Título semelhante; revisão necessária.':'Referência compartilhada; pode ser novo acontecimento, não é duplicidade automática.'}]:[];});
}
