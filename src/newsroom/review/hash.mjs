import {hash} from '../common.mjs';

export function reviewContentFingerprint(record,dossier){
  const claims=record.draft.claims||[];
  const usedIds=new Set(claims.flatMap(claim=>claim.evidenceIds||[]));
  const evidence=(dossier.evidence||[]).filter(item=>usedIds.has(item.id));
  const sources=(dossier.sources||[]).map(({id,organization,title,finalUrl,publishedAt,limitations})=>({id,organization,title,url:finalUrl,publishedAt:publishedAt||null,limitations:limitations||[]}));
  return hash({
    topicId:record.id,
    title:record.draft.title,
    summary:record.draft.summary,
    category:record.draft.category,
    tags:record.draft.tags,
    claimTaxonomyVersion:record.draft.claimTaxonomyVersion,
    titleEvidenceIds:record.draft.titleEvidenceIds,
    summaryEvidenceIds:record.draft.summaryEvidenceIds,
    sections:record.draft.sections,
    claims,
    evidence:evidence.map(item=>({id:item.id,sourceId:item.sourceId,hash:item.hash||hash(item.excerpt),excerpt:item.excerpt,completeness:item.completeness||null})),
    sources,
  });
}
