import type { CheckResult, Endpoint, JsonType, SchemaChange, SchemaSnapshot } from '../api/types';

export interface DemoSchedule {
  enabled: boolean;
  intervalMinutes: 5 | 15 | 30 | 60;
  nextCheck: string | null;
  lastResult: 'success' | 'schema_changed' | 'http_error' | null;
}

export interface DemoNotification {
  id: string;
  createdAt: string;
  event: string;
  incident: string;
  emailState: string;
}

export interface DemoEndpoint {
  endpoint: Endpoint;
  checks: CheckResult[];
  schedule: DemoSchedule;
  notifications: DemoNotification[];
}

const date = (hour: number, minute = 0) => `2026-10-27T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
const snapshot = (types: JsonType[], properties?: Record<string, SchemaSnapshot>, items?: SchemaSnapshot): SchemaSnapshot => ({ types, ...(properties ? { properties } : {}), ...(items ? { items } : {}) });
const property = (type: JsonType) => snapshot([type]);

function makeEndpoint(index: number, name: string, url: string, baselineSchema: SchemaSnapshot): Endpoint {
  const stamp = date(8 + index);
  return { id: `demo-endpoint-${index + 1}`, name, url, baselineSchema, createdAt: stamp, updatedAt: stamp };
}

function makeCheck(endpointId: string, id: string, hour: number, outcome: CheckResult['outcome'], responseTimeMs: number | null,
  changes: SchemaChange[] = [], httpStatus: number | null = 200, errorCode: string | null = null): CheckResult {
  return { id, endpointId, httpStatus, responseTimeMs, outcome, errorCode, checkedAt: date(hour, 35), schemaChanges: changes, scheduledCheck: null };
}

function change(endpointId: string, checkId: string, path: string, changeType: SchemaChange['changeType'], previousTypes: JsonType[], currentTypes: JsonType[]): SchemaChange {
  return { id: `${checkId}-${path}`, checkResultId: checkId, path, changeType, previousTypes, currentTypes };
}

const userId = 'demo-endpoint-3';
const userChangedCheck = 'demo-user-check-changed';

export const DEMO_ENDPOINTS: DemoEndpoint[] = [
  {
    endpoint: makeEndpoint(0, 'Todo item', 'https://jsonplaceholder.typicode.com/todos/1', snapshot(['object'], {
      userId: property('number'), id: property('number'), title: property('string'), completed: property('boolean'),
    })),
    checks: [makeCheck('demo-endpoint-1', 'demo-todo-check-latest', 10, 'success', 38), makeCheck('demo-endpoint-1', 'demo-todo-check-previous', 9, 'success', 41)],
    schedule: { enabled: true, intervalMinutes: 15, nextCheck: date(10, 50), lastResult: 'success' }, notifications: [],
  },
  {
    endpoint: makeEndpoint(1, 'Post', 'https://jsonplaceholder.typicode.com/posts/1', snapshot(['object'], {
      userId: property('number'), id: property('number'), title: property('string'), body: property('string'),
    })),
    checks: [makeCheck('demo-endpoint-2', 'demo-post-check-latest', 9, 'success', 46)],
    schedule: { enabled: false, intervalMinutes: 30, nextCheck: null, lastResult: null }, notifications: [],
  },
  {
    endpoint: makeEndpoint(2, 'User profile', 'https://jsonplaceholder.typicode.com/users/1', snapshot(['object'], {
      id: property('number'), name: property('string'), email: property('string'),
      address: snapshot(['object'], { street: property('string'), city: property('string'), geo: snapshot(['object'], { lat: property('number'), lng: property('number') }) }),
      company: snapshot(['object'], { name: property('string'), catchPhrase: property('string'), bs: property('string') }),
    })),
    checks: [
      makeCheck(userId, userChangedCheck, 10, 'schema_changed', 52, [change(userId, userChangedCheck, '$.address.geo.lat', 'type_changed', ['number'], ['string'])]),
      makeCheck(userId, 'demo-user-check-previous', 9, 'success', 49),
    ],
    schedule: { enabled: true, intervalMinutes: 60, nextCheck: date(11), lastResult: 'schema_changed' },
    notifications: [{ id: 'demo-note-schema-1', createdAt: date(10, 35), event: 'Schema change', incident: 'Open', emailState: 'Queued in sample outbox' }],
  },
  {
    endpoint: makeEndpoint(3, 'Post comments', 'https://jsonplaceholder.typicode.com/posts/1/comments', snapshot(['array'], undefined, snapshot(['object'], {
      postId: property('number'), id: property('number'), name: property('string'), email: property('string'), body: property('string'),
    }))),
    checks: [makeCheck('demo-endpoint-4', 'demo-comments-check-latest', 10, 'success', 57)],
    schedule: { enabled: false, intervalMinutes: 15, nextCheck: null, lastResult: null }, notifications: [],
  },
  {
    endpoint: makeEndpoint(4, 'Bank holidays', 'https://www.gov.uk/bank-holidays.json', snapshot(['object'], {
      'england-and-wales': snapshot(['object'], { division: property('string'), events: snapshot(['array'], undefined, snapshot(['object'], { title: property('string'), date: property('string'), notes: property('string'), bunting: property('boolean') })) }),
    })),
    checks: [makeCheck('demo-endpoint-5', 'demo-holidays-check-latest', 8, 'success', 122)],
    schedule: { enabled: false, intervalMinutes: 60, nextCheck: null, lastResult: null }, notifications: [],
  },
  {
    endpoint: makeEndpoint(5, 'Product categories', 'https://dummyjson.com/products/categories', snapshot(['array'], undefined, snapshot(['string']))),
    checks: [makeCheck('demo-endpoint-6', 'demo-categories-check-latest', 10, 'http_error', 83, [], 429, 'http_status')],
    schedule: { enabled: true, intervalMinutes: 30, nextCheck: date(11), lastResult: 'http_error' },
    notifications: [{ id: 'demo-note-failure-1', createdAt: date(10, 35), event: 'HTTP failure', incident: 'Open', emailState: 'SMTP accepted by sample Mailpit' }],
  },
];