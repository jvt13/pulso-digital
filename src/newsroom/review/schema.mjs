import fs from 'node:fs';
import {check} from '../common.mjs';

export const REVIEW_SCHEMA_VERSION='1.0';
export const REVIEW_PROMPT_VERSION='review-v1';
export const REVIEW_RESULTS=['pass','changes-required','research-required','human-review-required','blocked'];
export const REVIEW_SEVERITIES=['critical','major','minor','informational'];
export const REVIEW_CATEGORIES=['factual','evidence','attribution','translation','headline','independence','editorial-quality','privacy','injection','other'];
export const CLAIM_STATUSES=['supported','partially-supported','unsupported','contradicted','ambiguous','insufficient-evidence'];
export const reviewSchema=JSON.parse(fs.readFileSync(new URL('../../../newsroom/schemas/review-v1.schema.json',import.meta.url),'utf8'));

export function geminiReviewSchema(){
  const {$schema,$id,...schema}=reviewSchema;
  return schema;
}

export function checkReviewShape(value){
  const errors=[];
  const object=value&&typeof value==='object'&&!Array.isArray(value);
  if(!object)return [{code:'REVIEW_SHAPE',message:'A revisão deve ser um objeto.'}];
  const allowed=['schemaVersion','result','summary','findings','claimAssessments','limitations','humanReviewRequired'];
  for(const key of Object.keys(value))if(!allowed.includes(key))errors.push({code:'REVIEW_UNKNOWN_FIELD',field:key});
  if(value.schemaVersion!==REVIEW_SCHEMA_VERSION)errors.push({code:'REVIEW_SCHEMA_VERSION'});
  if(!REVIEW_RESULTS.includes(value.result))errors.push({code:'REVIEW_RESULT'});
  if(typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>4000)errors.push({code:'REVIEW_SUMMARY'});
  if(!Array.isArray(value.findings))errors.push({code:'REVIEW_FINDINGS'});
  if(!Array.isArray(value.claimAssessments))errors.push({code:'REVIEW_ASSESSMENTS'});
  if(!Array.isArray(value.limitations)||value.limitations.some(item=>typeof item!=='string'||item.length>1000))errors.push({code:'REVIEW_LIMITATIONS'});
  if(typeof value.humanReviewRequired!=='boolean')errors.push({code:'REVIEW_HUMAN_FLAG'});
  return errors;
}

export function assertReviewShape(value){
  const errors=checkReviewShape(value);
  check(!errors.length,'REVIEW_CONTRACT',errors.map(item=>item.code).join(', '));
}
