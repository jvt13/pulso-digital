import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {atomicWrite,confined,readJson,jsonBytes} from '../editorial/repository.mjs';
import {check,categories,hash} from './common.mjs';
import {targetUrl} from './security.mjs';
import {validateTopic} from './contract.mjs';

export class RadarRepository {
  constructor(root){this.root=fs.realpathSync(path.resolve(root));check(readJson(this.file('package.json')).name==='pulso-digital','ROOT','Raiz do projeto inválida.');this.config=readJson(this.file('radar/config.json'),65536);this.sources=readJson(this.file('radar/sources.json'),65536);this.data=this.file('radar/data');this.lock=this.file('radar/data/lock');this.stateFile=this.file('radar/data/state.json');this.locked=false;
    const c=this.config;check(c.schemaVersion==='1.0'&&Number.isInteger(c.retentionDays)&&c.retentionDays>0,'CONFIG','Configuração inválida.');
    check(Object.values(c.network).every(n=>Number.isInteger(n)&&n>=0)&&c.network.timeoutMs>=1&&c.network.timeoutMs<=60000&&c.network.maxWaitMs<=60000&&c.network.maxResponseBytes>0&&c.network.maxResponseBytes<=4194304&&c.network.concurrency>0&&c.network.concurrency<=8&&c.network.retries<=3&&c.network.maxRedirects<=5,'CONFIG','Limites de rede inválidos.');
    check(Object.values(c.limits).every(n=>Number.isInteger(n)&&n>0)&&c.limits.stateBytes<=67108864&&c.limits.xmlDepth<=64&&c.limits.xmlNodes<=100000&&c.limits.itemsPerFeed<=500&&c.limits.fieldChars<=4000,'CONFIG','Limites de armazenamento/XML inválidos.');
    check(Object.keys(c.score.weights).sort().join(',')==='novelty,origin,popularity,recency,relevance'&&Object.values(c.score.weights).every(n=>Number.isFinite(n)&&n>=0)&&Object.values(c.score.weights).reduce((a,b)=>a+b,0)===100&&c.score.high<=100&&c.score.medium>=0&&c.score.high>c.score.medium&&c.score.halfLifeHours>0,'CONFIG','Pesos devem totalizar 100 e limites de prioridade devem ser coerentes.');
    check(c.score.bands.length>0&&c.score.bands.every((b,i,a)=>Number.isFinite(b.minimum)&&b.minimum>=0&&b.value>=0&&b.value<=1&&(!i||a[i-1].minimum>b.minimum&&a[i-1].value>=b.value)),'CONFIG','Faixas de popularidade inválidas.');
    check(c.deduplication.titleSimilarity>0&&c.deduplication.titleSimilarity<=1&&c.deduplication.eventWindowHours>0,'CONFIG','Deduplicação inválida.');
    check(c.classification.minimum>0&&c.classification.rules.every(r=>categories.includes(r.category)&&Object.entries(r.terms).every(([k,v])=>k.length>0&&Number.isFinite(v)&&v>0)&&Array.isArray(r.negative)),'CONFIG','Regras de classificação inválidas.');
    check(typeof c.classification.version==='string'&&Array.isArray(c.classification.contextualRules)&&c.classification.contextualRules.every(r=>typeof r.id==='string'&&categories.includes(r.category)&&Array.isArray(r.entities)&&r.entities.length&&Array.isArray(r.terms)&&Array.isArray(r.sourceCategories)&&r.sourceCategories.every(k=>categories.includes(k))&&Number.isFinite(r.weight)&&r.weight>0),'CONFIG','Regras contextuais inválidas.');
    check(Array.isArray(c.classification.administrative)&&c.classification.administrativeRelevanceCap>=0&&c.classification.administrativeRelevanceCap<=1&&c.specificity.minimumWords>=2&&Array.isArray(c.specificity.actions)&&Array.isArray(c.specificity.technicalContexts),'CONFIG','Regras de especificidade inválidas.');
    const ed=c.editorialScore;
    check(ed&&Object.keys(ed.weights).sort().join(',')==='novelty,origin,recency,relevance'&&Object.values(ed.weights).every(n=>Number.isFinite(n)&&n>=0)&&Object.values(ed.weights).reduce((a,b)=>a+b,0)===ed.denominator&&ed.denominator===75&&ed.high<=100&&ed.medium>=0&&ed.high>ed.medium&&ed.minHighRelevance>0&&ed.minHighRelevance<=1&&ed.minHighOrigin>0&&ed.minHighOrigin<=1&&ed.minHighCoverage>0&&ed.minHighCoverage<=100&&ed.maxHighAgeHours>0&&ed.maxRankingAgeHours>=ed.maxHighAgeHours,'CONFIG','Limites do Pulso Editorial inválidos.');
    check(Array.isArray(this.sources)&&this.sources.length<=20&&new Set(this.sources.map(s=>s.id)).size===this.sources.length,'CONFIG','Fontes inválidas/duplicadas.');
    for(const s of this.sources){check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id)&&['rss','google-trends'].includes(s.type)&&/^[A-Z]{2}$/.test(s.region)&&typeof s.active==='boolean'&&Number.isFinite(s.weight)&&s.weight>=0&&s.weight<=1&&typeof s.organization==='string'&&s.organization.length>0&&Array.isArray(s.allowedHosts)&&s.allowedHosts.length>0&&s.allowedHosts.every(h=>typeof h==='string'&&/^[a-z0-9.-]+$/.test(h)&&!h.includes('*'))&&(s.suggestedCategory===null||categories.includes(s.suggestedCategory)),'CONFIG','Fonte fora do contrato.');targetUrl(s.url,s.allowedHosts);}
  }
  file(relative){return confined(this.root,relative);}
  read(){if(!fs.existsSync(this.stateFile))return {schemaVersion:'1.0',topics:[],providers:{},runs:[]};const s=readJson(this.stateFile,this.config.limits.stateBytes);check(s.schemaVersion==='1.0'&&Array.isArray(s.topics)&&Array.isArray(s.runs)&&s.providers&&typeof s.providers==='object','STATE','Estado do radar inválido.');s.topics.forEach(validateTopic);return s;}
  fingerprint(){return hash([fs.existsSync(this.stateFile)?hash(fs.readFileSync(this.stateFile)):null,hash(fs.readFileSync(this.file('radar/config.json'))),hash(fs.readFileSync(this.file('radar/sources.json'))),hash(fs.readFileSync(this.file('content/articles.json')))]);}
  save(state){check(this.locked,'LOCK_REQUIRED','Escrita exige bloqueio.');check(state.topics.length<=this.config.limits.topics&&state.runs.length<=this.config.limits.runs&&state.topics.every(t=>t.history.length<=this.config.limits.historyPerTopic),'STORAGE_LIMIT','Limite atingido; arquivamento explícito é necessário. Nenhum histórico foi excluído.');state.topics.forEach(validateTopic);const b=jsonBytes(state);check(b.length<=this.config.limits.stateBytes,'STORAGE_LIMIT','Estado acima do limite; dados anteriores preservados.');atomicWrite(this.stateFile,b);}
  saveWithBackup(state,{kind='reclassification',at=new Date().toISOString()}={}){
    check(this.locked,'LOCK_REQUIRED','Backup/migração exige bloqueio.');
    const before=fs.readFileSync(this.stateFile),after=jsonBytes(state),id='migration-'+crypto.randomUUID();
    const receipt={schemaVersion:'1.0',id,kind,at,beforeHash:hash(before),afterHash:hash(after),backup:`radar/data/backups/${id}.before.json`};
    // A cópia exata e o recibo são duráveis antes da substituição do snapshot único.
    atomicWrite(this.file(receipt.backup),before);
    atomicWrite(this.file(`radar/data/backups/${id}.receipt.json`),jsonBytes(receipt));
    this.save(state);return receipt;
  }
  async restoreSnapshot(id,reason,{dryRun=false}={}){
    check(/^migration-[a-f0-9-]{36}$/.test(id||'')&&typeof reason==='string'&&reason.trim().length>=5,'RESTORE','Informe ID de backup e motivo explícito.');
    const operation=async()=>{
      const receipt=readJson(this.file(`radar/data/backups/${id}.receipt.json`),65536);
      check(receipt.id===id&&receipt.backup===`radar/data/backups/${id}.before.json`&&/^[a-f0-9]{64}$/.test(receipt.beforeHash)&&/^[a-f0-9]{64}$/.test(receipt.afterHash),'RESTORE','Recibo de migração inválido.');
      const current=fs.readFileSync(this.stateFile),backupFile=this.file(receipt.backup),previous=readJson(backupFile,this.config.limits.stateBytes),bytes=fs.readFileSync(backupFile);
      check(hash(bytes)===receipt.beforeHash,'RESTORE','Backup alterado; recuperação bloqueada.');
      check(hash(current)===receipt.afterHash,'CONCURRENT_CHANGE','Houve alteração depois da migração; recuperação não sobrescreve decisões posteriores.');
      check(previous.schemaVersion==='1.0'&&Array.isArray(previous.topics),'RESTORE','Snapshot anterior inválido.');previous.topics.forEach(validateTopic);
      if(!dryRun){const undo=this.saveWithBackup(previous,{kind:'explicit-restore'});atomicWrite(this.file(`radar/data/backups/${undo.id}.restore.json`),jsonBytes({id,reason,at:new Date().toISOString(),actor:'operador-local',preservedCurrentSnapshot:undo.backup}));}
      return {dryRun,restored:!dryRun,backup:receipt.backup,beforeHash:receipt.beforeHash,afterHash:receipt.afterHash,reason};
    };return dryRun?operation():this.withLock(operation);
  }
  async withLock(fn){fs.mkdirSync(this.data,{recursive:true});try{fs.mkdirSync(this.lock);}catch(e){check(e.code!=='EEXIST','LOCK_BUSY','Outra coleta/alteração está ativa. Consulte status.');throw e;}const token=crypto.randomUUID();
    try{atomicWrite(this.file('radar/data/lock/owner.json'),jsonBytes({pid:process.pid,host:os.hostname(),token,at:new Date().toISOString()}));this.locked=true;return await fn();}
    finally{this.locked=false;const owner=this.file('radar/data/lock/owner.json');if(fs.existsSync(owner)&&readJson(owner).token===token){fs.unlinkSync(owner);fs.rmdirSync(this.lock);}}
  }
  breakLock(reason){check(typeof reason==='string'&&reason.trim().length>=5,'REASON','Informe justificativa de recuperação.');if(!fs.existsSync(this.lock))return {recovered:false};const file=this.file('radar/data/lock/owner.json');const owner=fs.existsSync(file)?readJson(file):null;
    if(owner){check(owner.host===os.hostname()&&Number.isInteger(owner.pid)&&owner.pid>0,'LOCK_BUSY','Proprietário inválido ou de outro host; inspecione manualmente.');let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}check(!alive,'LOCK_BUSY','Processo ainda está ativo; bloqueio preservado.');}
    atomicWrite(this.file('radar/data/recovery-'+crypto.randomUUID()+'.json'),jsonBytes({owner,reason,at:new Date().toISOString()}));if(owner)fs.unlinkSync(file);fs.rmdirSync(this.lock);return {recovered:true};
  }
  retention(state,now=Date.now()){const before=now-this.config.retentionDays*86400000;return {days:this.config.retentionDays,eligibleForManualArchive:state.topics.filter(t=>Date.parse(t.lastSeenAt)<before).map(t=>t.id),automaticDeletion:false};}
}
