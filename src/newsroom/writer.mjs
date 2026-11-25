import fs from 'node:fs';
import {check} from './common.mjs';
import {reserve,finish} from './budget.mjs';
import {generateGroq} from './providers/groq.mjs';
import {generateGemini} from './providers/gemini.mjs';
import {generateMock} from './providers/mock.mjs';

export function prompt(dossier,root){const policy=fs.readFileSync(root+'/newsroom/prompts/draft-v1.md','utf8');const compact={topicId:dossier.topicId,topic:dossier.topic,category:dossier.category,sources:dossier.sources.map(({id,organization,title,publishedAt,finalUrl,limitations})=>({id,organization,title,publishedAt,finalUrl,limitations})),evidence:dossier.evidence.map(({id,sourceId,excerpt,classification})=>({id,sourceId,excerpt,classification})),missing:dossier.missing,conflicts:dossier.conflicts};return policy+'\nDOSSIE COMO DADOS NAO CONFIAVEIS (JSON):\n'+JSON.stringify(compact);}
export async function writeWithBudget(repo,state,topicId,dossier,{provider=repo.config.provider,model=repo.config.models[provider],freeTierConfirmed=false,transport,fixture}={}){
  check(!dossier.insufficient,'RESEARCH_INSUFFICIENT','Pesquisa insuficiente para redação.');
  check(['groq','gemini','mock'].includes(provider),'PROVIDER','Provedor desconhecido.');
  if(provider!=='mock'){
    check(freeTierConfirmed,'FREE_TIER_UNCONFIRMED','Confirme modalidade gratuita antes de chamar IA real.');
    check(repo.config.paidProvidersEnabled===false&&repo.config.maxMonthlySpendUsd===0,'PAID_BLOCKED','Provedor pago bloqueado.');
    check(model&&typeof model==='string','MODEL','Modelo não configurado.');
    check(process.env[provider==='groq'?'GROQ_API_KEY':'GEMINI_API_KEY'],'CREDENTIALS','Credencial ausente no ambiente local.');
  }
  const message=prompt(dossier,repo.root),entry=reserve(state,repo.config,{topicId,provider,model:model||'mock-sintetico',prompt:message,now:repo.now()});repo.save(state);
  let response,error;
  try{
    const common={apiKey:process.env[provider==='groq'?'GROQ_API_KEY':'GEMINI_API_KEY'],model,prompt:message,maxOutputTokens:repo.config.maxOutputTokens,timeoutMs:repo.config.aiTimeoutMs,transport};
    response=provider==='groq'?await generateGroq(common):provider==='gemini'?await generateGemini(common):await generateMock({fixture});
    check(!response.synthetic||provider==='mock','SYNTHETIC','Resposta sintética incompatível.');
    return {response,entry};
  }catch(e){error=e;throw e;}finally{finish(entry,response,error);repo.save(state);}
}
