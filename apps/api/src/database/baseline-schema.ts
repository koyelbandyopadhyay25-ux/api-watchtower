import type { Prisma } from '../generated/prisma/client.js';
import type { InferredSchema, JsonType } from '../schema-comparison/schema-types.js';

/** Structural metadata only. Primitive response values have no representation. */
export type BaselineSchema = InferredSchema;

const jsonTypes = new Set(['array', 'boolean', 'null', 'number', 'object', 'string']);

export function isJsonType(value: unknown): value is JsonType {
  return typeof value === 'string' && jsonTypes.has(value);
}

/** Validate runtime callers too; reject bodies accidentally passed as schemas. */
export function serializeBaseline(schema: BaselineSchema, depth = 0): Prisma.InputJsonObject {
  if (depth > 100 || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Invalid baseline schema or excessive nesting.');
  }
  if (Object.keys(schema).some(key => !['types', 'properties', 'items'].includes(key)) ||
      !Array.isArray(schema.types) || schema.types.length === 0 || !schema.types.every(isJsonType)) {
    throw new Error('Baseline must contain only structural schema metadata.');
  }
  const result: Record<string, Prisma.InputJsonValue> = {
    types: [...new Set(schema.types)].sort(),
  };
  if (schema.properties !== undefined) {
    if (!schema.types.includes('object') || !schema.properties ||
        typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      throw new Error('Baseline properties require an object type and a property map.');
    }
    result.properties = Object.fromEntries(Object.entries(schema.properties)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, serializeBaseline(child, depth + 1)]));
  }
  if (schema.items !== undefined) {
    if (!schema.types.includes('array')) throw new Error('Baseline items require an array type.');
    result.items = serializeBaseline(schema.items, depth + 1);
  }
  return result;
}
