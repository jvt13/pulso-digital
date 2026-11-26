import {NewsroomError} from './common.mjs';

const SUPPORTED = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'description']);

function fail(message, details = null) {
  const error = new NewsroomError('SCHEMA_INVALID', message);
  if (details) error.details = details;
  throw error;
}

export function assertStrictJsonSchema(schema, path = '$') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) fail(`Schema inválido em ${path}.`);
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) fail(`Palavra-chave não suportada em ${path}: ${key}.`, {path, keyword: key});
  }
  if (schema.type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      fail(`Objeto sem properties em ${path}.`, {path});
    }
    if (!Array.isArray(schema.required)) fail(`Objeto sem required em ${path}.`, {path});
    for (const key of Object.keys(schema.properties)) {
      if (!schema.required.includes(key)) fail(`Campo ${key} ausente em required: ${path}.`, {path, field: key});
    }
    if (schema.additionalProperties !== false) fail(`additionalProperties deve ser false em ${path}.`, {path});
    for (const [key, value] of Object.entries(schema.properties)) assertStrictJsonSchema(value, `${path}.properties.${key}`);
  }
  if (schema.type === 'array') {
    if (!schema.items) fail(`Array sem items em ${path}.`, {path});
    assertStrictJsonSchema(schema.items, `${path}.items`);
  }
  return true;
}
