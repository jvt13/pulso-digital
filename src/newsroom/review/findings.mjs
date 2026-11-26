import {NewsroomError,check} from '../common.mjs';
import {CLAIM_STATUSES,REVIEW_CATEGORIES,REVIEW_SEVERITIES,checkReviewShape} from './schema.mjs';

const SEVERITY_ORDER={critical:0,major:1,minor:2,informational:3};
const FIELDS=['title','summary','body','claims','metadata','other'];
const FINDING_KEYS=['findingId','severity','category','field','sectionIndex','paragraphIndex','claimIndex','evidenceIds','message','justification','suggestion'];
const ASSESSMENT_KEYS=['claimIndex','status','reason','evidenceIds'];

function text(value,max=4000){return typeof value==='string'&&value.trim().length>0&&value.length<=max;}
function contractError(message,details=null){const error=new NewsroomError('REVIEW_CONTRACT',message);error.details=details;throw error;}
function mapEvidenceIds(values,context,label){
  if(!Array.isArray(values))return values;
  return values.map(id=>{
    const real=context.aliasToEvidence?.get(id)||(context.evidenceIds.has(id)?id:null);
    if(!real)contractError(`${label} referencia evidência inexistente.`,{id});
    return real;
  });
}

export function validateReviewItems(output,context,{maxFindings=12}={}){
  const errors=checkReviewShape(output);
  if(errors.length)contractError('Contrato de revisão inválido.',errors);
  if(output.findings.length>maxFindings)contractError('Quantidade de achados acima do limite.');
  const evidenceIds=context.evidenceIds,seenFindings=new Set();
  const findings=output.findings.map((finding,index)=>{
    if(!finding||typeof finding!=='object'||Array.isArray(finding))contractError('Achado inválido.',{index});
    if(Object.keys(finding).some(key=>!FINDING_KEYS.includes(key)))contractError('Campo desconhecido em achado.',{index});
    if(!text(finding.findingId,100)||seenFindings.has(finding.findingId))contractError('ID de achado inválido ou repetido.',{index});
    seenFindings.add(finding.findingId);
    if(!REVIEW_SEVERITIES.includes(finding.severity))contractError('Severidade inválida.',{index});
    if(!REVIEW_CATEGORIES.includes(finding.category))contractError('Categoria inválida.',{index});
    if(!FIELDS.includes(finding.field))contractError('Localização inválida.',{index});
    for(const key of ['sectionIndex','paragraphIndex','claimIndex'])if(!Number.isInteger(finding[key]))contractError('Índice de localização inválido.',{index,key});
    if(!text(finding.message,2000)||!text(finding.justification,4000)||typeof finding.suggestion!=='string'||finding.suggestion.length>4000)contractError('Texto de achado inválido.',{index});
    const findingEvidence=mapEvidenceIds(finding.evidenceIds,context,`Achado ${index}`);
    if(!Array.isArray(findingEvidence)||findingEvidence.some(id=>!evidenceIds.has(id)))contractError('Achado referencia evidência inexistente.',{index});
    if(finding.claimIndex>=0){
      const allowed=context.claimEvidenceIds.get(finding.claimIndex);
      if(!allowed||findingEvidence.some(id=>!allowed.has(id)))contractError('Achado referencia evidência alheia ao claim.',{index});
    }
    if(finding.field==='body'&&(finding.sectionIndex<0||finding.paragraphIndex<0||!context.sections?.[finding.sectionIndex]?.paragraphs?.[finding.paragraphIndex]))contractError('Achado aponta parágrafo inexistente.',{index});
    return {...finding,evidenceIds:[...new Set(findingEvidence)]};
  });
  if(output.claimAssessments.length!==context.claims.length)contractError('A revisão deve classificar todos os claims.');
  const assessments=[],seenClaims=new Set();
  for(const [index,assessment] of output.claimAssessments.entries()){
    if(!assessment||typeof assessment!=='object'||Array.isArray(assessment))contractError('Avaliação de claim inválida.',{index});
    if(Object.keys(assessment).some(key=>!ASSESSMENT_KEYS.includes(key)))contractError('Campo desconhecido em avaliação de claim.',{index});
    if(!Number.isInteger(assessment.claimIndex)||assessment.claimIndex<0||assessment.claimIndex>=context.claims.length||seenClaims.has(assessment.claimIndex))contractError('Índice de claim inválido ou repetido.',{index});
    seenClaims.add(assessment.claimIndex);
    if(!CLAIM_STATUSES.includes(assessment.status))contractError('Status de claim inválido.',{index});
    if(!text(assessment.reason,4000)||!Array.isArray(assessment.evidenceIds))contractError('Justificativa de claim inválida.',{index});
    const assessmentEvidence=mapEvidenceIds(assessment.evidenceIds,context,`Avaliação ${index}`);
    const allowed=context.claimEvidenceIds.get(assessment.claimIndex);
    if(assessmentEvidence.some(id=>!allowed?.has(id)))contractError('Avaliação referencia evidência alheia ao claim.',{index});
    assessments.push({...assessment,evidenceIds:[...new Set(assessmentEvidence)]});
  }
  assessments.sort((left,right)=>left.claimIndex-right.claimIndex);
  const autoFindings=[];
  for(const assessment of assessments){
    if(assessment.status==='supported')continue;
    if(findings.some(finding=>finding.claimIndex===assessment.claimIndex))continue;
    const claim=context.claims[assessment.claimIndex];
    autoFindings.push({
      findingId:`claim-${assessment.claimIndex}-status`,
      severity:assessment.status==='partially-supported'||assessment.status==='ambiguous'?'major':'critical',
      category:assessment.status==='insufficient-evidence'?'evidence':'factual',
      field:'body',
      sectionIndex:claim.section,
      paragraphIndex:claim.paragraph,
      claimIndex:assessment.claimIndex,
      evidenceIds:assessment.evidenceIds,
      message:`Claim avaliado como ${assessment.status}.`,
      justification:assessment.reason,
      suggestion:assessment.status==='insufficient-evidence'?'Obter evidência adicional antes de usar a afirmação.':'Corrigir ou remover a afirmação antes de nova revisão.',
    });
  }
  for(const [index,signal] of context.injectionSignals.slice(0,3).entries()){
    autoFindings.push({
      findingId:`injection-${index+1}`,
      severity:'major',
      category:'injection',
      field:'other',
      sectionIndex:-1,
      paragraphIndex:-1,
      claimIndex:-1,
      evidenceIds:[signal.evidenceId],
      message:'Sinal de instrução externa suspeita em evidência.',
      justification:`Trecho semelhante a instrução encontrado: ${signal.signal}. O conteúdo não foi tratado como instrução.`,
      suggestion:'Revisar a fonte e confirmar que nenhuma instrução externa afetou o texto.',
    });
  }
  const all=[...findings,...autoFindings].sort((left,right)=>SEVERITY_ORDER[left.severity]-SEVERITY_ORDER[right.severity]);
  return {findings:all,claimAssessments:assessments};
}

export function effectiveResult({modelResult,findings,assessments,verificationValid,injectionSignals}){
  check(typeof verificationValid==='boolean','REVIEW_STATE','Verificação determinística ausente.');
  if(!verificationValid||modelResult==='blocked')return 'blocked';
  if(injectionSignals.length)return 'human-review-required';
  if(modelResult==='research-required'||assessments.some(item=>item.status==='insufficient-evidence')||findings.some(item=>item.category==='evidence'&&item.severity!=='informational'))return 'research-required';
  if(modelResult==='human-review-required')return 'human-review-required';
  if(modelResult==='changes-required'||findings.length||assessments.some(item=>item.status!=='supported'))return 'changes-required';
  return 'pass';
}

export function severityCounts(findings){
  return Object.fromEntries(REVIEW_SEVERITIES.map(severity=>[severity,findings.filter(item=>item.severity===severity).length]));
}

export function claimStatusCounts(assessments){
  return Object.fromEntries(CLAIM_STATUSES.map(status=>[status,assessments.filter(item=>item.status===status).length]));
}

export function summarizeFindings(findings){
  return findings.slice(0,8).map(({findingId,severity,category,field,claimIndex,message})=>({findingId,severity,category,field,claimIndex,message}));
}
