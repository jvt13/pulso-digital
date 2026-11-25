import {readJson} from '../editorial/repository.mjs';
import {applyAssessment} from './assessment.mjs';
import {check} from './common.mjs';

export function summarize(topics){
  const candidates=topics.filter(t=>!['dismissed','deferred'].includes(t.status));
  return {total:topics.length,candidates:candidates.length,dismissed:topics.filter(t=>t.status==='dismissed').length,deferred:topics.filter(t=>t.status==='deferred').length,queued:topics.filter(t=>t.status==='queued').length,distribution:Object.fromEntries(['tecnologia','ia','games','espaco','tendencias','discovery'].map(c=>[c,candidates.filter(t=>(t.suggestedCategory||'discovery')===c).length])),candidateTypes:Object.fromEntries(['specific-event','possible-update','broad-topic','insufficient-context','legacy'].map(k=>[k,candidates.filter(t=>(t.candidateType||'legacy')===k).length]))};
}
export async function reclassify(repo,{dryRun=false,now=Date.now()}={}){
  const operation=async()=>{
    const fingerprint=repo.fingerprint(),state=repo.read(),before=summarize(state.topics),at=new Date(now).toISOString();
    const articles=readJson(repo.file('content/articles.json')),changes=[];
    for(const topic of state.topics){const result=applyAssessment(topic,repo.config,articles,now);if(result)changes.push(result);}
    const result={dryRun,at,ruleVersion:repo.config.classification.version,before,after:summarize(state.topics),changes,changed:changes.length,backup:null,observationsCreated:0};
    check(fingerprint===repo.fingerprint(),'CONCURRENT_CHANGE','Snapshot/configuração/acervo alterado durante reclassificação.');
    if(!dryRun&&changes.length){state.reclassifications??=[];state.reclassifications.push({at,ruleVersion:result.ruleVersion,changed:changes.length,before,after:result.after});result.backup=repo.saveWithBackup(state,{kind:'reclassification',at});}
    return result;
  };
  return dryRun?operation():repo.withLock(operation);
}
