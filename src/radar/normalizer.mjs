import {hash,normalize,referenceUrl} from './common.mjs';
export function normalizeSignal(item,source,result){
  const identity=item.originalId|| (source.type==='google-trends'?normalize(item.topic):item.url||normalize(item.topic));
  return {id:'sig-'+hash([source.id,source.region,identity]).slice(0,24),topic:item.topic,normalizedTopic:normalize(item.topic),provider:source.id,providerType:source.type,organization:source.organization,region:source.region,language:source.language,weight:source.weight,suggestedCategory:source.suggestedCategory,originalId:item.originalId,feedUrl:source.url,url:referenceUrl(item.url),feedPublishedAt:item.feedPublishedAt,approximateTraffic:item.approximateTraffic,relatedTerms:item.relatedTerms,relatedNews:item.relatedNews,collectedAt:result.collectedAt,observedAt:result.observedAt,cached:result.cached,cacheMode:result.mode,metadata:{...item.metadata,rawDate:item.rawDate}};
}
