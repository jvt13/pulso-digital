import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {RadarRepository} from './repository.mjs';
import {RadarEngine} from './engine.mjs';
import {check} from './common.mjs';
const help=`Radar Pulso Digital — contratos de pautas 1.0 e 1.1
Uso: npm run radar -- COMANDO [ID] [opções]
help | sources | fetch [--region BR] [--dry-run]
list [--category games] [--min-score 60] | top [--mode trends|editorial|legacy] [--limit 10]
reclassify [--dry-run]          Reavaliar regras, sem criar observações
show ID | queue ID | dismiss ID --reason "Motivo" | defer ID --reason "Motivo"
history ID | status | export [--mode trends|editorial|legacy] [--limit 10] [--schema-version 1.0|1.1]
recover --reason "Processo anterior encerrado"
restore --backup ID --reason "Motivo" [--dry-run]   Restaurar migração sem sobrescrever alterações posteriores
Globais: --json, --root DIRETORIO. Leituras e dry-run não gravam dados.
Nenhum comando redige, aprova, importa no motor editorial, publica, executa Git ou deploy.
`;
export async function main(argv=process.argv.slice(2)){
  const options={},args=[];
  try{
    for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--')){args.push(argv[i]);continue;}const key=argv[i].slice(2);check(['json','dry-run','root','region','category','min-score','limit','reason','mode','schema-version','backup'].includes(key)&&!Object.hasOwn(options,key),'CLI','Opção desconhecida/repetida.');if(['json','dry-run'].includes(key))options[key]=true;else{check(argv[i+1]&&!argv[i+1].startsWith('--'),'CLI','Opção sem valor.');options[key]=argv[++i];}}
    const [cmd='help',id]=args,allowed={fetch:['region','dry-run'],reclassify:['dry-run'],restore:['backup','reason','dry-run'],list:['category','min-score','limit','mode'],top:['category','min-score','limit','mode'],export:['category','min-score','limit','mode','schema-version'],dismiss:['reason'],defer:['reason'],queue:['reason'],recover:['reason']};
    check(Object.keys(options).every(k=>['json','root',...(allowed[cmd]||[])].includes(k)),'CLI','Opção não se aplica ao comando.');
    const needs=['show','queue','dismiss','defer','history'].includes(cmd);check(args.length<=(needs?2:1)&&(!needs||id),'CLI','Argumentos inválidos; execute help.');
    if(cmd==='help'){console.log(options.json?JSON.stringify({ok:true,help}):help);return 0;}
    const repo=new RadarRepository(options.root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')),engine=new RadarEngine(repo);
    const filters={};if(options.category)filters.category=options.category;if(options.mode)filters.mode=options.mode;if(options['schema-version'])filters.version=options['schema-version'];
    for(const [key,target,max] of [['min-score','minScore',100],['limit','limit',2000]])if(options[key]!==undefined){const n=Number(options[key]);check(Number.isFinite(n)&&n>=0&&n<=max&&(key!=='limit'||Number.isInteger(n)&&n>0),'CLI','Filtro numérico inválido.');filters[target]=n;}
    let result;
    switch(cmd){
      case 'sources':result=repo.sources;break;
      case 'fetch':result=await engine.fetch({region:options.region,dryRun:!!options['dry-run']});break;
      case 'reclassify':result=await engine.reclassify({dryRun:!!options['dry-run']});break;
      case 'restore':result=await repo.restoreSnapshot(options.backup,options.reason,{dryRun:!!options['dry-run']});break;
      case 'list':result=engine.list(filters);break;
      case 'top':result=engine.list({limit:10,...filters,top:true});break;
      case 'show':result=engine.show(id);break;
      case 'history':result=engine.show(id).history;break;
      case 'queue':result=await engine.setStatus(id,'queued',options.reason||'Seleção explícita para futura pesquisa.');break;
      case 'dismiss':result=await engine.setStatus(id,'dismissed',options.reason);break;
      case 'defer':result=await engine.setStatus(id,'deferred',options.reason);break;
      case 'export':result=engine.export({limit:10,...filters});break;
      case 'recover':result=repo.breakLock(options.reason);break;
      case 'status':{const s=repo.read();result={topics:s.topics.length,runs:s.runs.length,legacyTopics:s.topics.filter(t=>t.schemaVersion==='1.0').length,ruleVersion:repo.config.classification.version,locked:fs.existsSync(repo.lock),retention:repo.retention(s),automaticPublication:false,automaticEditorialImport:false};break;}
      default:check(false,'CLI','Comando desconhecido; execute help.');
    }
    const failed=cmd==='fetch'&&result.providers.every(r=>['error','deferred'].includes(r.mode));
    console.log(options.json?JSON.stringify({ok:!failed,result}):`${failed?'Nenhuma fonte disponível.':'Operação concluída.'}\n${JSON.stringify(result,null,2)}`);return failed?3:0;
  }catch(e){const error={code:e.code||'IO',message:e.message};console.error(options.json?JSON.stringify({ok:false,error}):`Erro [${error.code}]: ${error.message}`);return /^(LOCK_|CONCURRENT_|STORAGE_|IO$|ENOENT$|EACCES$)/.test(error.code)?4:2;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
