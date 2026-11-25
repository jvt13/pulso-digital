import {describeEvidence, evidenceGroups} from './evidence-quality.mjs';

export const EDITORIAL_QUALITY_WEIGHTS = {
  precision: 30,
  depth: 25,
  clarity: 15,
  titleSummary: 15,
  utility: 15,
};

const GENERIC = /\b(?:saiba mais|confira|é importante destacar|em resumo|em conclusão|vale ressaltar|não é apenas|um marco importante)\b/i;
const IMPACT = /\b(?:import|impact|permite|pode ajudar|benef|relev|consequ|desenvolvedor|leitor|futuro)\w*/i;
const LIMITATION = /\b(?:limita|ainda não|não há|não foi|previst|meta|pode mudar|risco|depende|não comprova|não significa|sem confirmação)\w*/i;
const TECHNICAL = /\b(?:propulsão|reator|benchmark|modelo|dataset|engine|render|api|beta|release candidate|capabilit|consistên|nuclear|helicópter|correç)\w*/i;

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
const words = (text) => String(text || '').trim().split(/\s+/).filter(Boolean);
const sentences = (text) => String(text || '').split(/[.!?]+/).filter((part) => part.trim().length > 0);

function paragraphText(draft) {
  return (draft.sections || []).flatMap((section) => section.paragraphs || []).join(' ');
}

function completeHeadlineEvidence(ids, evidence) {
  if (!Array.isArray(ids) || !ids.length) return false;
  return ids.every((id) => {
    const item = evidence.get(id);
    return item && !describeEvidence(item.excerpt, 600).truncated && item.completeness !== 'truncated';
  });
}

function rolesUsedByClaims(draft, evidence) {
  const roles = new Set();
  for (const claim of draft.claims || []) {
    for (const id of claim.evidenceIds || []) {
      const item = evidence.get(id);
      if (!item) continue;
      const described = item.roles?.length ? item.roles : describeEvidence(item.excerpt, 600).roles;
      for (const role of described) roles.add(role);
    }
  }
  return roles;
}

function component(id, label, weight, score, coverage, note) {
  return {id, label, weight, score: clamp(score), points: Math.round(weight * clamp(score) / 100), coverage, note};
}

export function evaluateEditorialQuality(draft, dossier, verification) {
  const evidence = new Map((dossier.evidence || []).map((item) => [item.id, item]));
  const body = paragraphText(draft);
  const paragraphs = (draft.sections || []).flatMap((section) => section.paragraphs || []);
  const allWords = words(body);
  const allSentences = sentences(body);
  const avgSentence = allSentences.length ? allWords.length / allSentences.length : 0;
  const avgParagraph = paragraphs.length ? allWords.length / paragraphs.length : 0;
  const uniqueSentences = new Set(allSentences.map((sentence) => sentence.trim().toLowerCase()));
  const duplicateRate = allSentences.length ? 1 - uniqueSentences.size / allSentences.length : 0;
  const paragraphsCovered = new Set((draft.claims || []).map((claim) => `${claim.section}:${claim.paragraph}`)).size;
  const claimCoverage = paragraphs.length ? paragraphsCovered / paragraphs.length : 0;
  const roles = rolesUsedByClaims(draft, evidence);
  const requiredRoles = ['central-event', 'technical-context', 'impact', 'limitation'];
  const roleCoverage = requiredRoles.filter((role) => roles.has(role)).length / requiredRoles.length;
  const balancedSections = (draft.sections || []).length && (draft.sections || []).every((section) => (section.paragraphs || []).length >= 1);
  const bodyLengthScore = paragraphs.length >= 5 ? 100 : paragraphs.length >= 4 ? 80 : paragraphs.length >= 3 ? 60 : 35;
  const claritySentenceScore = avgSentence <= 24 ? 100 : avgSentence <= 32 ? 75 : avgSentence <= 40 ? 45 : 15;
  const clarityParagraphScore = avgParagraph >= 25 && avgParagraph <= 110 ? 100 : avgParagraph >= 15 && avgParagraph <= 140 ? 70 : 35;
  const duplicateScore = duplicateRate === 0 ? 100 : duplicateRate <= 0.1 ? 70 : duplicateRate <= 0.25 ? 35 : 0;
  const titleWords = words(draft.title).length;
  const summaryWords = words(draft.summary).length;
  const titleLengthScore = titleWords >= 5 && titleWords <= 16 ? 100 : titleWords >= 4 && titleWords <= 20 ? 65 : 25;
  const summaryLengthScore = summaryWords >= 14 && summaryWords <= 55 ? 100 : summaryWords >= 9 && summaryWords <= 70 ? 65 : 25;
  const titleSummaryDistinct = draft.title !== draft.summary ? 100 : 0;
  const titleEvidence = completeHeadlineEvidence(draft.titleEvidenceIds, evidence);
  const summaryEvidence = completeHeadlineEvidence(draft.summaryEvidenceIds, evidence);
  const genericScore = GENERIC.test(`${draft.title} ${draft.summary}`) ? 0 : 100;
  const impactScore = IMPACT.test(body) ? 100 : 20;
  const limitationScore = LIMITATION.test(body) ? 100 : 20;
  const technicalScore = TECHNICAL.test(body) ? 100 : 25;
  const components = [
    component('precision', 'Precisão e rastreabilidade', 30,
      verification.valid ? Math.min(85, 65 + claimCoverage * 20 + (titleEvidence ? 8 : 0) + (summaryEvidence ? 7 : 0)) : 0,
      0.9,
      'Cobertura de claims, evidência de título/resumo e validação estrutural. Não comprova verdade ou independência.'),
    component('depth', 'Profundidade e contexto', 25,
      Math.min(90, bodyLengthScore * 0.4 + (balancedSections ? 100 : 0) * 0.3 + roleCoverage * 100 * 0.3),
      0.7,
      'Mede distribuição de parágrafos e cobertura de papéis das evidências. Não mede qualidade argumentativa.'),
    component('clarity', 'Clareza e legibilidade', 15,
      Math.min(90, claritySentenceScore * 0.4 + clarityParagraphScore * 0.3 + duplicateScore * 0.3),
      0.8,
      'Heurísticas determinísticas de extensão e repetição; não substituem leitura humana.'),
    component('titleSummary', 'Qualidade do título e resumo', 15,
      Math.min(85, titleLengthScore * 0.2 + summaryLengthScore * 0.2 + titleSummaryDistinct * 0.2 + (titleEvidence && summaryEvidence ? 100 : 0) * 0.2 + genericScore * 0.2),
      0.8,
      'Verifica extensão, distinção e evidência completa; atratividade e precisão semântica exigem revisão.'),
    component('utility', 'Utilidade e relevância para o leitor', 15,
      Math.min(80, impactScore * 0.4 + limitationScore * 0.3 + technicalScore * 0.3),
      0.6,
      'Detecta contexto de impacto, limites e explicação técnica; relevância prática real depende de julgamento editorial.'),
  ];
  const blockedReasons = [];
  if (!verification.valid) blockedReasons.push('VERIFICATION_INVALID');
  if (!titleEvidence) blockedReasons.push('TITLE_EVIDENCE_INCOMPLETE');
  if (!summaryEvidence) blockedReasons.push('SUMMARY_EVIDENCE_INCOMPLETE');
  if (draft.synthetic) blockedReasons.push('SYNTHETIC_DRAFT');
  const score = Math.round(components.reduce((total, item) => total + item.points, 0));
  const coverage = Math.round(components.reduce((total, item) => total + item.weight * item.coverage, 0));
  return {
    method: 'editorial-quality-v1-deterministic',
    score: blockedReasons.length ? null : score,
    diagnosticScore: score,
    coverage,
    blocked: blockedReasons.length > 0,
    blockingReasons: blockedReasons,
    weights: EDITORIAL_QUALITY_WEIGHTS,
    components,
    evidenceRoleCoverage: Object.fromEntries(requiredRoles.map((role) => [role, roles.has(role)])),
    limitations: [
      'A pontuação não certifica factualidade, independência, originalidade ou direitos.',
      'Componentes semânticos e de atratividade editorial ainda não são avaliados automaticamente.',
      'Falhas bloqueantes permanecem independentes da pontuação.',
      'A revisão humana continua obrigatória.',
    ],
    future: {
      semanticAdapter: 'gemini',
      status: 'not-implemented',
      reason: 'Avaliação semântica permanece desativada; Gemini não foi chamado nesta tarefa.',
    },
  };
}
