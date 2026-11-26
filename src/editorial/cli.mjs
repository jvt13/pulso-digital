import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { Repository } from './repository.mjs';
import { EditorialEngine } from './engine.mjs';
import { ensure } from './schema.mjs';
import { createPrivatePreview } from './preview.mjs';

const HELP=`Motor editorial Pulso Digital — contrato 1.0
Uso: npm run editorial -- COMANDO [ID/arquivo] [opções]

help                          Exibir ajuda
import caminho.json           Importar de editorial/fixtures/ ou editorial/data/incoming/
list                          Listar IDs e estados
show ID                       Inspecionar envelope privado
validate ID                   Executar validações sem acessar a internet
approve ID --reviewer ID --facts-reviewed --image-rights-reviewed --acknowledge-warnings
                              Aprovar explicitamente após revisão editorial real
reject ID --reason TEXTO       Rejeitar antes da publicação
draft ID --reason TEXTO        Reabrir para revisão e invalidar aprovação
revise ID caminho.json --reason TEXTO
                              Alterar rascunho com histórico e nova validação obrigatória
publish ID [--dry-run]         Preparar/verificar; dry-run não modifica dados persistentes
history ID                    Mostrar cadeia de transições
status                        Mostrar estados, lock e recuperação pendente
recover [--break-lock --reason TEXTO]
                              Recuperar diário; liberar somente lock de processo morto

Opções globais: --json (saída estruturada), --root DIRETORIO (cópia isolada do projeto).
Nenhum comando executa commit, push, deploy ou requisições externas.
Importar/validar não publica. Aprovar depende da revisão factual e dos direitos de imagem.
`;

export function main(argv=process.argv.slice(2)) {
  const args=[],options={};
  const booleans=new Set(['json','dry-run','facts-reviewed','image-rights-reviewed','acknowledge-warnings','break-lock']);
  const values=new Set(['root','reviewer','reason','target']);
  try {
    for(let i=0;i<argv.length;i++){
      if(argv[i].startsWith('--')){
        const name=argv[i].slice(2);
        ensure(booleans.has(name)||values.has(name),'CLI_OPTION','Opção desconhecida: '+name);
        ensure(!Object.hasOwn(options,name),'CLI_OPTION','Opção repetida: '+name);
        if(booleans.has(name))options[name]=true;
        else {ensure(argv[i+1]&&!argv[i+1].startsWith('--'),'CLI_OPTION','Valor ausente: '+name);options[name]=argv[++i];}
      }else args.push(argv[i]);
    }
    const [command='help',id,file]=args;
    const commandOptions={approve:['reviewer','facts-reviewed','image-rights-reviewed','acknowledge-warnings','reason'],reject:['reason'],draft:['reason'],revise:['reason'],publish:['dry-run'],preview:['target'],recover:['break-lock','reason']};
    ensure(Object.keys(options).every(key=>['root','json',...(commandOptions[command]||[])].includes(key)),'CLI_OPTION','Opção não aplicável ao comando; --dry-run só se aplica a publish.');
    if(command==='help'){console.log(options.json?JSON.stringify({ok:true,help:HELP}):HELP);return 0;}
    const root=options.root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    const repo=new Repository(root),engine=new EditorialEngine(repo);
    const needsId=['import','show','validate','approve','reject','draft','revise','publish','preview','history'];
    ensure(!needsId.includes(command)||id,'CLI_ARGUMENT','Informe o identificador ou arquivo.');
    ensure(args.length <= (command==='revise'?3:needsId.includes(command)?2:1),'CLI_ARGUMENT','Argumentos extras não são permitidos.');
    let result;
    switch(command){
      case 'import':result=engine.import(id);break;
      case 'list':result=repo.list().map(r=>({id:r.input.id,state:r.state,title:r.input.article.title}));break;
      case 'show':result=repo.get(id);break;
      case 'history':result=repo.get(id).history;break;
      case 'validate':result=engine.validate(id);break;
      case 'approve':result=engine.approve(id,{reviewer:options.reviewer,factsReviewed:options['facts-reviewed'],imageRightsReviewed:options['image-rights-reviewed'],acknowledgeWarnings:options['acknowledge-warnings'],...(options.reason?{reason:options.reason}:{})});break;
      case 'reject':result=engine.reject(id,options.reason);break;
      case 'draft':result=engine.draft(id,options.reason);break;
      case 'revise':ensure(file,'CLI_ARGUMENT','Informe o JSON revisado.');result=engine.revise(id,file,options.reason);break;
      case 'publish':result=engine.publish(id,{dryRun:!!options['dry-run']});break;
      case 'preview':ensure(options.target,'CLI_ARGUMENT','Informe --target.');result=createPrivatePreview(repo,id,{target:options.target});break;
      case 'recover':result=engine.recover({breakLock:!!options['break-lock'],reason:options.reason});break;
      case 'status':result={schemaVersion:repo.config.schemaVersion,counts:fs.existsSync(repo.lock)||fs.existsSync(repo.journal)?null:repo.list().reduce((a,r)=>(a[r.state]=(a[r.state]||0)+1,a),{}),locked:fs.existsSync(repo.lock),recoveryRequired:fs.existsSync(repo.journal),automaticApproval:false,automaticDeploy:false};break;
      default:ensure(false,'CLI_COMMAND','Comando desconhecido; execute help.');
    }
    const valid=result?.result?.valid!==false;
    console.log(options.json?JSON.stringify({ok:valid,result}):`${valid?'Operação concluída.':'Validação bloqueada.'}\n${JSON.stringify(result,null,2)}`);
    return valid?0:2;
  }catch(error){
    const code=error.code||'IO_ERROR';
    const output={ok:false,error:{code,message:error.message,details:error.details||null}};
    console.error(options.json?JSON.stringify(output):`Erro [${code}]: ${error.message}${error.details?'\n'+JSON.stringify(error.details,null,2):''}`);
    if(/DUPLICATE|COLLISION/.test(code))return 4;
    if(/LOCK|RECOVERY|WRITE|BUILD|IO_|ENOENT|EACCES|CONCURRENT/.test(code))return 5;
    if(/APPROV|TRANSITION|VALIDATED|REVIEW|WARNINGS/.test(code))return 3;
    return 2;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=main();
