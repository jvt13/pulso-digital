import {readJson} from '../editorial/repository.mjs';
import {collectAll} from './collector.mjs';
import {normalizeSignal} from './normalizer.mjs';
import {classify} from './classifier.mjs';
import {score} from './scorer.mjs';
import {sameEvent,publishedReferences} from './deduplication.mjs';
import {check,hash} from './common.mjs';
import {exportTopic} from './contract.mjs';

export class RadarEngine {
  constructor(repo,dependencies={}){this.repo=repo;this.dependencies=dependencies;this.clock=dependencies.clock||Date.now;}
  async fetch({region=null,dryRun=false}={}){
    check(!region||/^[A-Z]{2}$/.test(region),'REGION','Região inválida; use BR ou US.');
    const run=async()=>{const fingerprint=this.repo.fingerprint(),state=this.repo.read(),now=this.clock(),at=new Date(now).toISOString();
      const sources=this.repo.sources.filter(s=>s.active&&(!region||s.region===region));check(sources.length,'SOURCE','Nenhuma fonte ativa para a região.');
      const results=await collectAll(sources,this.repo.config,state.providers,this.dependencies);let newTopics=0,updatedTopics=0,signals=0;const observed=new Set();
      for(let i=0;i<results.length;i++){const result=results[i],source=sources[i];state.providers[source.id]={cache:result.cache||null,nextAllowedAt:result.nextAllowedAt||state.providers[source.id]?.nextAllowedAt||null,lastResult:{mode:result.mode,at:result.checkedAt,error:result.error||null}};
        for(const item of result.items){signals++;const signal=normalizeSignal(item,source,result);if(!signal.collectedAt||!signal.normalizedTopic)continue;
          let topic=state.topics.find(t=>t.signals.some(s=>sameEvent(s,signal,this.repo.config.deduplication)));
          if(!topic){topic={schemaVersion:'1.0',id:'pauta-'+hash([signal.id,signal.feedPublishedAt||signal.collectedAt]).slice(0,24),topic:signal.topic,normalizedTopic:signal.normalizedTopic,signals:[],relatedTerms:[],sourceReferences:[],firstSeenAt:signal.observedAt,lastSeenAt:signal.observedAt,collectedAt:signal.collectedAt,score:0,scoreBreakdown:{},priority:'baixa',status:'new',classificationReason:'',duplicateReferences:[],researchQueries:[],history:[]};state.topics.push(topic);newTopics++;}
          const previous=topic.signals.find(s=>s.id===signal.id);const fresh=!previous||signal.observedAt>previous.observedAt;
          if(!fresh)continue;
          if(previous)topic.signals[topic.signals.indexOf(previous)]=signal;else topic.signals.push(signal);
          topic.firstSeenAt=topic.firstSeenAt<signal.observedAt?topic.firstSeenAt:signal.observedAt;topic.lastSeenAt=topic.lastSeenAt>signal.observedAt?topic.lastSeenAt:signal.observedAt;topic.collectedAt=topic.collectedAt>signal.collectedAt?topic.collectedAt:signal.collectedAt;
          topic.history.push({at:signal.observedAt,action:'signal',signalId:signal.id,provider:signal.provider,region:signal.region,collectedAt:signal.collectedAt,approximateTraffic:signal.approximateTraffic,cached:signal.cached,mode:result.mode,previousTraffic:previous?.approximateTraffic||null});observed.add(topic.id);
        }
      }
      const articles=readJson(this.repo.file('content/articles.json')),evaluatedAt=new Date(this.clock()).toISOString();
      for(const t of state.topics){const classification=classify(t.signals,this.repo.config.classification);t.suggestedCategory=classification.category;t.classificationReason=classification.reason;t.classificationSignals=classification;
        t.duplicateReferences=publishedReferences(t.topic,t.signals,articles,this.repo.config.deduplication.titleSimilarity);
        t.relatedTerms=[...new Set(t.signals.flatMap(s=>s.relatedTerms))];t.sourceReferences=[...new Map(t.signals.flatMap(s=>[{name:s.provider,url:s.feedUrl,region:s.region},...(s.url?[{name:s.provider,url:s.url,region:s.region}]:[]),...s.relatedNews.filter(n=>n.url).map(n=>({name:n.source,url:n.url,region:s.region}))]).map(r=>[r.url+'|'+r.region,r])).values()];
        Object.assign(t,score(t.signals,classification,t.duplicateReferences,this.repo.config.score,now));
        t.researchQueries=[t.topic,t.topic+' fonte oficial',t.topic+' contexto e data'];
        if(classification.outOfScope&&t.status==='new'){t.status='dismissed';t.statusReason=classification.reason;t.history.push({at:evaluatedAt,action:'dismiss',from:'new',to:'dismissed',reason:classification.reason,actor:'radar-regras'});}
        if(observed.has(t.id)){updatedTopics++;t.history.push({at:evaluatedAt,action:'score',score:t.score,priority:t.priority,coverage:t.scoreBreakdown.coverage,reason:t.classificationReason});}
      }
      const summary={id:'run-'+hash([at,results.map(r=>r.sourceId)]).slice(0,20),at,dryRun,providers:results.map(({items,cache,...r})=>({...r,signals:items.length})),signals,newTopics,observedTopics:updatedTopics,uniqueTopics:state.topics.length,discarded:state.topics.filter(t=>t.status==='dismissed').map(t=>({id:t.id,topic:t.topic,reason:t.statusReason})),distribution:Object.fromEntries(['tecnologia','ia','games','espaco','tendencias','fora-do-escopo'].map(c=>[c,state.topics.filter(t=>(t.suggestedCategory||'fora-do-escopo')===c).length])),retention:this.repo.retention(state,now)};
      check(fingerprint===this.repo.fingerprint(),'CONCURRENT_CHANGE','Estado/configuração/acervo alterado durante coleta; resultado não aplicado.');
      if(!dryRun){state.runs.push(summary);this.repo.save(state);}return {...summary,top:this.sorted(state.topics).slice(0,10).map(exportTopic)};
    };return dryRun?run():this.repo.withLock(run);
  }
  sorted(topics){return topics.filter(t=>!['dismissed','deferred'].includes(t.status)&&Date.parse(t.lastSeenAt)>=this.clock()-this.repo.config.retentionDays*86400000).sort((a,b)=>b.score-a.score||b.lastSeenAt.localeCompare(a.lastSeenAt)||a.id.localeCompare(b.id));}
  list({category=null,minScore=0,limit=2000,top=false}={}){check(!category||['tecnologia','ia','games','espaco','tendencias'].includes(category),'CATEGORY','Categoria inválida.');const all=this.repo.read().topics;return (top?this.sorted(all):all).filter(t=>(!category||t.suggestedCategory===category)&&t.score>=minScore).slice(0,limit);}
  show(id){check(/^pauta-[a-f0-9]{24}$/.test(id||''),'ID','ID inválido.');const t=this.repo.read().topics.find(t=>t.id===id);check(t,'NOT_FOUND','Pauta não encontrada.');return t;}
  async setStatus(id,status,reason){check(['queued','dismissed','deferred'].includes(status),'STATUS','Estado inválido.');check(typeof reason==='string'&&reason.trim().length>=5,'REASON','Informe justificativa com pelo menos cinco caracteres.');return this.repo.withLock(async()=>{this.show(id);const state=this.repo.read(),t=state.topics.find(t=>t.id===id);if(t.status===status)return t;const from=t.status;t.status=status;t.statusReason=reason;t.history.push({at:new Date(this.clock()).toISOString(),action:'status',from,to:status,reason,actor:'operador-local'});this.repo.save(state);return t;});}
  export(options={}){return {schemaVersion:'1.0',kind:'research-topics',topics:this.list({...options,top:true}).map(exportTopic),automaticEditorialImport:false};}
}
