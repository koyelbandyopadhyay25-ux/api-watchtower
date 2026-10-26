# Manual monitoring API (Phase 3B)

Phase 6B adds owner-isolated notification settings/history routes and transactional incident/outbox writes from real checks. Its approved migration is applied to both local databases. See [notification routes](notifications.md) and [verification evidence](phase6b-final-verification.md). Existing authentication, CSRF, local guards and HTTPS restrictions remain unchanged.

**Phase 6A authentication requirement:** all endpoint routes now additionally require a valid cookie session, and state changes require its `X-CSRF-Token`. Owner IDs come only from that session; another user's or an unclaimed UUID returns 404. The original local guard remains mandatory. Existing examples without authentication correctly fail. The additive migration is approved and applied to both local databases; see [auth routes, preservation and verification](authentication.md).

Phase 5B read-only response addition: check-history entries include `scheduledCheck: { scheduledFor: "<UTC ISO timestamp>" }` for scheduled results and `scheduledCheck: null` for manual checks (including explicit baseline captures). This reads the existing relation; no records or schema are changed. Clients must treat absent metadata as unknown rather than guessing provenance. The capture/check POST responses need not include this relation; refresh history after actions.

## Scope and architecture

Phase 3B adds manual, local backend monitoring. Phase 4 adds a [developer dashboard](dashboard.md) using these same routes and guards. Phase 5A adds a separately enabled [opt-in monitoring worker](scheduling.md). Phase 6A adds [authentication and ownership](authentication.md), with all three migrations and real authenticated persistence verified. Alert delivery and public deployment are not implemented. Do not rerun database initialization.

`supported-endpoints.ts` is the single source for exact approved destinations and human-readable frontend presets. `url-policy.ts` validates that catalog and public IPv4 addresses. `safe-json-fetcher.ts` handles DNS, HTTPS, deadlines, and bounded JSON reading; `pinned-https-agent.ts` dials the validated IPv4 literal and verifies the connected peer before TLS, retaining hostname verification. `monitoring-service.ts` coordinates the fetch, schema comparison, and repository writes. `management-routes.ts` handles the local REST boundary. The Phase 2 traversal remains the source of inference/comparison behavior: small `inferJsonSchema` and `compareInferredSchemas` adapters serialize/restore its existing internal representation. No response body is retained as a baseline.

## Enable local management

Use the existing migrated local database. Preserve the credentials in `apps/api/.env`. Add these settings to that Git-ignored file:

```dotenv
NODE_ENV=development
ENABLE_LOCAL_MANAGEMENT=true
```

Alternatively set them in the terminal that starts the server:

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
$env:AUTH_COOKIE_SECURE = 'false' # localhost HTTP development only
npm run dev:api
```

The API binds to `127.0.0.1`. Management routes are not mounted unless **both** settings match exactly. Production and unconfigured environments retain only process health. `/api/health` does not query or claim readiness of the database.

Every management request requires `X-Watchtower-Local: 1`, including reads. Requests also require a loopback TCP peer and localhost/127.0.0.1 Host header. Origin, if present, must exactly match the local API port or Vite port 5173. Forwarded headers are rejected, no CORS permission is granted, and responses use `Cache-Control: no-store`. Writes require `application/json`; bodies are limited to 8 KiB and unknown fields are rejected. These controls reduce browser-driven localhost/DNS-rebinding abuse; **they are not authentication**. Do not expose or reverse-proxy this API. Any trusted local process can use it.

## Destination and resource policy

Only these six canonical URLs can be registered or fetched:

- `https://jsonplaceholder.typicode.com/todos/1`
- `https://jsonplaceholder.typicode.com/posts/1`
- `https://jsonplaceholder.typicode.com/users/1`
- `https://jsonplaceholder.typicode.com/posts/1/comments`
- `https://www.gov.uk/bank-holidays.json`
- `https://dummyjson.com/products/categories`

The Add Endpoint selector groups the destinations under JSONPlaceholder, GOV.UK, and DummyJSON. Nager.Holidays is not in the catalog: its separately authorized Phase 7A.3B preflight resolved public A records but timed out at the eight-second request deadline before connecting. The earlier proposed GOV.UK `/api/bank-holidays.json` path was incorrect and remains rejected; only `/bank-holidays.json` was authorized and preflighted.

The backend policy and frontend selector import the same catalog. No runtime environment variable or request parameter can extend it. HTTPS on standard port 443 is mandatory. Credentials, query strings, fragments, alternate paths/hosts/ports, IP literals, backslash/whitespace tricks, encoded path forms, and normalization aliases are rejected. For backwards compatibility, the exact catalog strings with an explicit `:443` are accepted and stored in canonical form; other normalization variants are rejected.

Before **every** check, the fetcher revalidates the URL and resolves its A records. Empty answers or any answer in the blocked private, loopback, link-local, shared, documentation, multicast/reserved, or selected cloud-platform ranges are rejected. It chooses one validated IPv4 address deterministically, then passes that **literal IP** to a dedicated HTTPS agent. The agent calls `net.connect` only with that address, checks the actual socket peer before TLS starts, and does not use a proxy or reusable connection pool. There is no second hostname lookup or fallback to another address. TLS SNI, Host, and certificate identity validation still use the original allowlisted hostname; certificate verification remains enabled. All IPv6 dialing, including mapped/private/link-local IPv6, is unsupported and rejected. AAAA records are not used.

Redirects are never followed. A 3xx response is recorded as an HTTP failure without fetching its Location. Requests contain only fixed Host/Accept/Accept-Encoding headers, no caller-supplied headers, cookies, authorization, or API keys. HTTPS requests do not use a configured proxy agent.

Limits are 8 seconds for DNS plus the network/body operation, 128 KiB response bytes, 16 KiB response headers, JSON depth 50, and 5,000 JSON nodes. Only JSON media types (`application/json` or `application/*+json`) and uncompressed UTF-8 are accepted. The deadline remains active while reading a stalled body; oversize streams are destroyed. Phase 5A adds PostgreSQL transaction locks and a maximum of three admitted checks/captures across processes using the same database, with no queue; simultaneous operations on the same endpoint are rejected. The existing per-process fetcher limit remains too. Inference and parsing are synchronous, bounded by payload size/complexity, rather than preemptible by the network timer.

These restrictions follow the allowlisting, redirect, and DNS guidance in the [OWASP SSRF prevention cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) and use the [Node HTTPS request API](https://nodejs.org/api/https.html). This is a deliberately restricted IPv4-only MVP, **not complete arbitrary-URL or production SSRF protection**. Public-address filtering is intentionally conservative. External provider/DNS availability, trusted CA/network infrastructure, and a single local process remain assumptions. Before allowing arbitrary customer URLs, add a reviewed egress isolation strategy, robust destination-policy maintenance, and further security testing. Never work around network failures by disabling TLS checks or allowing private addresses.

## Routes

All paths below are relative to `http://127.0.0.1:3001`.

| Method/path | Request | Successful response |
| --- | --- | --- |
| `POST /api/endpoints` | `{ "name": "Todo", "url": "https://jsonplaceholder.typicode.com/todos/1" }` | 201, endpoint record with `baselineSchema: null` |
| `GET /api/endpoints?limit=50` | No body | 200, `{ "endpoints": [...] }` |
| `GET /api/endpoints/:id` | No body | 200, endpoint record including structural baseline |
| `POST /api/endpoints/:id/checks` | `{}` | 201, `{ "check": ..., "comparison": ... }` |
| `GET /api/endpoints/:id/checks?limit=50` | No body | 200, `{ "checks": [...] }`, newest first, each including `schemaChanges` |
| `PUT /api/endpoints/:id/baseline` | `{ "accept": true, "expectedUpdatedAt": "<exact updatedAt from endpoint record>" }` | 200, `{ "endpoint": ..., "check": ..., "comparison": ... }` |

IDs must be UUIDs. Limits default to 50 and must be 1–100. Lists are bounded; cursor pagination is deferred. Endpoint names must be 1–100 trimmed characters. Unknown request fields, including custom headers/bodies for upstream requests, are rejected. Errors are JSON `{ "error": "safe_code" }`, never driver messages or remote bodies.

Endpoint records contain `id`, `name`, `url`, `baselineSchema`, `createdAt`, and `updatedAt`. Check records contain `id`, `endpointId`, `httpStatus`, `responseTimeMs`, `outcome`, `errorCode`, `checkedAt`, and nested `schemaChanges`. Change records contain their IDs, `path`, `changeType`, `previousTypes`, and `currentTypes`. Timestamps use ISO UTC strings. `checkedAt` marks the start of the actual attempt; elapsed milliseconds include DNS/network/JSON handling, not database writes.

The API's 201 status means a check record was created, **not that the remote endpoint succeeded**. Inspect `check.outcome` and `check.httpStatus`. Outcomes:

| Outcome | Meaning |
| --- | --- |
| `success` | 2xx and valid bounded JSON; either no baseline exists or observed structure matched |
| `schema_changed` | Valid 2xx JSON differed structurally from the saved baseline |
| `http_error` | Non-2xx response, including redirects; real HTTP status retained |
| `network_error` | DNS, destination policy, TLS, connection, or absolute deadline failure |
| `invalid_json` | Content type/encoding, size/complexity, UTF-8, or JSON validation failed |

`comparison` is `baseline_missing`, `compared`, or `not_compared` (failed fetch/validation). No difference is labeled a guaranteed breaking change. Empty arrays and optional/heterogeneous fields follow the documented [Phase 2 inference limitations](schema-comparison.md).

Safe error categories reuse the existing database enum: `timeout`, `dns_failure`, `connection_failure`, `tls_failure`, `http_status`, `invalid_json`, and `unknown`. Payload-validation subtypes share `invalid_json`; destination-policy/other failures use `unknown`. `httpStatus` is null if no valid status arrived; it remains available for a later body-read timeout. Rejected API input or capacity requests do not fabricate a check record.

Common API errors are 400 for invalid input/blocked registration URLs, 403 for the local boundary, 404 for an unknown endpoint or disabled routes, 409 for an already active endpoint or stale acceptance, 413 for an oversized API request, 415 for a non-JSON write, 422 for failed baseline capture, 429 for capacity, and 503 for database failures. Unexpected internal errors return a generic 500.

## Explicit baseline lifecycle

Registration always starts without a baseline. A successful check **never** creates/replaces it. To capture or replace one, GET the endpoint and PUT `accept: true` with that record's exact `updatedAt` timestamp.

Acceptance performs a **fresh real HTTPS check**, compares it against the old baseline if present, saves that check, then stores only the inferred structure using an optimistic timestamp update. A changed result is retained in history even when you explicitly accept the new structure. It does not retroactively accept a selected historical response; bodies and pending response snapshots are not stored.

A stale timestamp is rejected before fetching. A concurrent update detected at the database write also returns 409. A failed upstream capture saves its failed check but returns 422 without changing the baseline. Phase 5A coordinates the workflow within a bounded database transaction: expected failed captures and optimistic conflicts are reported after committing the actual check; an actual database/transaction failure can roll back the whole operation. Refresh before assuming a check was saved after such an error. The API does not expose baseline deletion.

## PowerShell demonstration

With PostgreSQL configured and the local API enabled in another terminal:

```powershell
& .\scripts\demo-monitoring.ps1
```

For another local API port, pass `-BaseUrl http://127.0.0.1:3002`. The script registers the allowed todo URL, makes a real check, explicitly accepts a fresh baseline, checks again, and retrieves history. It stops on an upstream failure instead of inventing success. It creates persistent development records and makes three real public requests. It does not delete existing records.

To retrieve an existing demonstration after restarting the API:

```powershell
$localHeaders = @{ 'X-Watchtower-Local' = '1' }
$endpointId = '<endpointId returned by the demo>'
Invoke-RestMethod "http://127.0.0.1:3001/api/endpoints/$endpointId" -Headers $localHeaders
Invoke-RestMethod "http://127.0.0.1:3001/api/endpoints/$endpointId/checks" -Headers $localHeaders
```

## Verification and remaining work

Verified locally on 2026-10-25:

| Command/check | Result |
| --- | --- |
| `npm test` | 158 tests passed across 7 files; none skipped |
| `npm run test:db` | 7 PostgreSQL integration tests passed |
| `npm run typecheck` | API and web passed |
| `npm run build` | API and web production builds passed |
| `npm run db:validate` | Prisma schema valid |
| PowerShell demo + API restart | Three real 200 checks, accepted baseline and history retrieved after restart |
| Live local-boundary/destination checks | 403 for missing header/hostile Origin; 400 for localhost, metadata, and blocked port registration |

Unit tests mock the low-level HTTPS request/DNS boundaries and inspect the literal dialed IP, TLS options, and absence of redirects. They test URL/internal-address rejection before HTTP, mixed public/private DNS answers, rebinding between checks, invalid content/JSON, deadlines, response limits, and concurrency. Route tests exercise opt-in/production behavior, host/origin/header checks, validation, and safe errors. Isolated PostgreSQL tests exercise the full REST/service/repository workflow with controlled mocked upstream JSON, read persisted records using another client, and verify atomic stale-baseline rejection. They delete only their own records and never prepare/reset the already initialized test database.

A separate real public-HTTPS demo verified three HTTP 200 checks persisted in `watchtower_dev`; the same baseline and history were retrieved after restarting the API. Live registration attempts for localhost, cloud metadata, and port 444 were rejected with 400. The live upstream sample remained structurally stable; changed-schema persistence is demonstrated by the controlled integration tests, not claimed as a real upstream incident.

Phase 4 provides endpoint/history UI and explicit baseline review. Phase 5A adds separate local schedule routes and a worker; see its guide before enabling anything. All verification schedules are disabled and the worker is stopped. Pagination/retention policy and stronger operational controls remain future work. Authentication/authorization and a broader reviewed egress policy are prerequisites for exposure beyond localhost. Public deployment and alerting are not included.
