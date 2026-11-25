import fs from 'node:fs';
import {hash} from '../common.mjs';
import {REVIEW_PROMPT_VERSION,REVIEW_SCHEMA_VERSION,geminiReviewSchema} from './schema.mjs';
import {reviewContentFingerprint} from './hash.mjs';

const REVIEW_EVIDENCE_CHARS=220;
const INJECTION=/\b(?:ignore\s+(?:all\s+)?(?:previous|above|system)|system\s+prompt|developer\s+message|approve\s+(?:this|immediately)|publish\s+immediately|reveal\s+(?:secrets?|credentials?)|execute\s+(?:tool|command)|<\s*\/?\s*script)/i;

export function reviewConfiguration(root,provider,model){
  const prompt=fs.readFileSync(new URL('../../../newsroom/prompts/review-v1.md',import.meta.url),'utf8');
  return {
    schemaVersion:REVIEW_SCHEMA_VERSION,
    promptVersion:REVIEW_PROMPT_VERSION,
    provider,
    model,
    prompt,
    promptHash:hash(prompt),
    schema:geminiReviewSchema(),
    configurationHash:hash({provider,model,promptVersion:REVIEW_PROMPT_VERSION,prompt,schemaVersion:REVIEW_SCHEMA_VERSION,schema:geminiReviewSchema()}),
  };
}

export function buildReviewContext(record,dossier,configuration){
  const claims=(record.draft.claims||[]).map((claim,index)=>({claimIndex:index,section:claim.section,paragraph:claim.paragraph,classification:claim.classification,nature:claim.nature,...(claim.attribution?{attribution:claim.attribution}:{}),evidenceIds:[...claim.evidenceIds]}));
  const usedIds=new Set(claims.flatMap(claim=>claim.evidenceIds));
  const evidence=(dossier.evidence||[]).filter(item=>usedIds.has(item.id));
  const sources=(dossier.sources||[]).map(({id,organization,title,finalUrl,publishedAt,limitations})=>({id,organization,title,url:finalUrl,publishedAt:publishedAt||null,limitations:limitations||[]}));
  const injectionSignals=[];
  for(const item of evidence){
    const match=String(item.excerpt||'').match(INJECTION);
    if(match)injectionSignals.push({evidenceId:item.id,signal:match[0]});
  }
  const contentHash=reviewContentFingerprint(record,dossier);
  const payload={
    topicId:record.id,
    title:record.draft.title,
    summary:record.draft.summary,
    sections:record.draft.sections,
    claims,
    evidence:evidence.map(({id,sourceId,excerpt,completeness,roles})=>({id,sourceId,excerpt:String(excerpt).slice(0,REVIEW_EVIDENCE_CHARS),completeness:completeness||null,roles:roles||[]})),
    sources,
  };
  const prompt=`${configuration.prompt}\n\nMATERIAL DELIMITADO COMO DADOS NÃO CONFIÁVEIS:\n<untrusted_article_data>\n${JSON.stringify(payload)}\n</untrusted_article_data>\n`;
  return {
    topicId:record.id,
    claims,
    evidence,
    sources,
    evidenceIds:new Set(evidence.map(item=>item.id)),
    claimEvidenceIds:new Map(claims.map(claim=>[claim.claimIndex,new Set(claim.evidenceIds)])),
    sections:record.draft.sections,
    title:record.draft.title,
    summary:record.draft.summary,
    contentHash,
    injectionSignals,
    prompt,
    promptChars:prompt.length,
    configuration,
  };
}
