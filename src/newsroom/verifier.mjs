import {check} from './common.mjs';
import {checkSchema} from '../editorial/schema.mjs';
import {CLAIM_TAXONOMY_VERSION, CLAIM_NATURES, claimTaxonomyErrors} from './claim-taxonomy.mjs';
import {describeEvidence} from './evidence-quality.mjs';

const suspicious=/\b(?:TODO|TBD|placeholder)\b|<\s*\/?\s*[a-z]|javascript\s*:|&(?:lt|gt);/i;
const QUOTES=/["“”«»]/;
const NUMBER=/\b\d+(?:[.,]\d+)?\b/g;

function evidenceSupport(ids,evidence,sources){
  return ids.map(id=>{
    const item=evidence.get(id);
    return [item?.excerpt,sources.get(item?.sourceId)?.title].filter(Boolean).join(' ');
  }).join(' ');
}

function isTruncated(item){
  return item?.truncated===true||item?.completeness==='truncated'||describeEvidence(item?.excerpt||'',600).truncated;
}

function validateHeadline(kind,text,ids,{evidence,sources,claimsEvidence},errors){
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>!evidence.has(id))){
    errors.push({code:kind==='title'?'TITLE_EVIDENCE':'SUMMARY_EVIDENCE'});
    return;
  }
  if(ids.some(id=>!claimsEvidence.has(id)))errors.push({code:'HEADLINE_TRACEABILITY',field:kind});
  if(ids.some(id=>isTruncated(evidence.get(id))))errors.push({code:'HEADLINE_EVIDENCE_TRUNCATED',field:kind});
  const support=evidenceSupport(ids,evidence,sources);
  for(const number of String(text||'').match(NUMBER)||[])if(!support.includes(number))errors.push({code:kind==='title'?'TITLE_UNSUPPORTED_NUMBER':'SUMMARY_UNSUPPORTED_NUMBER',field:kind,value:number});
  const quoted=String(text||'').match(/["“«](.+?)["”»]/);
  if(quoted&&!support.includes(quoted[1]))errors.push({code:kind==='title'?'TITLE_UNSUPPORTED_QUOTE':'SUMMARY_UNSUPPORTED_QUOTE',field:kind});
}

export function verifyDraft(draft,dossier){
  const errors=[],warnings=[];
  if(!draft||typeof draft!=='object'||Array.isArray(draft))return {valid:false,errors:[{code:'JSON_SHAPE'}],warnings};
  const evidence=new Map((dossier.evidence||[]).map(e=>[e.id,e]));
  const sources=new Map((dossier.sources||[]).map(s=>[s.id,s]));
  const allowed=['title','slug','summary','category','tags','sections','claims','imageSuggestion','insufficient','reason','claimTaxonomyVersion','titleEvidenceIds','summaryEvidenceIds'];
  for(const k of Object.keys(draft))if(!allowed.includes(k))errors.push({code:'UNKNOWN_FIELD',field:k});
  if(draft.insufficient)return {valid:false,insufficient:true,errors:[{code:'RESEARCH_INSUFFICIENT',message:String(draft.reason||'Evidências insuficientes.')}],warnings};
  if(!draft.title||!draft.slug||!draft.summary||draft.category!==dossier.category||!Array.isArray(draft.tags)||!Array.isArray(draft.sections)||draft.sections.length<2||!Array.isArray(draft.claims))errors.push({code:'STRUCTURE'});
  if(draft.claimTaxonomyVersion!==CLAIM_TAXONOMY_VERSION)errors.push({code:'CLAIM_TAXONOMY_VERSION'});
  for(const key of ['title','slug','summary'])if(typeof draft[key]!=='string'||suspicious.test(draft[key]))errors.push({code:'INJECTION',field:key});
  for(const [i,tag] of (draft.tags||[]).entries())if(typeof tag!=='string'||suspicious.test(tag))errors.push({code:'INJECTION',field:`tags.${i}`});
  if(draft.imageSuggestion!==undefined&&draft.imageSuggestion!==null&&(typeof draft.imageSuggestion!=='string'||suspicious.test(draft.imageSuggestion)))errors.push({code:'INJECTION',field:'imageSuggestion'});
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug||''))errors.push({code:'SLUG'});
  const covered=new Set();
  for(const [i,section] of (draft.sections||[]).entries()){
    if(typeof section.title!=='string'||suspicious.test(section.title)||!Array.isArray(section.paragraphs)||!section.paragraphs.length)errors.push({code:'SECTION',index:i});
    for(const [j,p] of (section.paragraphs||[]).entries())if(typeof p!=='string'||!p.trim()||suspicious.test(p))errors.push({code:'PARAGRAPH',section:i,paragraph:j});
  }
  const claimsEvidence=new Set();
  for(const [i,c] of (draft.claims||[]).entries()){
    const paragraph=draft.sections?.[c.section]?.paragraphs?.[c.paragraph],key=`${c.section}:${c.paragraph}`;
    if(!paragraph||c.text!==paragraph||covered.has(key))errors.push({code:'CLAIM_MAPPING',index:i});
    covered.add(key);
    if(!Array.isArray(c.evidenceIds)||!c.evidenceIds.length||c.evidenceIds.some(id=>!evidence.has(id)))errors.push({code:'UNKNOWN_EVIDENCE',index:i});
    for(const id of c.evidenceIds||[])claimsEvidence.add(id);
    if(!['confirmed','attributed','expectation','rumor','opinion'].includes(c.classification))errors.push({code:'CLAIM_TYPE',index:i});
    if(!CLAIM_NATURES.includes(c.nature))errors.push({code:'CLAIM_NATURE',index:i});
    for(const item of claimTaxonomyErrors(c))errors.push({...item,index:i});
    const support=evidenceSupport(c.evidenceIds||[],evidence,sources);
    for(const number of c.text?.match(NUMBER)||[])if(!support.includes(number))errors.push({code:'UNSUPPORTED_NUMBER',index:i,value:number});
    if(QUOTES.test(c.text||'')&&!support.includes((c.text.match(/["“«](.+?)["”»]/)||[])[1]||'\u0000'))errors.push({code:'UNSUPPORTED_QUOTE',index:i});
    if((c.evidenceIds||[]).some(id=>isTruncated(evidence.get(id))))warnings.push({code:'TRUNCATED_EVIDENCE',index:i,message:'Trecho truncado exige revisão de contexto antes de publicação.'});
  }
  for(const [i,section] of (draft.sections||[]).entries())for(let j=0;j<(section.paragraphs||[]).length;j++)if(!covered.has(`${i}:${j}`))errors.push({code:'UNCITED_PARAGRAPH',section:i,paragraph:j});
  validateHeadline('title',draft.title,draft.titleEvidenceIds,{evidence,sources,claimsEvidence},errors);
  validateHeadline('summary',draft.summary,draft.summaryEvidenceIds,{evidence,sources,claimsEvidence},errors);
  if(dossier.conflicts?.length)warnings.push({code:'SOURCE_CONFLICT',message:'Divergência documentada requer revisão humana.'});
  if(new Set((dossier.sources||[]).map(s=>s.organization)).size<2)warnings.push({code:'ONE_ORGANIZATION',message:'Sem confirmação independente; atribuir declarações à origem.'});
  warnings.push({code:'HUMAN_FACT_REVIEW',message:'Correspondência de IDs/números não certifica semântica ou factualidade.'});
  return {valid:errors.length===0,errors,warnings};
}

export function editorialInput(topic,draft,dossier,image=null){
  const sources=(dossier.sources||[]).map(s=>({id:s.id,name:s.organization,url:s.finalUrl,checkedAt:s.checkedAt.slice(0,10),kind:s.type,...(s.publishedAt?{publishedDate:s.publishedAt.slice(0,10)}:{})}));
  const map=new Map((dossier.evidence||[]).map(e=>[e.id,e]));
  const claims=draft.claims.map((c,i)=>({
    id:`claim-${i+1}`,
    section:c.section,
    paragraph:c.paragraph,
    text:c.text,
    classification:c.classification,
    nature:c.nature,
    ...(c.attribution?{attribution:c.attribution}:{}),
    sourceIds:[...new Set(c.evidenceIds.map(id=>map.get(id).sourceId))],
    evidenceIds:[...c.evidenceIds],
    evidence:c.evidenceIds.map(id=>`${id}: ${map.get(id).excerpt}`).join(' | ').slice(0,4000),
  }));
  const input={
    schemaVersion:'1.0',
    id:`newsroom-${topic.id}`,
    operation:'create',
    synthetic:false,
    origin:{type:'json',reference:`Pauta ${topic.id}; dossiê privado do newsroom; revisão editorial humana ainda não realizada.`},
    article:{
      title:draft.title,
      slug:draft.slug,
      summary:draft.summary,
      category:draft.category,
      tags:draft.tags,
      language:'pt-BR',
      editorial:{name:'Pulso Digital',role:'Edição institucional provisória'},
      claimTaxonomyVersion:draft.claimTaxonomyVersion,
      traceability:{titleEvidenceIds:[...draft.titleEvidenceIds],summaryEvidenceIds:[...draft.summaryEvidenceIds]},
      sections:draft.sections,
      sources,
      claims,
      ...(image?{image}:{}),
    },
  };
  check(checkSchema(input).length===0,'EDITORIAL_SCHEMA','Rascunho fora do contrato editorial 1.0.');
  return input;
}
