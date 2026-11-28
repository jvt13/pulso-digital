import fs from 'node:fs';
import path from 'node:path';

function readPayload(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const payload = parsed?.result || parsed;
  if (!payload || payload.backend !== 'sqlite') {
    throw new Error(`Métricas SQLite ausentes: ${path.basename(file)}.`);
  }
  return payload;
}

function stablePayload(payload) {
  return {
    schemaVersion: payload.schemaVersion,
    sourceFingerprint: payload.sourceFingerprint,
    counts: payload.counts,
    statuses: payload.statuses,
    ai: payload.ai,
    operationalAssets: payload.operationalAssets,
  };
}

function differences(expected, actual, prefix = '') {
  if (Object.is(expected, actual)) return [];
  if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object') {
    return [{field: prefix, expected, actual}];
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].flatMap((key) => differences(
    expected[key],
    actual[key],
    prefix ? `${prefix}.${key}` : key,
  ));
}

const [baselineFile, currentFile] = process.argv.slice(2);
if (!baselineFile || !currentFile) {
  throw new Error('uso: verify-metrics-baseline.mjs BASELINE.json CURRENT.json');
}

const baseline = stablePayload(readPayload(path.resolve(baselineFile)));
const current = stablePayload(readPayload(path.resolve(currentFile)));
const mismatches = differences(baseline, current);
if (mismatches.length > 0) {
  console.error(JSON.stringify({ok: false, mismatches}, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  dynamicBaseline: true,
  schemaVersion: current.schemaVersion,
  counts: current.counts,
  ai: current.ai,
}, null, 2));
