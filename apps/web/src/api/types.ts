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
  scheduledCheck?: { scheduledFor: string } | null;
}
export interface MonitoringSchedule {
  endpointId: string;
  enabled: boolean;
  intervalMinutes: 5 | 15 | 30 | 60;
  nextRunAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string | null;
}
export interface ScheduledRun {
  checkResultId: string;
  endpointId: string;
  scheduledFor: string;
  checkResult: CheckResult;
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
export interface NotificationSettings { endpointId: string; enabled: boolean; updatedAt: string | null }
export interface NotificationEvent {
  id: string;
  kind: 'failure' | 'recovery' | 'schema_changed' | 'schema_restored';
  createdAt: string;
  incident: { id: string; kind: 'availability' | 'schema'; openedAt: string; closedAt: string | null; resolution: string | null };
  checkResult: CheckResult;
  outbox: null | { state: 'pending' | 'processing' | 'smtp_accepted' | 'failed' | 'cancelled'; attempts: number; availableAt: string; finishedAt: string | null; lastErrorCode: string | null;
    deliveries: { number: number; state: string; startedAt: string; finishedAt: string | null; errorCode: string | null }[] };
}
