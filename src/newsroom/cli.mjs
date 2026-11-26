import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NewsroomRepository} from './repository.mjs';
import {NewsroomEngine} from './engine.mjs';
import {ReviewEngine} from './review/engine.mjs';
import {check} from './common.mjs';
import {loadLocalEnv} from './env.mjs';
import {evaluatePublicationEligibility} from './publication-eligibility.mjs';

const help=`Newsroom privado Pulso Digital
Uso: npm run newsroom -- COMANDO [ID] [opções]
help | status | providers | plan [--limit 3] | list | show ID | usage
research ID [--url URL] | evidence ID | write ID [--provider groq|gemini] [--reason TEXTO]
verify ID | prepare-image ID | import ID | quality ID
eligibility ID
repair-classification ID [--reason TEXTO]
repair-review-finding ID --finding-id ID [--reason TEXTO]
enrich ID [--reason TEXTO]
revise ID --file JSON --reason TEXTO
review ID [--provider gemini] [--dry-run] [--confirm-free-tier]
review-status ID | review-history ID | review --help
run [--limit 3] [--dry-run]
recover --reason "Justificativa"
Globais: --json, --root DIRETORIO. Para IA real: --confirm-free-tier após confirmar conta gratuita; chave apenas em variável de ambiente.
Nenhum comando aprova, publica, faz commit, push ou deploy editorial.
`;

const commandOptions={
  help:[],
  status:[],
  providers:[],
  plan:['limit'],
  list:[],
  show:[],
  usage:[],
  research:['url','urls'],
  evidence:[],
  write:['provider','confirm-free-tier','reason'],
  verify:[],
  'prepare-image':[],
  import:[],
  enrich:['reason'],
  revise:['file','reason'],
  quality:[],
  eligibility:[],
  'repair-classification':['reason'],
  'repair-review-finding':['finding-id','reason'],
  review:['provider','dry-run','confirm-free-tier','help'],
  'review-status':[],
  'review-history':[],
  run:['limit','dry-run','confirm-free-tier'],
  recover:['reason'],
};
const needsId=new Set(['show','research','evidence','write','verify','prepare-image','import','enrich','revise','quality','eligibility','repair-classification','repair-review-finding','review','review-status','review-history']);
const booleans=new Set(['json','dry-run','confirm-free-tier','help']);
const globalValues=new Set(['root','limit','url','provider','reason','file','finding-id']);

export async function main(argv=process.argv.slice(2)){
  const opts={},args=[];
  try{
    for(let index=0;index<argv.length;index++){
      const argument=argv[index];
      if(!argument.startsWith('--')){args.push(argument);continue;}
      const key=argument.slice(2);
      check(booleans.has(key)||globalValues.has(key),'CLI','Opção desconhecida.');
      if(key==='url'){
        check(argv[index+1]&&!argv[index+1].startsWith('--'),'CLI','Opção sem valor.');
        (opts.urls??=[]).push(argv[++index]);
        continue;
      }
      check(!Object.hasOwn(opts,key),'CLI','Opção repetida.');
      if(booleans.has(key))opts[key]=true;
      else{check(argv[index+1]&&!argv[index+1].startsWith('--'),'CLI','Opção sem valor.');opts[key]=argv[++index];}
    }
    const [cmd='help',id]=args;
    check(Object.hasOwn(commandOptions,cmd),'CLI','Comando desconhecido; execute help.');
    const expectsId=needsId.has(cmd)&&!(cmd==='review'&&opts.help);
    check(args.length===(expectsId?2:1),'CLI','Comando ou argumentos inválidos; execute help.');
    check(Object.keys(opts).every(key=>['root','json',...commandOptions[cmd]].includes(key)),'CLI','Opção não aplicável ao comando.');
    if(cmd==='help'){
      console.log(opts.json?JSON.stringify({ok:true,help}):help);
      return 0;
    }
    const root=opts.root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    loadLocalEnv(root);
    const repo=new NewsroomRepository(root),engine=new NewsroomEngine(repo),reviewEngine=new ReviewEngine(repo);
    let limit=repo.config.maxTopicsPerRun;
    if(opts.limit){limit=Number(opts.limit);check(Number.isInteger(limit)&&limit>0&&limit<=repo.config.maxTopicsPerRun,'LIMIT','Limite inválido.');}
    let result;
    switch(cmd){
      case 'status':result=engine.status();break;
      case 'providers':result=engine.providers();break;
      case 'plan':result=engine.plan({limit});break;
      case 'list':result=engine.list();break;
      case 'show':result=engine.show(id);break;
      case 'usage':result=engine.status().usage;break;
      case 'research':result=await engine.research(id,{extraUrls:opts.urls||[]});break;
      case 'evidence':result=engine.evidence(id);break;
      case 'write':result=await engine.write(id,{provider:opts.provider||repo.config.provider,freeTierConfirmed:!!opts['confirm-free-tier'],retryReason:opts.reason||null});break;
      case 'verify':result=await engine.verify(id);break;
      case 'prepare-image':result=await engine.prepareImage(id);break;
      case 'import':result=await engine.importDraft(id);break;
      case 'enrich':result=await engine.enrichEvidence(id,{reason:opts.reason||'Enriquecimento editorial de evidências da fonte oficial.'});break;
      case 'revise':{
        check(opts.file,'CLI','Informe --file com o JSON revisado.');
        let draft;
        try{draft=JSON.parse(fs.readFileSync(opts.file,'utf8'));}catch{check(false,'CLI','JSON revisado inválido.');}
        result=await engine.reviseDraft(id,draft,{reason:opts.reason||'Revisão editorial controlada.'});
        break;
      }
      case 'quality':result=engine.quality(id);break;
      case 'eligibility':result=evaluatePublicationEligibility(repo,id);break;
      case 'repair-classification':result=await engine.repairFactualClassification(id,{reason:opts.reason||'Correção mecânica de classificação factual baseada em fonte primária.'});break;
      case 'repair-review-finding':
        check(opts['finding-id'],'CLI','Informe --finding-id.');
        result=await engine.repairReviewFinding(id,{findingId:opts['finding-id'],reason:opts.reason||'Correção mecânica baseada na evidência vinculada ao achado.'});
        break;
      case 'review':{
        if(opts.help){result={help:'Use review ID [--provider gemini] [--dry-run] [--confirm-free-tier]. O resultado é privado e vinculado ao hash do conteúdo.'};break;}
        result=await reviewEngine.review(id,{provider:opts.provider,freeTierConfirmed:!!opts['confirm-free-tier'],dryRun:!!opts['dry-run']});break;
      }
      case 'review-status':result=reviewEngine.status(id);break;
      case 'review-history':result=reviewEngine.history(id);break;
      case 'run':result=opts['dry-run']?engine.dryRun({limit}):await engine.run({limit,freeTierConfirmed:!!opts['confirm-free-tier']});break;
      case 'recover':result=repo.recover(opts.reason);break;
      default:check(false,'CLI','Comando não implementado.');
    }
    console.log(opts.json?JSON.stringify({ok:true,result}):JSON.stringify(result,null,2));
    return 0;
  }catch(error){
    const payload={ok:false,error:{code:error.code||'ERROR',message:error.message,...(error.category?{category:error.category}:{}),...(error.recommendedAction?{recommendedAction:error.recommendedAction}:{}),...(error.details?{details:error.details}:{})}};
    console.error(opts.json?JSON.stringify(payload):`Erro [${payload.error.code}]: ${payload.error.message}`);
    if(/^(LOCK|IO|ENOENT|EACCES|STATE_LIMIT)/.test(payload.error.code))return 4;
    if(['CREDENTIALS','FREE_TIER_UNCONFIRMED','PAID_BLOCKED','REVISION_INVALID','QUALITY_BLOCKED'].includes(payload.error.code))return 3;
    return 2;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
