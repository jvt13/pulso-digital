import {Repository as EditorialRepository} from '../editorial/repository.mjs';
import {validate as validateEditorialInput} from '../editorial/validator.mjs';
import {inspectJournal} from '../automation/recovery.mjs';
import {inspectImage} from './images.mjs';
import {ReviewEngine} from './review/engine.mjs';
import {verifyDraft} from './verifier.mjs';

function failure(code, message, details = {}) {
  return {code, message, ...details};
}

export function evaluatePublicationEligibility(newsroomRepository, topicId) {
  const state = newsroomRepository.read();
  const record = state.topics[topicId];
  if (!record?.draft || !record?.dossier) {
    return {
      topicId,
      status: 'blocked',
      eligible: false,
      automaticApproval: false,
      automaticPublication: false,
      checks: {
        deterministicValidation: false,
        semanticReview: false,
        evidence: false,
        imageRights: false,
        editorialImport: false,
        approval: false,
        integrity: false,
        journal: !inspectJournal(newsroomRepository.root).required,
      },
      errors: [failure('DRAFT_REQUIRED', 'Rascunho e dossiê são obrigatórios.')],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];
  const verification = verifyDraft(record.draft, record.dossier);
  if (!verification.valid) {
    errors.push(failure('DETERMINISTIC_BLOCKED', 'A validação determinística do conteúdo atual falhou.'));
  }

  const reviewStatus = new ReviewEngine(newsroomRepository).status(topicId);
  const latestReview = reviewStatus.latest;
  const semanticReview = Boolean(
    latestReview
    && latestReview.status === 'completed'
    && latestReview.result === 'pass'
    && !reviewStatus.stale
    && latestReview.contentHash === reviewStatus.contentHash
    && latestReview.configurationHash === reviewStatus.configurationHash
    && (latestReview.severityCounts?.critical || 0) === 0
    && (latestReview.severityCounts?.major || 0) === 0
  );
  if (!semanticReview) {
    errors.push(failure('SEMANTIC_REVIEW_REQUIRED', 'É obrigatória uma revisão semântica `pass` vinculada ao hash e à configuração atuais.'));
  }

  const evidenceUsable = Array.isArray(record.dossier.evidence)
    && record.dossier.evidence.length > 0
    && verification.valid;
  if (!evidenceUsable) {
    errors.push(failure('EVIDENCE_REQUIRED', 'Evidências utilizáveis são obrigatórias.'));
  }

  let imageReady = false;
  let preparedImage = null;
  try {
    preparedImage = inspectImage(newsroomRepository.root, topicId);
    imageReady = preparedImage.ready && ['ready-to-import', 'imported'].includes(record.imageStatus || record.image?.status)
      && Boolean(record.image?.manifest?.authorizationBasis)
      && Boolean(record.image?.manifest?.license);
  } catch (error) {
    errors.push(failure(error.code || 'IMAGE_AUTHORIZATION', error.message));
  }
  if (!imageReady && !errors.some((item) => item.code === 'IMAGE_AUTHORIZATION')) {
    errors.push(failure('IMAGE_RIGHTS_REQUIRED', 'Imagem preparada com manifesto de origem, licença e crédito é obrigatória.'));
  }

  const editorial = new EditorialRepository(newsroomRepository.root);
  let editorialRecord = null;
  let editorialIntegrity = false;
  if (record.editorialId) {
    try {
      editorialRecord = editorial.get(record.editorialId);
      editorialIntegrity = true;
    } catch (error) {
      errors.push(failure(error.code || 'EDITORIAL_INTEGRITY', error.message));
    }
  }
  const editorialImported = Boolean(record.editorialId && editorialRecord);
  if (!editorialImported) {
    errors.push(failure('EDITORIAL_IMPORT_REQUIRED', 'O rascunho privado ainda não foi importado pelo motor editorial.'));
  }

  let approval = false;
  let editorialValidation = null;
  if (editorialRecord) {
    editorialValidation = validateEditorialInput(editorial, editorialRecord.input);
    if (!editorialValidation.valid) {
      errors.push(failure('EDITORIAL_VALIDATION_REQUIRED', 'A validação do registro editorial importado falhou.', {
        validationErrors: editorialValidation.errors.map((item) => item.code),
      }));
    }
    approval = ['approved', 'published'].includes(editorialRecord.state)
      && Boolean(editorialRecord.approval)
      && editorialRecord.approval.factsReviewed === true
      && editorialRecord.approval.imageRightsReviewed === true
      && editorialRecord.approval.contentHash === editorialValidation.contentHash;
    if (!approval) {
      errors.push(failure('HUMAN_APPROVAL_REQUIRED', 'Aprovação humana explícita é obrigatória; o pipeline não aprova em nome do operador.'));
    }
  }

  const journal = inspectJournal(newsroomRepository.root);
  if (journal.required) {
    errors.push(failure('JOURNAL_RECOVERY_REQUIRED', 'Há uma transação editorial incompleta; execute a recuperação antes de avaliar publicação.'));
  }
  const blockingErrors = errors.filter((item) => item.code !== 'HUMAN_APPROVAL_REQUIRED');
  const eligible = blockingErrors.length === 0 && approval;
  const status = eligible
    ? (editorialRecord?.state === 'published' ? 'already-published' : 'eligible')
    : blockingErrors.length === 0 && !approval
      ? 'awaiting-human-approval'
      : 'blocked';
  if (verification.warnings.length) warnings.push(...verification.warnings);
  if (preparedImage?.ready) warnings.push({code: 'IMAGE_RIGHTS_FINAL_REVIEW', message: 'O manifesto automatizado não substitui a revisão humana final dos direitos.'});
  warnings.push({code: 'FACTUALITY_NOT_CERTIFIED', message: 'Revisão semântica `pass` não certifica factualidade nem autoriza publicação.'});

  return {
    topicId,
    status,
    eligible,
    automaticApproval: false,
    automaticPublication: false,
    checks: {
      deterministicValidation: verification.valid,
      semanticReview,
      evidence: evidenceUsable,
      imageRights: imageReady,
      editorialImport: editorialImported,
      editorialValidation: Boolean(editorialValidation?.valid),
      approval,
      integrity: editorialIntegrity,
      journal: !journal.required,
    },
    contentHash: reviewStatus.contentHash,
    configurationHash: reviewStatus.configurationHash,
    reviewId: latestReview?.id || null,
    editorialId: record.editorialId || null,
    errors,
    warnings,
  };
}
