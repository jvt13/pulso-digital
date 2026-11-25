import {destination,requestBytes,targetUrl} from '../radar/security.mjs';
import {retryAfter} from '../radar/collector.mjs';
import {check,hash} from './common.mjs';
import {extractHtml} from './extractor.mjs';
import {describeEvidence} from './evidence-quality.mjs';

export function sourceUrls(topic,extra=[],limit=4){
  const original=topic.signals.map(s=>s.url).filter(Boolean),urls=[...original.slice(0,2),...extra,...original.slice(2)];
  const seen=new Set();return urls.filter(u=>{try{const parsed=new URL(u);if(parsed.protocol!=='https:'||parsed.username||parsed.password||seen.has(parsed.href))return false;seen.add(parsed.href);return true;}catch{return false;}}).slice(0,limit);
}
export function robotsAllows(text,url,userAgent='PulsoDigitalNewsroom'){
  const target=new URL(url),lines=text.split(/\r?\n/);let applies=false,matched=false,best=-1,allow=true;
  for(const raw of lines){const line=raw.split('#')[0].trim();if(!line)continue;const m=/^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(line);if(!m)continue;const key=m[1].toLowerCase(),value=m[2].trim();if(key==='user-agent'){applies=value==='*'||value.toLowerCase()===userAgent.toLowerCase();continue;}if(!applies||!value)continue;const pattern=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\\\*/g,'.*');let re;try{re=new RegExp('^'+pattern.replace(/\\\$$/,'$'));}catch{continue;}if(re.test(target.pathname)){matched=true;if(value.length>=best){best=value.length;allow=key==='allow';}}}
  return !matched||allow;
}
export async function fetchAllowed(url,config,{resolve,request,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=Date.now}={}){
  const hosts=config.allowedHosts;targetUrl(url,hosts);let current=url,redirects=0,retries=0;
  while(true){let response;try{const dest=await destination(current,hosts,{resolve,timeoutMs:config.timeoutMs});response=await requestBytes(dest,{'user-agent':'PulsoDigitalNewsroom/1.0 (+https://github.com/jvt13/pulso-digital)','accept':'text/html,text/plain','accept-encoding':'identity'},config,request);}catch(e){if(retries++<config.retries){await sleep(config.backoffMs*2**(retries-1));continue;}throw e;}
    if([301,302,303,307,308].includes(response.status)){check(++redirects<=config.maxRedirects,'REDIRECT_LIMIT','Redirecionamentos demais.');current=new URL(response.headers.location||'',current).href;targetUrl(current,hosts);continue;}
    if(response.status===429||response.status>=500){const requestedWait=retryAfter(response.headers['retry-after'],clock());const delay=Math.max(config.backoffMs*2**retries,requestedWait);if(retries++<config.retries&&delay<=config.maxWaitMs){await sleep(delay);continue;}check(false,'HTTP_'+response.status,'Fonte indisponível após limite de tentativas.');}
    check(response.status===200,'HTTP_'+response.status,'Fonte indisponível.');return {...response,finalUrl:current,checkedAt:new Date(clock()).toISOString()};
  }
}
export async function research(topic,config,{extraUrls=[],dependencies={},cache={}}={}){
  check(topic?.schemaVersion==='1.1'&&topic.candidateType!=='broad-topic'&&topic.candidateType!=='insufficient-context','TOPIC','Pauta não elegível para pesquisa/redação.');
  const urls=sourceUrls(topic,extraUrls,config.maxSourcesPerTopic),sources=[],errors=[],evidence=[],nextCache={...cache};
  const hosts=config.allowedHosts;nextCache.__hosts??={};
  for(const originalUrl of urls){
    try{
      targetUrl(originalUrl,hosts);
      const host=new URL(originalUrl).hostname,cached=nextCache[originalUrl];
      if(nextCache.__hosts[host]&&Date.now()<Date.parse(nextCache.__hosts[host]))check(false,'SOURCE_INTERVAL','Intervalo mínimo da fonte ainda não terminou.');
      const origin=new URL(originalUrl).origin,robotsUrl=origin+'/robots.txt';
      const robots=await fetchAllowed(robotsUrl,config,dependencies);
      check(/text\/plain/i.test(robots.headers['content-type']||''),'ROBOTS','robots.txt indisponível em texto; fonte bloqueada por cautela.');
      const robotsText=new TextDecoder('utf-8',{fatal:true}).decode(robots.bytes);
      check(robotsAllows(robotsText,originalUrl),'ROBOTS','robots.txt não permite a consulta.');
      let page;
      if(cached&&!/no-cache|no-store/i.test(cached.cacheControl||'')&&Date.now()-Date.parse(cached.checkedAt)<config.cacheTtlMs)page=cached;
      else{
        const response=await fetchAllowed(originalUrl,config,dependencies);
        check(/text\/html/i.test(response.headers['content-type']||''),'CONTENT_TYPE','Somente HTML permitido nesta etapa.');
        const extracted=extractHtml(response.bytes,response.finalUrl);
        page={...extracted,checkedAt:response.checkedAt,httpStatus:response.status,cacheControl:response.headers['cache-control']||'',originalUrl};
        if(!/no-store/i.test(page.cacheControl))nextCache[originalUrl]=page;
        nextCache.__hosts[host]=new Date(Date.now()+config.minIntervalMs).toISOString();
      }
      const sourceId='fonte-'+hash(originalUrl).slice(0,16),signal=topic.signals.find(s=>s.url===originalUrl),organization=signal?.organization||new URL(originalUrl).hostname;
      const record={id:sourceId,originalUrl,finalUrl:page.url,organization,title:page.title,publishedAt:page.dateValid,checkedAt:page.checkedAt,type:signal?'primary-organization':'unclassified-manual',httpStatus:page.httpStatus,cached:page===cached,contentHash:page.contentHash,limitations:[signal?'Fonte da própria organização; declarações não verificadas independentemente.':'URL adicional do operador; independência e natureza exigem revisão humana.']};
      sources.push(record);
      page.excerpts.forEach((excerpt,i)=>{const detail=page.excerptDetails?.[i]||describeEvidence(excerpt);evidence.push({id:'evid-'+hash([sourceId,i,excerpt]).slice(0,20),sourceId,excerpt,hash:hash(excerpt),classification:'attributed',completeness:detail.complete?'complete':'truncated',truncated:Boolean(detail.truncated),excerptChars:detail.chars,roles:detail.roles,checkedAt:record.checkedAt});});
    }catch(e){errors.push({url:originalUrl,code:e.code||'RESEARCH',message:e.message});}
  }
  return {schemaVersion:'1.0',topicId:topic.id,topic:topic.topic,category:topic.suggestedCategory,createdAt:new Date().toISOString(),centralEvent:topic.topic,centralEventStatus:'Título de pauta; acontecimento não verificado.',eventDate:null,people:[],organizations:[...new Set(sources.map(s=>s.organization))],confirmed:[],attributed:evidence.map(e=>({evidenceId:e.id,sourceId:e.sourceId})),expectations:[],rumors:[],conflicts:[],missing:['Confirmação factual independente e contexto brasileiro requerem revisão.'],brazilContext:null,angles:[],sources,evidence,errors,insufficient:evidence.length===0||evidence.map(e=>e.excerpt).join(' ').length<config.minEvidenceChars,cache:nextCache};
}
