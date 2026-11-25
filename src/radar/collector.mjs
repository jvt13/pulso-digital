import {destination,requestBytes,targetUrl} from './security.mjs';
import {parseRss} from './providers/rss.mjs';
import {parseTrends} from './providers/google-trends.mjs';
import {check,RadarError,hash} from './common.mjs';

export function retryAfter(value,now){if(value===undefined)return 0;if(/^\d+$/.test(String(value)))return Number(value)*1000;const n=Date.parse(value);return Number.isFinite(n)?Math.max(0,n-now):0;}
export async function collect(source,config,prior={},dependencies={}){
  const clock=dependencies.clock||Date.now,sleep=dependencies.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  const now=clock(),checkedAt=new Date(now).toISOString(),key=hash(JSON.stringify(source));
  targetUrl(source.url,source.allowedHosts);
  const cache=prior.cache?.key===key&&now-Date.parse(prior.cache.collectedAt)<=config.network.maxStaleMs?prior.cache:null;
  const base={sourceId:source.id,sourceName:source.name,region:source.region,url:source.url,checkedAt,attempts:[],warnings:[]};
  const reused=(mode,error=null)=>({...base,mode,error,items:cache?.items||[],collectedAt:cache?.collectedAt||null,observedAt:cache?.observedAt||null,cached:!!cache,cache:cache||null,nextAllowedAt:prior.nextAllowedAt||null});
  if(prior.nextAllowedAt&&now<Date.parse(prior.nextAllowedAt))return reused(cache?(cache.requiresRevalidation||now>=Date.parse(cache.expiresAt)?'stale':'cache'):'deferred');
  if(cache&&!cache.requiresRevalidation&&now<Date.parse(cache.expiresAt))return reused('cache');
  let finalUrl=source.url,redirects=0,retries=0,nextAllowed=now+config.network.minIntervalMs;
  const headers={'user-agent':'PulsoDigitalRadar/1.3 (+https://github.com/jvt13/pulso-digital)','accept':'application/rss+xml, application/atom+xml, application/xml, text/xml','accept-encoding':'identity'};
  if(cache?.etag)headers['if-none-match']=cache.etag;if(cache?.lastModified)headers['if-modified-since']=cache.lastModified;
  try{
    while(true){
      let response;
      try{const pinned=await destination(finalUrl,source.allowedHosts,{resolve:dependencies.resolve,timeoutMs:config.network.timeoutMs});response=await requestBytes(pinned,headers,config.network,dependencies.request);}catch(e){
        if(['TIMEOUT','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','NETWORK'].includes(e.code)&&retries++<config.network.retries){const wait=config.network.backoffMs*2**(retries-1);base.attempts.push({url:finalUrl,error:e.code,waitMs:wait,at:new Date(clock()).toISOString()});await sleep(wait);continue;}throw e;
      }
      base.attempts.push({url:finalUrl,status:response.status,at:new Date(clock()).toISOString()});
      if([301,302,303,307,308].includes(response.status)){check(++redirects<=config.network.maxRedirects,'REDIRECT_LIMIT','Redirecionamentos demais.');check(response.headers.location,'REDIRECT','Redirecionamento sem destino.');finalUrl=new URL(response.headers.location,finalUrl).href;targetUrl(finalUrl,source.allowedHosts);continue;}
      if(response.status===429||response.status>=500&&response.status<=599){
        const wait=Math.max(config.network.backoffMs*2**retries,retryAfter(response.headers['retry-after'],clock()));nextAllowed=Math.min(8640000000000000,Math.max(nextAllowed,clock()+wait));
        if(retries++<config.network.retries&&wait<=config.network.maxWaitMs){base.attempts.at(-1).waitMs=wait;await sleep(wait);continue;}
        throw new RadarError('HTTP_'+response.status,'Fonte temporariamente indisponível; intervalo preservado.');
      }
      const maxAge=/(?:^|,)\s*max-age=(\d+)/i.exec(response.headers['cache-control']||'');
      if(maxAge)nextAllowed=Math.min(8640000000000000,Math.max(nextAllowed,clock()+Number(maxAge[1])*1000));
      const expires=()=>new Date(clock()+Math.min(config.network.cacheTtlMs,maxAge?Number(maxAge[1])*1000:config.network.cacheTtlMs)).toISOString();
      const noStore=/(?:^|,)\s*no-store\b/i.test(response.headers['cache-control']||'');
      if(response.status===304){check(cache,'CACHE_MISSING','HTTP 304 sem cache válido.');const updated={...cache,observedAt:new Date(clock()).toISOString(),expiresAt:expires()};return {...base,mode:'revalidated',cached:true,items:cache.items,collectedAt:cache.collectedAt,observedAt:updated.observedAt,cache:noStore?null:updated,nextAllowedAt:new Date(nextAllowed).toISOString(),httpStatus:304};}
      check(response.status===200,'HTTP_'+response.status,'Fonte respondeu HTTP '+response.status+'.');
      const type=response.headers['content-type']||'';check(/(?:xml|rss|atom)/i.test(type),'CONTENT_TYPE','Tipo de resposta não é XML.');
      const parsed=(source.type==='google-trends'?parseTrends:parseRss)(response.bytes,source,{...config.limits,maxResponseBytes:config.network.maxResponseBytes});
      const collectedAt=new Date(clock()).toISOString();
      const stored=noStore?null:{key,collectedAt,observedAt:collectedAt,expiresAt:expires(),requiresRevalidation:/(?:^|,)\s*no-cache\b/i.test(response.headers['cache-control']||''),etag:response.headers.etag||null,lastModified:response.headers['last-modified']||null,items:parsed.items};
      return {...base,mode:'live',cached:false,items:parsed.items,warnings:parsed.warnings,collectedAt,observedAt:collectedAt,cache:stored,nextAllowedAt:new Date(nextAllowed).toISOString(),httpStatus:200,noStore,bytes:response.bytes.length,finalUrl};
    }
  }catch(e){const usable=cache&&now-Date.parse(cache.collectedAt)<=config.network.maxStaleMs;return {...base,mode:usable?'stale':'error',cached:!!usable,items:usable?cache.items:[],collectedAt:usable?cache.collectedAt:null,observedAt:usable?cache.observedAt:null,cache:usable?cache:null,nextAllowedAt:new Date(nextAllowed).toISOString(),error:{code:e.code||'NETWORK',message:e.message}};}
}
export async function collectAll(sources,config,prior={},dependencies={}){
  const result=new Array(sources.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(config.network.concurrency,sources.length)},async()=>{while(cursor<sources.length){const i=cursor++;try{result[i]=await collect(sources[i],config,prior[sources[i].id],dependencies);}catch(e){result[i]={sourceId:sources[i].id,mode:'error',items:[],cached:false,error:{code:e.code||'PROVIDER',message:e.message},checkedAt:new Date().toISOString()};}}}));return result;
}
