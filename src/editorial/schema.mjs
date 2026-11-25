import crypto from 'node:crypto';
import fs from 'node:fs';

export const VERSION = '1.0';
export const CATEGORIES = ['tecnologia', 'ia', 'games', 'espaco', 'tendencias'];
export const STATES = ['pending', 'draft', 'validated', 'approved', 'published', 'rejected'];
export const schema = JSON.parse(fs.readFileSync(new URL('../../editorial/schemas/input-v1.schema.json', import.meta.url), 'utf8'));
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export class EditorialError extends Error {
  constructor(code, message, details = null) { super(message); this.code = code; this.details = details; }
}
export function ensure(value, code, message, details) { if (!value) throw new EditorialError(code, message, details); }
export function safeId(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 120 && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:-|$)/i.test(value);
}
export function checkSchema(value, spec = schema, location = '$', errors = []) {
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (spec.type && kind !== spec.type) { errors.push({ code: 'TYPE', path: location, message: `Tipo esperado: ${spec.type}.` }); return errors; }
  if (spec.enum && !spec.enum.includes(value)) errors.push({ code: 'ENUM', path: location, message: 'Valor não permitido.' });
  if (kind === 'object') {
    for (const key of spec.required || []) if (!Object.hasOwn(value, key)) errors.push({ code: 'REQUIRED', path: `${location}.${key}`, message: 'Campo obrigatório.' });
    for (const [key, item] of Object.entries(value)) {
      if (spec.properties && Object.hasOwn(spec.properties, key)) checkSchema(item, spec.properties[key], `${location}.${key}`, errors);
      else if (spec.additionalProperties === false) errors.push({ code: 'UNKNOWN_FIELD', path: `${location}.${key}`, message: 'Campo não reconhecido; metadados internos não são importáveis.' });
    }
  }
  if (kind === 'array') {
    if (spec.maxItems !== undefined && value.length > spec.maxItems) errors.push({ code: 'LIMIT', path: location, message: 'Array acima do limite.' });
    if (spec.minItems !== undefined && value.length < spec.minItems) errors.push({ code: 'REQUIRED', path: location, message: 'Array incompleto.' });
    value.forEach((item, i) => spec.items && checkSchema(item, spec.items, `${location}[${i}]`, errors));
  }
  if (kind === 'string') {
    if (value.length > (spec.maxLength ?? 80000)) errors.push({ code: 'LIMIT', path: location, message: 'Texto acima do limite.' });
    if (spec.minLength && value.trim().length < spec.minLength) errors.push({ code: 'EMPTY', path: location, message: 'Texto vazio ou incompleto.' });
  }
  return errors;
}

export function inputBudget(value) {
  const queue=[{value,depth:0}];let nodes=0;
  while(queue.length){const item=queue.pop();if(++nodes>10000||item.depth>20)return false;if(item.value&&typeof item.value==='object')for(const child of Object.values(item.value))queue.push({value:child,depth:item.depth+1});}
  return true;
}

export function readInput(file, maxBytes) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes, 'INPUT_SIZE', 'Arquivo inválido ou acima do limite configurado.');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new EditorialError('INVALID_JSON', 'JSON inválido.'); }
  ensure(inputBudget(value),'INPUT_COMPLEXITY','JSON excede o limite de profundidade/elementos.');
  const errors = checkSchema(value);
  ensure(!errors.length && safeId(value.id), 'INPUT_SCHEMA', 'Contrato de entrada inválido.', errors);
  return value;
}
