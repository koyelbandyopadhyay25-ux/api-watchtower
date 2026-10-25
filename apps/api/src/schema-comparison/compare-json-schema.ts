import type { JsonType, JsonValue, SchemaChange } from './schema-types.js';

interface ObservedSchema {
  types: Set<JsonType>;
  properties: Map<string, ObservedSchema>;
  // Undefined means no array items were observed, not that all types are allowed.
  items?: ObservedSchema;
}

function emptySchema(): ObservedSchema {
  return { types: new Set(), properties: new Map() };
}

/** Accumulate all observed types and object fields, including heterogeneous items. */
function observe(schema: ObservedSchema, value: JsonValue): void {
  if (value === null) {
    schema.types.add('null');
  } else if (Array.isArray(value)) {
    schema.types.add('array');
    for (const item of value) {
      schema.items ??= emptySchema();
      observe(schema.items, item);
    }
  } else if (typeof value === 'object') {
    schema.types.add('object');
    for (const [key, child] of Object.entries(value)) {
      let property = schema.properties.get(key);
      if (!property) {
        property = emptySchema();
        schema.properties.set(key, property);
      }
      observe(property, child);
    }
  } else {
    schema.types.add(typeof value as 'string' | 'number' | 'boolean');
  }
}

function sortedTypes(schema: ObservedSchema | undefined): JsonType[] {
  return schema ? [...schema.types].sort() : [];
}

function propertyPath(parent: string, key: string): string {
  // Quote unusual keys to distinguish a literal "a.b" from nested a.b.
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function compareNodes(
  previous: ObservedSchema,
  current: ObservedSchema,
  path: string,
  changes: SchemaChange[],
): void {
  const previousTypes = sortedTypes(previous);
  const currentTypes = sortedTypes(current);
  if (previousTypes.join(',') !== currentTypes.join(',')) {
    changes.push({ path, changeType: 'type_changed', previousTypes, currentTypes });
  }

  // Descend only through container types observed on both sides. Replacing an
  // object with a primitive reports one type change rather than redundant removals.
  if (previous.types.has('object') && current.types.has('object')) {
    const keys = new Set([...previous.properties.keys(), ...current.properties.keys()]);
    for (const key of [...keys].sort()) {
      const before = previous.properties.get(key);
      const after = current.properties.get(key);
      const childPath = propertyPath(path, key);
      if (before && after) {
        compareNodes(before, after, childPath, changes);
      } else {
        changes.push({
          path: childPath,
          changeType: before ? 'removed' : 'added',
          previousTypes: sortedTypes(before),
          currentTypes: sortedTypes(after),
        });
      }
    }
  }

  // Unknown item structure on either side is insufficient evidence for a diff.
  if (previous.items && current.items) {
    compareNodes(previous.items, current.items, `${path}[]`, changes);
  }
}

/** Compare observed sample structures; this does not infer a universal contract. */
export function compareJsonSchema(previous: JsonValue, current: JsonValue): SchemaChange[] {
  const previousSchema = emptySchema();
  const currentSchema = emptySchema();
  observe(previousSchema, previous);
  observe(currentSchema, current);
  const changes: SchemaChange[] = [];
  compareNodes(previousSchema, currentSchema, '$', changes);
  // Code-unit ordering avoids machine-dependent locale sorting.
  return changes.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
