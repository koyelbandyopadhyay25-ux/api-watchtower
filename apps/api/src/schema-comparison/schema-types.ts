/** Parsed JSON only: no undefined, functions, cycles, or non-finite numbers. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';

export interface SchemaChange {
  path: string;
  changeType: 'added' | 'removed' | 'type_changed';
  /** Sorted observed type sets. An empty set means the property was absent. */
  previousTypes: JsonType[];
  currentTypes: JsonType[];
}
