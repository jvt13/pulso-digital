import {check} from '../common.mjs';
import {checkReviewShape} from './schema.mjs';
import {claimStatusCounts,effectiveResult,severityCounts,validateReviewItems} from './findings.mjs';

export function validateReviewOutput(output,context,{verification,quality,maxFindings=12}={}){
  const shapeErrors=checkReviewShape(output);
  check(!shapeErrors.length,'REVIEW_CONTRACT',shapeErrors.map(item=>item.code).join(', '));
  check(verification&&typeof verification.valid==='boolean','REVIEW_STATE','Verificação determinística ausente.');
  const normalized=validateReviewItems(output,context,{maxFindings});
  const result=effectiveResult({
    modelResult:output.result,
    findings:normalized.findings,
    assessments:normalized.claimAssessments,
    verificationValid:verification.valid,
    injectionSignals:context.injectionSignals,
  });
  return {
    schemaVersion:'1.0',
    result,
    modelResult:output.result,
    summary:output.summary,
    findings:normalized.findings,
    claimAssessments:normalized.claimAssessments,
    limitations:output.limitations,
    humanReviewRequired:true,
    severityCounts:severityCounts(normalized.findings),
    claimStatusCounts:claimStatusCounts(normalized.claimAssessments),
    injectionSignals:context.injectionSignals,
    comparison:{
      deterministicValid:verification.valid,
      deterministicErrors:verification.errors.map(item=>item.code),
      deterministicWarnings:verification.warnings.map(item=>item.code),
      editorialQualityScore:quality?.score??null,
      editorialQualityCoverage:quality?.coverage??null,
      semanticModelResult:output.result,
      effectiveResult:result,
    },
    evidenceCoverage: context.evidenceCoverage,
  };
}
