import {normalize} from '../radar/common.mjs';

export const CLAIM_TAXONOMY_VERSION = '1.1';
export const CLAIM_NATURES = ['documented-fact', 'attributed-statement', 'expectation', 'rumor', 'opinion'];

const CLASSIFICATION_BY_NATURE = {
  'documented-fact': 'confirmed',
  'attributed-statement': 'attributed',
  expectation: 'expectation',
  rumor: 'rumor',
  opinion: 'opinion',
};

const OPINION_CUE = /\b(?:avali|consider|interpret|parece|sugere|pode indicar|relevante|importante|insuficiente|preocupa|para o leitor|significa|indica que)\w*/i;
const FACTUAL_VERB = /\b(?:recebeu|tem|contem|inclui|anunciou|realizou|publicou|registrou|soma|distribu|distribui|lancou|fixou|corrigiu|submeteu|enviou|reportou|informou|apresenta|totaliza)\w*/i;
const NUMBER = /\b\d+(?:[.,]\d+)?\b/;
const EXPECTATION_CUE = /\b(?:prev|esper|meta|planej|estim|pode|podera|deve|devem|futur|ate|a partir de)\w*/i;
const RUMOR_CUE = /\b(?:rumor|nao confirmad|sem confirmacao|especula)\w*/i;

export function classificationForNature(nature) {
  return CLASSIFICATION_BY_NATURE[nature] || null;
}

export function claimTaxonomyErrors(claim) {
  const errors = [];
  if (!CLAIM_NATURES.includes(claim?.nature)) {
    errors.push({code: 'CLAIM_NATURE', message: 'Natureza factual ausente ou desconhecida.'});
    return errors;
  }
  const expected = classificationForNature(claim.nature);
  if (claim.classification !== expected) {
    errors.push({code: 'CLAIM_CLASSIFICATION', message: `Natureza ${claim.nature} exige classification=${expected}.`});
  }
  if (claim.nature === 'attributed-statement') {
    if (typeof claim.attribution !== 'string' || claim.attribution.trim().length < 2) {
      errors.push({code: 'CLAIM_ATTRIBUTION', message: 'Declaração atribuída exige indicação explícita da fonte.'});
    }
  } else if (claim.attribution !== undefined && typeof claim.attribution !== 'string') {
    errors.push({code: 'CLAIM_ATTRIBUTION', message: 'Atribuição deve ser texto.'});
  }
  const text = normalize(claim.text || '');
  if (claim.nature === 'expectation' && !EXPECTATION_CUE.test(text)) {
    errors.push({code: 'CLAIM_QUALIFIER', message: 'Expectativa deve estar qualificada no texto.'});
  }
  if (claim.nature === 'rumor' && !RUMOR_CUE.test(text)) {
    errors.push({code: 'CLAIM_QUALIFIER', message: 'Rumor deve estar identificado no texto.'});
  }
  if (claim.nature === 'opinion' && NUMBER.test(claim.text || '') && FACTUAL_VERB.test(text) && !OPINION_CUE.test(text)) {
    errors.push({code: 'CLAIM_CLASSIFICATION', message: 'Informação factual com números não pode ser classificada como opinião sem sinal explícito de interpretação.'});
  }
  return errors;
}
