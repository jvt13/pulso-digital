import path from 'node:path';
import {AutomationRepository} from '../src/automation/repository.mjs';
import {loadSiteConfig} from '../src/site-config.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const repository = new AutomationRepository(root);
const state = repository.readOrNull();
if (!state) throw new Error('Estado da automação não inicializado; operação de produção não autorizada.');
const site = loadSiteConfig(root, 'production');
const result = {
  paused: state.control?.paused === true,
  aiEnabled: repository.config.ai.enabled === true,
  freeTierConfirmed: repository.config.ai.freeTierConfirmed === true,
  indexing: site.indexing === true,
  adsense: site.adsense.enabled === true,
  automaticApproval: false,
  automaticPublication: false,
};
if (!result.paused || result.aiEnabled || result.freeTierConfirmed || result.indexing || result.adsense) {
  console.error(JSON.stringify({ok: false, ...result}));
  process.exit(1);
}
console.log(JSON.stringify({ok: true, ...result}));
