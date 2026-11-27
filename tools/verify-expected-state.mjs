import fs from 'node:fs';
import path from 'node:path';
import {loadStorageKey} from '../src/storage/env.mjs';
import {
  loadOperationalConfig,
  operationalActive,
  operationalMetrics,
  verifyOperationalDatabase,
} from '../src/storage/operational.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const expectedFile = path.resolve(process.argv[3] || path.join(root, 'deploy/pd0072-expected-counts.json'));
const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
const config = loadOperationalConfig(root);
if (!operationalActive(root, config)) throw new Error('Backend operacional não está ativo.');
const {key} = loadStorageKey(root);
const verified = verifyOperationalDatabase(root, {key, config});
const metrics = operationalMetrics(root, {key, config});
const actual = {
  schemaVersion: verified.schemaVersion,
  counts: Object.fromEntries(Object.keys(expected.counts).map((name) => [
    name,
    name === 'draftClaims' ? metrics.counts.draftClaims : metrics.counts[name],
  ])),
  ai: {
    incomplete: metrics.ai.incomplete,
    chargedTokens: metrics.ai.chargedTokens,
  },
};
const mismatches = [];
for (const [name, value] of Object.entries(expected.counts)) {
  if (actual.counts[name] !== value) mismatches.push({field: `counts.${name}`, expected: value, actual: actual.counts[name]});
}
for (const [name, value] of Object.entries(expected.ai)) {
  if (actual.ai[name] !== value) mismatches.push({field: `ai.${name}`, expected: value, actual: actual.ai[name]});
}
if (actual.schemaVersion !== expected.schemaVersion) {
  mismatches.push({field: 'schemaVersion', expected: expected.schemaVersion, actual: actual.schemaVersion});
}
if (mismatches.length) {
  console.error(JSON.stringify({ok: false, mismatches}, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ok: true, schemaVersion: actual.schemaVersion, counts: actual.counts, ai: actual.ai}, null, 2));
