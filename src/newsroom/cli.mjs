import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NewsroomRepository} from './repository.mjs';
import {NewsroomEngine} from './engine.mjs';
import {check} from './common.mjs';
import {loadLocalEnv} from './env.mjs';

const help=`Newsroom privado Pulso Digital — PD-005
Uso: npm run newsroom -- COMANDO [ID] [opções]
help | status | providers | plan [--limit 3] | list | show ID | usage
research ID [--url URL] | evidence ID | write ID [--provider groq|gemini]
verify ID | prepare-image ID | import ID | run [--limit 3] [--dry-run]
recover --reason "Justificativa"
Globais: --json, --root DIRETORIO. Para IA real: --confirm-free-tier após confirmar conta gratuita; chave apenas em variável de ambiente.
Nenhum comando aprova, publica, faz commit, push ou deploy editorial.
`;
export async function main(argv=process.argv.slice(2)){
  const opts={},args=[];
  try{
    for(let i=0;i<argv.length;i++){const arg=argv[i];if(!arg.startsWith('--')){args.push(arg);continue;}const k=arg.slice(2);check(['json','root','limit','dry-run','url','provider','reason','confirm-free-tier'].includes(k),'CLI','Opção desconhecida.');if(['json','dry-run','confirm-free-tier'].includes(k)){check(!opts[k],'CLI','Opção repetida.');opts[k]=true;}else{check(argv[i+1]&&!argv[i+1].startsWith('--'),'CLI','Opção sem valor.');if(k==='url')(opts.urls??=[]).push(argv[++i]);else{check(opts[k]===undefined,'CLI','Opção repetida.');opts[k]=argv[++i];}}}
    const [cmd='help',id]=args,needId=['show','research','evidence','write','verify','prepare-image','import'].includes(cmd),allowed={help:[],status:[],providers:[],plan:['limit'],list:[],show:[],usage:[],research:['urls'],evidence:[],write:['provider','confirm-free-tier'],verify:[],'prepare-image':[],import:[],run:['limit','dry-run','confirm-free-tier'],recover:['reason']};
    check(Object.hasOwn(allowed,cmd)&&args.length===(needId?2:1)&&Object.keys(opts).every(k=>['root','json',...allowed[cmd]].includes(k)),'CLI','Comando ou opções inválidos; execute help.');
    if(cmd==='help'){console.log(opts.json?JSON.stringify({ok:true,help}):help);return 0;}
    const root=opts.root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');loadLocalEnv(root);const repo=new NewsroomRepository(root),engine=new NewsroomEngine(repo);
    let limit=repo.config.maxTopicsPerRun;if(opts.limit){limit=Number(opts.limit);check(Number.isInteger(limit)&&limit>0&&limit<=repo.config.maxTopicsPerRun,'LIMIT','Limite inválido.');}
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
      case 'write':result=await engine.write(id,{provider:opts.provider||repo.config.provider,freeTierConfirmed:!!opts['confirm-free-tier']});break;
      case 'verify':result=await engine.verify(id);break;
      case 'prepare-image':result=await engine.prepareImage(id);break;
      case 'import':result=await engine.importDraft(id);break;
      case 'run':result=opts['dry-run']?engine.dryRun({limit}):await engine.run({limit,freeTierConfirmed:!!opts['confirm-free-tier']});break;
      case 'recover':result=repo.recover(opts.reason);break;
    }
    console.log(opts.json?JSON.stringify({ok:true,result}):JSON.stringify(result,null,2));return 0;
  }catch(e){const error={code:e.code||'ERROR',message:e.message};console.error(opts.json?JSON.stringify({ok:false,error}):`Erro [${error.code}]: ${error.message}`);return /^(LOCK|IO|ENOENT|EACCES|STATE_LIMIT)/.test(error.code)?4:['CREDENTIALS','FREE_TIER_UNCONFIRMED','PAID_BLOCKED'].includes(error.code)?3:2;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
