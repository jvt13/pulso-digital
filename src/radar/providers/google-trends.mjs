import {parseXml,child,children,text,plain} from '../xml.mjs';
import {check,date,referenceUrl} from '../common.mjs';
const HT='https://trends.google.com/trending/rss';
export function parseTrends(bytes,source,limits){
  const root=parseXml(bytes,limits);check(root.name==='rss'&&root.uri==='','RSS_STRUCTURE','Trends não retornou RSS.');const channel=child(root,'channel','');check(channel,'RSS_STRUCTURE','Trends sem channel.');
  const entries=children(channel,'item','');check(entries.length<=limits.itemsPerFeed,'ITEM_LIMIT','Itens demais.');const items=[],warnings=[];
  for(const entry of entries){const topic=plain(text(child(entry,'title','')),limits.fieldChars);if(!topic){warnings.push({code:'MISSING_TITLE'});continue;}
    const rawDate=text(child(entry,'pubDate',''));const feedPublishedAt=date(rawDate);if(rawDate&&!feedPublishedAt)warnings.push({code:'INVALID_DATE',topic});
    const relatedNews=children(entry,'news_item',HT).slice(0,20).map(n=>({title:plain(text(child(n,'news_item_title',HT)),limits.fieldChars),url:referenceUrl(text(child(n,'news_item_url',HT))),source:plain(text(child(n,'news_item_source',HT)),200)}));
    const relatedTerms=children(entry,'related_queries',HT).flatMap(n=>children(n,'query',HT).map(q=>plain(text(q),limits.fieldChars)));
    items.push({topic,url:referenceUrl(text(child(entry,'link',''))),originalId:text(child(entry,'guid','')).slice(0,limits.fieldChars)||null,feedPublishedAt,rawDate:rawDate.slice(0,100)||null,relatedTerms,relatedNews,approximateTraffic:plain(text(child(entry,'approx_traffic',HT)),80)||null,metadata:{format:'google-trends-rss',dateMeaning:'Data informada pelo feed; não comprova início da tendência.'}});
  }return {items,warnings};
}
