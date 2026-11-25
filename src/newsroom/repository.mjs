import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {check,file,readJson,atomicWrite,jsonBytes,hash} from './common.mjs';

export class NewsroomRepository {
  constructor(root,{now=()=>new Date().toISOString()}={}){
    this.root=fs.realpathSync(path.resolve(root));this.now=now;
    check(readJson(file(this.root,'package.json')).name==='pulso-digital','ROOT','Raiz inválida.');
    this.config=readJson(file(this.root,'newsroom/config.json'));
    const c=this.config;
    check(c.schemaVersion==='1.0'&&c.paidProvidersEnabled===false&&c.maxMonthlySpendUsd===0&&c.maxTopicsPerRun>0&&c.maxTopicsPerRun<=3&&c.maxConcurrentAiRequests===1&&c.maxAiCallsPerTopic>0&&c.maxAiCallsPerTopic<=3&&c.maxDailyTokens===50000&&c.maxInputTokens>0&&c.maxOutputTokens>0&&c.maxTokensPerMinute>0&&c.maxInputTokens+c.maxOutputTokens<=c.maxTokensPerMinute&&c.maxTokensPerMinute<=8000&&c.minAiIntervalMs>=60000&&Array.isArray(c.research.allowedHosts)&&c.research.allowedHosts.length>0,'CONFIG','Configuração de segurança/orçamento inválida.');
    check(c.models?.gemini&&c.review?.schemaVersion==='1.0'&&c.review.provider==='gemini'&&c.review.model===c.models.gemini&&c.review.paidProvidersEnabled===false&&c.review.maxCallsPerTask>0&&c.review.maxCallsPerTask<=3&&c.review.maxCallsPerTopic>0&&c.review.maxCallsPerTopic<=3&&c.review.maxTokensPerTask>0&&c.review.maxTokensPerTask<=15000&&c.review.maxInputTokens>0&&c.review.maxOutputTokens>0&&c.review.maxInputTokens+c.review.maxOutputTokens<=c.review.maxTokensPerMinute&&c.review.maxTokensPerMinute<=8000&&c.review.minAiIntervalMs>=60000&&c.review.maxFindings>0&&c.review.maxFindings<=20,'CONFIG','Configuração de revisão inválida.');
    this.data=file(this.root,'newsroom/data');this.stateFile=file(this.root,'newsroom/data/state.json');this.lock=file(this.root,'newsroom/data/lock');
  }
  read(){if(!fs.existsSync(this.stateFile))return {schemaVersion:'1.0',topics:{},usage:[],researchCache:{}};const stat=fs.lstatSync(this.stateFile);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=8388608,'STATE','Estado inválido ou grande demais.');const state=readJson(this.stateFile);check(state.schemaVersion==='1.0'&&state.topics&&typeof state.topics==='object'&&!Array.isArray(state.topics)&&Array.isArray(state.usage)&&state.researchCache&&typeof state.researchCache==='object','STATE','Snapshot inválido.');return state;}
  save(state){check(this.held,'LOCK_REQUIRED','Escrita exige lock.');const bytes=jsonBytes(state);check(bytes.length<=8388608,'STATE_LIMIT','Snapshot excede 8 MiB; anterior preservado.');atomicWrite(this.stateFile,bytes);}
  async withLock(fn){fs.mkdirSync(this.data,{recursive:true});try{fs.mkdirSync(this.lock);}catch(e){if(e.code==='EEXIST')throw Object.assign(new Error('Outra operação do newsroom está ativa; não removemos o lock automaticamente.'),{code:'LOCK_BUSY'});throw e;}const token=crypto.randomUUID();try{atomicWrite(file(this.root,'newsroom/data/lock/owner.json'),jsonBytes({pid:process.pid,host:os.hostname(),token,at:this.now()}));this.held=true;return await fn();}finally{this.held=false;const owner=file(this.root,'newsroom/data/lock/owner.json');if(fs.existsSync(owner)&&readJson(owner).token===token){fs.unlinkSync(owner);fs.rmdirSync(this.lock);}}}
  recover(reason){check(typeof reason==='string'&&reason.trim().length>=5,'REASON','Justificativa obrigatória.');if(!fs.existsSync(this.lock))return {recovered:false};const ownerFile=file(this.root,'newsroom/data/lock/owner.json');const owner=fs.existsSync(ownerFile)?readJson(ownerFile):null;check(owner?.host===os.hostname()&&Number.isInteger(owner.pid)&&owner.pid>0,'LOCK_BUSY','Lock sem proprietário verificável; inspeção manual necessária.');let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}check(!alive,'LOCK_BUSY','Processo proprietário ativo; lock preservado.');atomicWrite(file(this.root,`newsroom/data/recovery-${crypto.randomUUID()}.json`),jsonBytes({owner,reason,at:this.now()}));fs.unlinkSync(ownerFile);fs.rmdirSync(this.lock);return {recovered:true};}
  fingerprint(){return hash(fs.existsSync(this.stateFile)?fs.readFileSync(this.stateFile):'absent');}
  get(id){check(/^pauta-[a-f0-9]{24}$/.test(id||''),'ID','ID inválido.');return this.read().topics[id]||null;}
}
