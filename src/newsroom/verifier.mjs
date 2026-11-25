import {check} from './common.mjs';
import {checkSchema} from '../editorial/schema.mjs';
const suspicious=/\b(?:TODO|TBD|placeholder)\b|<\s*\/?\s*[a-z]|javascript\s*:|&(?:lt|gt);/i;
export function verifyDraft(draft,dossier){
  const errors=[],warnings=[];
  if(!draft||typeof draft!=='object'||Array.isArray(draft))return {valid:false,errors:[{code:'JSON_SHAPE'}],warnings};
  const evidence=new Map(dossier.evidence.map(e=>[e.id,e]));
  const allowed=['title','slug','summary','category','tags','sections','claims','imageSuggestion','insufficient','reason'];
  for(const k of Object.keys(draft))if(!allowed.includes(k))errors.push({code:'UNKNOWN_FIELD',field:k});
  if(draft.insufficient)return {valid:false,insufficient:true,errors:[{code:'RESEARCH_INSUFFICIENT',message:String(draft.reason||'Evidências insuficientes.')}],warnings};
  if(!draft.title||!draft.slug||!draft.summary||draft.category!==dossier.category||!Array.isArray(draft.tags)||!Array.isArray(draft.sections)||draft.sections.length<2||!Array.isArray(draft.claims))errors.push({code:'STRUCTURE'});
  for(const key of ['title','slug','summary'])if(typeof draft[key]!=='string'||suspicious.test(draft[key]))errors.push({code:'INJECTION',field:key});
  for(const [i,tag] of (draft.tags||[]).entries())if(typeof tag!=='string'||suspicious.test(tag))errors.push({code:'INJECTION',field:`tags.${i}`});
  if(draft.imageSuggestion!==undefined&&draft.imageSuggestion!==null&&(typeof draft.imageSuggestion!=='string'||suspicious.test(draft.imageSuggestion)))errors.push({code:'INJECTION',field:'imageSuggestion'});
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug||''))errors.push({code:'SLUG'});
  const covered=new Set();
  for(const [i,section] of (draft.sections||[]).entries()){
    if(typeof section.title!=='string'||suspicious.test(section.title)||!Array.isArray(section.paragraphs)||!section.paragraphs.length)errors.push({code:'SECTION',index:i});
    for(const [j,p] of (section.paragraphs||[]).entries())if(typeof p!=='string'||!p.trim()||suspicious.test(p))errors.push({code:'PARAGRAPH',section:i,paragraph:j});
  }
  for(const [i,c] of (draft.claims||[]).entries()){
    const paragraph=draft.sections?.[c.section]?.paragraphs?.[c.paragraph];const key=`${c.section}:${c.paragraph}`;
    if(!paragraph||c.text!==paragraph||covered.has(key))errors.push({code:'CLAIM_MAPPING',index:i});covered.add(key);
    if(!Array.isArray(c.evidenceIds)||!c.evidenceIds.length||c.evidenceIds.some(id=>!evidence.has(id)))errors.push({code:'UNKNOWN_EVIDENCE',index:i});
    if(!['confirmed','expectation','rumor','opinion'].includes(c.classification))errors.push({code:'CLAIM_TYPE',index:i});
    const excerpts=(c.evidenceIds||[]).map(id=>evidence.get(id)?.excerpt||'').join(' ');
    const numerals=(c.text||'').match(/\b\d+(?:[.,]\d+)?\b/g)||[];
    for(const number of numerals)if(!excerpts.includes(number))errors.push({code:'UNSUPPORTED_NUMBER',index:i,value:number});
    if(/[“”"«»]/.test(c.text||'')&&!excerpts.includes((c.text.match(/[“"«](.+?)[”"»]/)||[])[1]||'\u0000'))errors.push({code:'UNSUPPORTED_QUOTE',index:i});
  }
  for(const [i,section] of (draft.sections||[]).entries())for(let j=0;j<(section.paragraphs||[]).length;j++)if(!covered.has(`${i}:${j}`))errors.push({code:'UNCITED_PARAGRAPH',section:i,paragraph:j});
  if(dossier.conflicts?.length)warnings.push({code:'SOURCE_CONFLICT','message':'Divergência documentada requer revisão humana.'});
  if(new Set(dossier.sources.map(s=>s.organization)).size<2)warnings.push({code:'ONE_ORGANIZATION','message':'Sem confirmação independente; atribuir declarações à origem.'});
  warnings.push({code:'HUMAN_FACT_REVIEW','message':'Correspondência de IDs/números não certifica semântica ou factualidade.'});
  return {valid:errors.length===0,errors,warnings};
}
export function editorialInput(topic,draft,dossier,image=null){
  const sources=dossier.sources.map(s=>({id:s.id,name:s.organization,url:s.finalUrl,checkedAt:s.checkedAt.slice(0,10),kind:s.type,...(s.publishedAt?{publishedDate:s.publishedAt.slice(0,10)}:{})}));
  const map=new Map(dossier.evidence.map(e=>[e.id,e]));
  const claims=draft.claims.map((c,i)=>({id:`claim-${i+1}`,section:c.section,paragraph:c.paragraph,text:c.text,classification:c.classification,sourceIds:[...new Set(c.evidenceIds.map(id=>map.get(id).sourceId))],evidence:c.evidenceIds.map(id=>`${id}: ${map.get(id).excerpt}`).join(' | ').slice(0,4000)}));
  const input={schemaVersion:'1.0',id:`newsroom-${topic.id}`,operation:'create',synthetic:false,origin:{type:'json',reference:`Pauta ${topic.id}; dossiê privado do newsroom; aprovação humana ainda não realizada.`},article:{title:draft.title,slug:draft.slug,summary:draft.summary,category:draft.category,tags:draft.tags,language:'pt-BR',editorial:{name:'Pulso Digital',role:'Edição institucional provisória'},sections:draft.sections,sources,claims,...(image?{image}:{})}};
  check(checkSchema(input).length===0,'EDITORIAL_SCHEMA','Rascunho fora do contrato editorial 1.0.');return input;
}
