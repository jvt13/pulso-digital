import fs from 'node:fs';
import {RadarRepository} from '../radar/repository.mjs';
import {RadarEngine} from '../radar/engine.mjs';
import {Repository as EditorialRepository,atomicWrite,jsonBytes} from '../editorial/repository.mjs';
import {EditorialEngine} from '../editorial/engine.mjs';
import {check,file,hash,safeId} from './common.mjs';
import {candidates} from './selector.mjs';
import {research,sourceUrls} from './research.mjs';
import {writeWithBudget} from './writer.mjs';
import {verifyDraft,editorialInput} from './verifier.mjs';
import {inspectImage,stageImage} from './images.mjs';
import {usageSummary} from './budget.mjs';

export class NewsroomEngine {
  constructor(repo,dependencies={}){this.repo=repo;this.dependencies=dependencies;}
  radarTopic(id){check(safeId(id),'ID','ID de pauta inválido.');const topic=new RadarRepository(this.repo.root).read().topics.find(t=>t.id===id);check(topic,'NOT_FOUND','Pauta não encontrada.');return topic;}
  plan(options={}){return candidates(this.repo.root,this.repo.read(),this.repo.config,options);}
  status(){const s=this.repo.read();return {topics:Object.keys(s.topics).length,byStatus:Object.fromEntries([...new Set(Object.values(s.topics).map(t=>t.status))].map(k=>[k,Object.values(s.topics).filter(t=>t.status===k).length])),usage:usageSummary(s,this.repo.now()),automaticApproval:false,automaticPublication:false};}
  providers(){return {selected:this.repo.config.provider,models:this.repo.config.models,freeTierConfirmationRequired:true,groqCredentialPresent:!!process.env.GROQ_API_KEY,geminiCredentialPresent:!!process.env.GEMINI_API_KEY,paidProvidersEnabled:false,automaticFallback:false};}
  show(id){check(safeId(id),'ID','ID inválido.');const item=this.repo.get(id);check(item,'NOT_FOUND','Pauta não processada no newsroom.');return item;}
  list(){return Object.values(this.repo.read().topics).map(({dossier,draft,verification,...summary})=>({...summary,hasDossier:!!dossier,hasDraft:!!draft,verification:verification?{valid:verification.valid,errors:verification.errors,warnings:verification.warnings}:null}));}
  evidence(id){const item=this.show(id);check(item.dossier,'EVIDENCE','Dossiê indisponível.');return item.dossier;}
  async research(id,{extraUrls=[]}={}){return this.repo.withLock(async()=>{
    const state=this.repo.read(),topic=this.radarTopic(id),eligible=new Set(new RadarEngine(new RadarRepository(this.repo.root)).export({mode:'editorial',limit:2000}).topics.map(t=>t.id));
    check(eligible.has(id)&&!['dismissed','deferred'].includes(topic.status),'TOPIC','Pauta descartada, ampla, antiga ou sem conexão editorial.');
    const prior=state.topics[id];if(prior?.dossier&&prior.radarAssessmentHash===topic.assessmentHash)return {id,status:prior.status,alreadyResearched:true,dossier:prior.dossier};
    const result=await research(topic,this.repo.config.research,{extraUrls,dependencies:this.dependencies.research||{},cache:state.researchCache});
    state.researchCache=result.cache;const {cache,...dossier}=result;
    const record={id,radarAssessmentHash:topic.assessmentHash,topic:topic.topic,category:topic.suggestedCategory,status:dossier.insufficient?'research-insufficient':'ready-to-write',dossier,draft:null,verification:null,image:null,editorialId:null,synthetic:false,history:[...(prior?.history||[]),{at:this.repo.now(),action:'research',status:dossier.insufficient?'research-insufficient':'ready-to-write',sources:dossier.sources.length,evidence:dossier.evidence.length}]};
    state.topics[id]=record;this.repo.save(state);return {id,status:record.status,alreadyResearched:false,dossier};
  });}
  async write(id,{provider=this.repo.config.provider,model=this.repo.config.models[provider],freeTierConfirmed=false,transport,fixture}={}){return this.repo.withLock(async()=>{
    const state=this.repo.read(),record=state.topics[id];check(record?.dossier&&!record.dossier.insufficient&&['ready-to-write','failed','review-required'].includes(record.status),'STATE','Pesquisa deve estar pronta para redação.');
    try{const {response,entry}=await writeWithBudget(this.repo,state,id,record.dossier,{provider,model,freeTierConfirmed,transport,fixture});record.draft=response.value;record.ai={provider:response.provider,model:response.model,requestId:response.requestId,usage:response.usage,durationMs:response.durationMs??null,rateLimits:response.rateLimits??null,attemptId:entry.id};record.synthetic=!!response.synthetic;record.status='draft-generated';record.history.push({at:this.repo.now(),action:'write',provider:response.provider,model:response.model,attemptId:entry.id,synthetic:record.synthetic});this.repo.save(state);return {id,status:record.status,synthetic:record.synthetic,usage:response.usage,durationMs:response.durationMs??null,rateLimits:response.rateLimits??null};}
    catch(e){record.status='failed';record.history.push({at:this.repo.now(),action:'write-failed',code:e.code||'AI_ERROR'});this.repo.save(state);throw e;}
  });}
  async verify(id){return this.repo.withLock(async()=>{const state=this.repo.read(),record=state.topics[id];check(record?.draft&&['draft-generated','review-required','image-pending','ready-to-import'].includes(record.status),'STATE','Rascunho não disponível.');const result=verifyDraft(record.draft,record.dossier);record.verification=result;record.status=result.valid?'image-pending':'review-required';record.history.push({at:this.repo.now(),action:'verify',valid:result.valid,errors:result.errors.map(e=>e.code)});this.repo.save(state);return {id,status:record.status,verification:result};});}
  async prepareImage(id){return this.repo.withLock(async()=>{const state=this.repo.read(),record=state.topics[id];check(record?.verification?.valid,'STATE','Verifique o rascunho antes da imagem.');const prepared=inspectImage(this.repo.root,id);record.image={status:prepared.status,reason:prepared.reason||null,manifest:prepared.ready?prepared.manifest:null};record.status=prepared.status;record.history.push({at:this.repo.now(),action:'prepare-image',status:prepared.status});this.repo.save(state);return {id,status:record.status,image:record.image};});}
  async importDraft(id){return this.repo.withLock(async()=>{const state=this.repo.read(),record=state.topics[id];check(record?.verification?.valid&&!record.synthetic,'STATE','Somente rascunho real verificado pode ser importado.');check(['image-pending','ready-to-import','imported'].includes(record.status),'STATE','Execute prepare-image antes da importação.');
    const editorialId=`newsroom-${id}`,editorialRepo=new EditorialRepository(this.repo.root),editorialEngine=new EditorialEngine(editorialRepo);
    const priorPath=editorialRepo.recordPath(editorialId);
    if(fs.existsSync(priorPath)){const existing=editorialRepo.get(editorialId),topic=this.radarTopic(id),prepared=inspectImage(this.repo.root,id),expected=editorialInput(topic,record.draft,record.dossier,prepared.ready?prepared.image:null);check(hash(existing.input)===hash(expected),'IMPORT_CONFLICT','Rascunho editorial existente difere; revisão controlada necessária.');record.status='imported';record.editorialId=editorialId;record.editorialInputHash=hash(expected);this.repo.save(state);return {id,status:'imported',editorialId,alreadyImported:true};}
    const prepared=inspectImage(this.repo.root,id),image=prepared.ready?stageImage(this.repo.root,id,prepared):null;
    const topic=this.radarTopic(id),input=editorialInput(topic,record.draft,record.dossier,image),relative=`editorial/data/incoming/${editorialId}.json`,target=file(this.repo.root,relative),bytes=jsonBytes(input);
    if(fs.existsSync(target))check(fs.readFileSync(target).equals(bytes),'IMPORT_CONFLICT','Incoming existente difere; não sobrescrever.');else atomicWrite(target,bytes);
    const imported=editorialEngine.import(relative);check(imported.state==='draft','IMPORT','Motor editorial não retornou estado draft.');
    record.status='imported';record.editorialId=editorialId;record.editorialInputHash=hash(input);record.imageStatus=prepared.status;record.history.push({at:this.repo.now(),action:'import',editorialId,imageStatus:prepared.status});this.repo.save(state);
    return {id,status:record.status,editorialId,alreadyImported:false,imageStatus:prepared.status};
  });}
  dryRun({limit=this.repo.config.maxTopicsPerRun}={}){const plan=this.plan({limit}),radar=new RadarRepository(this.repo.root).read();return {dryRun:true,selected:plan.selected.map(c=>{const topic=radar.topics.find(t=>t.id===c.id);return {...c,plannedSources:sourceUrls(topic,[],this.repo.config.research.maxSourcesPerTopic)};}),provider:this.repo.config.provider,model:this.repo.config.models[this.repo.config.provider],limits:{maxTopicsPerRun:this.repo.config.maxTopicsPerRun,maxAiCallsPerTopic:this.repo.config.maxAiCallsPerTopic,maxDailyTokens:this.repo.config.maxDailyTokens,maxMonthlySpendUsd:this.repo.config.maxMonthlySpendUsd},operations:['research','evidence','write','verify','prepare-image','import draft if valid'],persistentChanges:false,externalCalls:false};}
  async run({limit=this.repo.config.maxTopicsPerRun,freeTierConfirmed=false}={}){const plan=this.plan({limit}),results=[];for(const selected of plan.selected){const id=selected.id;try{let r=this.repo.get(id);if(!r?.dossier)r=await this.research(id);if(r.status==='research-insufficient'){results.push({id,status:r.status});continue;}if(['ready-to-write','failed'].includes(r.status))r=await this.write(id,{freeTierConfirmed});if(r.status==='draft-generated')r=await this.verify(id);if(r.status==='review-required'){results.push({id,status:r.status,errors:r.verification?.errors});continue;}if(['image-pending','ready-to-import'].includes(r.status))r=await this.prepareImage(id);r=await this.importDraft(id);results.push(r);}catch(e){results.push({id,status:'failed',code:e.code||'ERROR',message:e.message});}}return {selected:plan.selected.length,results,automaticApproval:false,automaticPublication:false};}
}
