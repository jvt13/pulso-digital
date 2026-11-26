import fs from 'node:fs';
import path from 'node:path';

export const ENVIRONMENT_CONFIG = 'site/environments.json';

export function loadEnvironmentDefinitions(root) {
  const definitions = JSON.parse(fs.readFileSync(path.join(root, ENVIRONMENT_CONFIG), 'utf8'));
  if (definitions.schemaVersion !== '1.0' || !definitions.environments?.[definitions.default]) {
    throw new Error('Configuração de ambientes inválida.');
  }
  return definitions;
}

export function loadSiteConfig(root, environmentName) {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const definitions = loadEnvironmentDefinitions(root);
  const name = environmentName || definitions.default;
  const selected = definitions.environments[name];
  if (!selected) throw new Error(`Ambiente desconhecido: ${name}.`);

  const siteUrl = String(selected.siteUrl || '').replace(/\/+$/, '');
  const parsed = new URL(siteUrl);
  if (parsed.protocol !== 'https:') throw new Error('URL do site deve usar HTTPS.');
  if (!String(selected.basePath || '').startsWith('/') || !String(selected.basePath).endsWith('/')) {
    throw new Error('basePath deve começar e terminar com /.');
  }
  const expectedPath = selected.basePath === '/' ? '/' : selected.basePath.slice(0, -1);
  if ((parsed.pathname.replace(/\/+$/, '') || '/') !== expectedPath) {
    throw new Error('basePath não corresponde à URL pública do ambiente.');
  }
  if (base.publicName !== 'PulsoBit' || base.name !== 'Pulso Digital') {
    throw new Error('Identidade pública e identidade técnica devem permanecer separadas.');
  }

  return {
    ...base,
    technicalName: base.name,
    name: base.publicName,
    environment: name,
    siteUrl,
    basePath: selected.basePath,
    output: selected.output,
    indexing: selected.indexing === true,
    prelaunch: selected.prelaunch === true,
    adsense: {
      ...base.adsense,
      enabled: base.adsense?.enabled === true && selected.adsense === true,
    },
    aiCalls: selected.aiCalls === true,
    operationalPublishing: selected.operationalPublishing === true,
  };
}
