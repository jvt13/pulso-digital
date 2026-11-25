import {parseXml,children,child,text,plain} from '../xml.mjs';
import {check,date,referenceUrl} from '../common.mjs';
export const ATOM='http://www.w3.org/2005/Atom';
export function parseRss(bytes,source,limits){
  const root=parseXml(bytes,limits);let entries,atom=false;
  if(root.name==='rss'&&root.uri===''){const channel=child(root,'channel','');check(channel,'RSS_STRUCTURE','RSS sem channel.');entries=children(channel,'item','');}
  else{check(root.name==='feed'&&root.uri===ATOM,'RSS_STRUCTURE','Esperado RSS 2.0 ou Atom.');atom=true;entries=children(root,'entry',ATOM);}
  check(entries.length<=limits.itemsPerFeed,'ITEM_LIMIT','Itens demais no feed.');
  const warnings=[],items=[];
  for(const entry of entries){
    const uri=atom?ATOM:'';const topic=plain(text(child(entry,'title',uri)),limits.fieldChars);
    const link=atom?children(entry,'link',ATOM).find(n=>!n.attributes.rel||n.attributes.rel==='alternate')?.attributes.href:text(child(entry,'link',''));
    const rawDate=text(child(entry,atom?'published':'pubDate',uri))||text(child(entry,atom?'updated':'date',atom?ATOM:'http://purl.org/dc/elements/1.1/'));
    const publishedAt=date(rawDate);if(rawDate&&!publishedAt)warnings.push({code:'INVALID_DATE',topic,rawDate:rawDate.slice(0,100)});
    if(!topic){warnings.push({code:'MISSING_TITLE'});continue;}
    const url=referenceUrl(link);if(!url)warnings.push({code:'MISSING_OR_UNSAFE_LINK',topic});
    items.push({topic,url,originalId:text(child(entry,atom?'id':'guid',uri)).slice(0,limits.fieldChars)||null,feedPublishedAt:publishedAt,rawDate:rawDate.slice(0,100)||null,relatedTerms:[],relatedNews:[],approximateTraffic:null,metadata:{format:atom?'atom':'rss2'}});
  }
  return {items,warnings};
}
