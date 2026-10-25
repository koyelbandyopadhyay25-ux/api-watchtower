// JSON wire types from the existing Express routes. No database code is bundled here.
export type JsonType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';
export interface SchemaSnapshot {
  types: JsonType[];
  properties?: Record<string, SchemaSnapshot>;
  items?: SchemaSnapshot;
}
export interface Endpoint {
  id: string;
  name: string;
  url: string;
  baselineSchema: SchemaSnapshot | null;
  createdAt: string;
  updatedAt: string;
}
export type CheckOutcome = 'success' | 'schema_changed' | 'http_error' | 'network_error' | 'invalid_json';
export interface SchemaChange {
  id: string;
  checkResultId: string;
  path: string;
  changeType: 'added' | 'removed' | 'type_changed';
  previousTypes: JsonType[];
  currentTypes: JsonType[];
}
export interface CheckResult {
  id: string;
  endpointId: string;
  httpStatus: number | null;
  responseTimeMs: number | null;
  outcome: CheckOutcome;
  errorCode: string | null;
  checkedAt: string;
  schemaChanges: SchemaChange[];
}
export interface CheckResponse {
  check: CheckResult;
  comparison: 'baseline_missing' | 'compared' | 'not_compared';
  endpoint?: Endpoint;
}
export interface EndpointRow {
  endpoint: Endpoint;
  latest: CheckResult | null;
  historyError: string | null;
}
