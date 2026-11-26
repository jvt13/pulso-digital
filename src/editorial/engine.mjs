import fs from 'node:fs';
import { ensure } from './schema.mjs';
import { transition } from './lifecycle.mjs';
import { validate } from './validator.mjs';
import { publish } from './publisher.mjs';

export class EditorialEngine {
  constructor(repository) { this.repo = repository; }
  import(file) {
    return this.repo.withLock(()=>{
      const input=this.repo.input(file);
      ensure(!this.repo.exists(input.id),'DUPLICATE_ID','Identificador já importado; use revise para revisão controlada.');
      let record=transition(null,'pending',{action:'import',reason:'Entrada manual recebida; nenhuma publicação realizada.',at:this.repo.now(),patch:{recordVersion:'1.0',input,createdAt:this.repo.now(),validation:null,approval:null,receipt:null}});
      record=transition(record,'draft',{action:'draft',reason:'Rascunho aberto para revisão editorial.',at:this.repo.now()});
      this.repo.save(record); return record;
    });
  }
  revise(id,file,reason) {
    return this.repo.withLock(()=>{
      const old=this.repo.get(id),input=this.repo.input(file);
      ensure(input.id===id && input.operation===old.input.operation && input.targetSlug===old.input.targetSlug,'REVISION_ID','Identificador, operação e alvo não podem ser trocados por uma revisão.');
      ensure(old.state!=='published','INVALID_TRANSITION','Matéria publicada exige nova operação update com outro ID.');
      // A draft must first retain an explicit rejection event when edited in place.
      let record=old;
      if(record.state==='draft')record=transition(record,'rejected',{action:'reject',reason:'Revisão controlada do rascunho: '+reason,at:this.repo.now()});
      record=transition(record,'draft',{action:'revise',reason,at:this.repo.now(),patch:{input,validation:null,approval:null,receipt:null}});
      this.repo.save(record);return record;
    });
  }
  draft(id,reason) {
    return this.repo.withLock(()=>{const old=this.repo.get(id);const record=transition(old,'draft',{action:'reopen',reason,at:this.repo.now(),patch:{validation:null,approval:null}});this.repo.save(record);return record;});
  }
  validate(id) {
    return this.repo.withLock(()=>{
      const old=this.repo.get(id);ensure(old.state==='draft','INVALID_TRANSITION','Valide um rascunho; reabra para revisão quando necessário.');
      const result=validate(this.repo,old.input);
      const record=transition(old,result.valid?'validated':'draft',{action:result.valid?'validate':'validation-failed',reason:result.valid?'Validações determinísticas aprovadas; revisão factual ainda obrigatória.':'Validação bloqueada: '+result.errors.map(e=>e.code).join(', '),at:this.repo.now(),patch:{validation:result,approval:null}});
      this.repo.save(record);return {record,result};
    });
  }
  approve(id,{reviewer,factsReviewed=false,imageRightsReviewed=false,acknowledgeWarnings=false,reason='Aprovação editorial explícita após revisão de fatos e direitos de imagem.'}={}) {
    return this.repo.withLock(()=>{
      const old=this.repo.get(id);
      ensure(old.state==='validated' && old.validation?.valid,'NOT_VALIDATED','A aprovação exige validações obrigatórias concluídas.');
      ensure(typeof reviewer==='string' && reviewer.trim().length>=2 && reviewer.length<=200 && !/[<>\u0000]/.test(reviewer),'REVIEWER_REQUIRED','Informe explicitamente a identificação do operador responsável.');
      ensure(factsReviewed && imageRightsReviewed,'EXPLICIT_REVIEW_REQUIRED','Confirme explicitamente a revisão factual e a autorização da imagem.');
      const result=validate(this.repo,old.input);
      ensure(result.valid && result.contentHash===old.validation.contentHash,'VALIDATION_CHANGED','Conteúdo, alvo ou imagens mudaram; reabra e valide novamente.',result);
      ensure(acknowledgeWarnings || !result.warnings.length,'WARNINGS_REVIEW_REQUIRED','Leia e reconheça os avisos antes de aprovar.',result.warnings);
      const approval={reviewer:reviewer.trim(),at:this.repo.now(),contentHash:result.contentHash,factsReviewed:true,imageRightsReviewed:true,acknowledgedWarnings:result.warnings.map(w=>w.code),reason};
      const record=transition(old,'approved',{action:'approve',actor:reviewer.trim(),reason,at:this.repo.now(),patch:{approval}});
      this.repo.save(record);return record;
    });
  }
  reject(id,reason) {return this.repo.withLock(()=>{const record=transition(this.repo.get(id),'rejected',{action:'reject',reason,at:this.repo.now(),patch:{approval:null,validation:null}});this.repo.save(record);return record;});}
  publish(id,options) {return publish(this.repo,id,options);}
  recover({breakLock=false,reason}={}) {if(breakLock)this.repo.breakOrphanLock(reason);return this.repo.withLock(()=>this.repo.recover(),{recovery:true});}
}
