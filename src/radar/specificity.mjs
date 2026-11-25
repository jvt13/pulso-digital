import {normalize} from './common.mjs';
import {hasTerm} from './classifier.mjs';
export function specificity(topic,classification,duplicates,config){
  const title=normalize(topic),words=title.split(' ');
  const base={administrative:!!classification.administrative?.length,discoveryCategory:classification.discoveryCategory||null};
  if(base.administrative)return {...base,type:'insufficient-context',reason:'Comunicado administrativo/institucional: não concorre com acontecimentos na fila editorial.',evidence:classification.administrative};
  if(classification.discoveryCategory)return {...base,type:'broad-topic',reason:'Entidade ampla reconhecida, sem acontecimento no título.',evidence:[title]};
  if(classification.outOfScope)return {...base,type:'insufficient-context',reason:'Não há conexão contextual suficiente com uma editoria.',evidence:[]};
  const actions=config.actions.filter(t=>hasTerm(title,t)),technical=config.technicalContexts.filter(t=>hasTerm(title,t));
  const version=(classification.rules||[]).flatMap(r=>r.contextual||[]).some(r=>r.version);
  const specific=words.length>=config.minimumWords&&(actions.length>0||technical.length>0||version);
  if(!specific)return {...base,type:'broad-topic',reason:'Há assunto editorial, mas faltam detalhes de um acontecimento específico no título.',evidence:[...actions,...technical]};
  const update=duplicates.some(d=>d.kind==='possible-update');
  return {...base,type:update?'possible-update':'specific-event',reason:update?'Acontecimento contextualizado com possível relação com matéria existente; revisão necessária.':'Título descreve candidato específico; não constitui confirmação factual.',evidence:[...actions,...technical,...(version?['versão de produto']:[])]};
}
