# Developer dashboard (Phase 4)

Phase 6B adds compact notification opt-in, incident/event history and truthful Mailpit attempt states using real backend routes and the applied notification migration. See [notification settings and limitations](notifications.md) and [live browser/Mailpit verification](phase6b-final-verification.md). Existing dashboard layout/authentication are preserved. For HTTP localhost, set AUTH_COOKIE_SECURE=false on the API process explicitly; the secure default is unchanged.

**Phase 6A supersedes the unauthenticated setup below:** the application entry restores a server-managed session before mounting the dashboard. Registration, login and logout are implemented; the Vite proxy carries an HttpOnly cookie and writes include an in-memory CSRF token. Existing endpoints stay unclaimed and invisible to new users. The authentication migration was approved and applied test first, then development. See [authentication verification and local HTTP cookie settings](authentication.md). Earlier verification sections remain historical Phase 4/5B results.

## Persisted monitoring controls (Phase 5B)

Endpoint detail now includes a compact **Monitoring settings** panel. It loads `GET /api/endpoints/:id/schedule` and the newest actual `/scheduled-checks` result independently of the core endpoint/history reads. Unavailable configuration does not become a fabricated disabled state; unavailable scheduled history does not become a healthy result or hide manual history.

Select **Enable automatic monitoring**, choose 5, 15, 30, or 60 minutes, then **Save monitoring settings**. Enabling additionally requires **Confirm enablement** in a native keyboard-accessible dialog. First enablement is immediately due, but execution requires the independent worker. The UI always states: “Automatic checks require the monitoring worker to be running.” It exposes no invented live worker indicator.

Uncheck and save to disable, without removing history or baselines. Draft edits do not change saved configuration. Controls are disabled during writes to prevent duplicate actions. The panel verifies current configuration before saving and reads persisted state afterward; a failure never displays a new success message. Refresh settings after a failed operation before retrying. A 409 means the write was not accepted (an admitted check may currently own the endpoint lock).

Concurrent configuration changes detected during preflight require review and another deliberate action; writes are never automatically retried. The existing API has no atomic version/ETag check, so a competing write between preflight and PUT can still win. The final read displays current persisted state; this is best-effort conflict detection, not an atomic compare-and-swap guarantee. Worker metadata changes alone do not invalidate unchanged configuration.

The summary shows persisted configuration, due time, last scheduled check time and actual last result. All timestamps are UTC. New saved results appear on **Refresh detail** or **Refresh settings**, with no browser scheduler or polling loop. Closing the browser does not stop the worker. Reloading or opening another browser context restores PostgreSQL settings.

History labels use the API's existing scheduled-check relationship: **Scheduled**, **Manual**, or **Source unavailable** if metadata is missing. The original history/schema inspector still shows real codes, timing, safe errors, and recorded structural differences. No inferred compatibility guarantee is added.

In a separate PowerShell terminal, start the worker from the repository root:

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_SCHEDULER_WORKER = 'true'
npm run dev:worker
```

Stop it with Ctrl+C. Stopping the worker does not clear saved opt-ins; disable an endpoint in the dashboard to prevent it from resuming on the next worker start.

### Real browser verification

With PostgreSQL and the opted-in local API/Vite stack running, stop other worker processes before running:

```powershell
npm run build
$env:WATCHTOWER_LIVE_E2E = 'true'
npm run test:e2e
```

This opt-in test uses installed Microsoft Edge and creates real development registrations/history. The scheduling test starts its own compiled worker, then stops that process and disables only its own schedule in `finally`. It enables then disables an immediately due schedule before starting the worker, checks no execution for 12 seconds (more than two normal polls), then enables through the UI with the worker running and waits for a real HTTPS result. It verifies interval updates, reload/new browser context persistence, manual/scheduled labels, and desktop/mobile layout. No production interval is shortened, timestamps backdated, response mocked, or old history modified. The regular dashboard workflow also runs against the real API.

Screenshots: `apps/web/artifacts/scheduling-desktop.png` and `apps/web/artifacts/scheduling-mobile.png` (ignored generated files). They show actual saved results at capture time; the demo schedule is disabled during cleanup. To reproduce a screenshot, register a supported URL, enable deliberately, start the worker separately, wait for a saved result and refresh; disable afterward if desired.

### Phase 5B verification record

Final verification on 2026-10-25:

| Command/check | Actual result |
| --- | --- |
| `npm test` backend | 210 passed in 9 files; includes all 22 isolated PostgreSQL integration tests |
| `npm test` frontend | 42 passed in 3 files |
| Combined automated suite | 252 passed, 0 failed, 0 skipped |
| Opted-in `npm run test:e2e` | 2 passed, 0 failed, 0 skipped (34.9 seconds in final run) |
| `npm run typecheck`, `npm run build` | Both workspaces passed |
| `npm run db:validate` | Prisma schema valid; no migration needed or applied |
| `git diff --check` | Passed |
| Development integrity | All pre-existing rows across five monitoring/scheduling tables hash-identical |
| Final scheduling state | 0 enabled schedules; verification worker exited |

The final live scheduling endpoint is `e5d4a36c-8439-4809-9357-3c3f3419a458`; its real scheduled response returned HTTP 200. Open `http://localhost:5173/#endpoints/e5d4a36c-8439-4809-9357-3c3f3419a458` after launching the stack to inspect retained history. It is now disabled. Browser verification also covered Escape cancellation/focus restoration, no page errors, and mobile body overflow checks. Early component runs exposed baseline tests using ambiguous checkbox selectors; those queries were scoped to their actual labels, and all final tests passed.

Two complete live verification runs retained four new endpoints and ten actual checks. Development now has 9 endpoints, 22 checks, 5 scheduled provenance records, and 4 disabled schedule rows. The starting 5 endpoints, 12 checks, 3 provenance records, and 2 schedule rows were unchanged; no reset, deletion, timestamp rewriting, schema migration, or initialization was performed.

Files created:

- `apps/web/src/components/MonitoringSettings.tsx`
- `apps/web/tests/monitoring-settings.test.tsx`
- `apps/web/e2e/scheduling.spec.ts`

Files modified:

- `apps/api/src/database/monitoring-repository.ts` — read existing scheduled provenance with check history.
- `apps/api/tests/scheduling.integration.test.ts` — verify scheduled/manual metadata against PostgreSQL.
- `apps/web/src/api/client.ts`, `apps/web/src/api/types.ts` — schedule API calls and wire types; validate configuration shape.
- `apps/web/src/components/EndpointDetail.tsx`, `apps/web/src/components/CheckHistory.tsx` — settings integration, refresh/action coordination, source labels.
- `apps/web/src/styles.css`, `apps/web/src/App.tsx` — compact settings layout and local worker instructions.
- `apps/web/tests/client.test.ts`, `apps/web/tests/dashboard.test.tsx`, `apps/web/tests/fixtures.ts` — response validation, precise baseline selectors, test-only scheduling state.
- `AGENTS.md`, `README.md`, `docs/dashboard.md`, `docs/monitoring-api.md`, `docs/scheduling.md` — current workflow, response addition, verification and limitations.

Remaining limitations: only the two exact allowlisted public URLs, no authentication/public use or alerts, no worker heartbeat, refresh-based reads, up to 100 loaded history entries, and best-effort concurrent-setting detection as described above. Phase 6 has not been started.

## Launch the existing local stack

Keep the existing migrated `watchtower_dev` and isolated `watchtower_test` databases. Do not run database initialization again. Preserve the credentials in the ignored `apps/api/.env`; no frontend environment file or database credentials are needed.

From `D:\Github\api-watchtower` in PowerShell:

```powershell
npm install
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
$env:AUTH_COOKIE_SECURE = 'false' # localhost HTTP development only
npm run dev
```

Open `http://localhost:5173`. The API binds to `127.0.0.1:3001`; Vite proxies relative `/api` requests to it. Keep the default ports for this configuration. Separate terminals can use `npm run dev:api` with the same opt-in variables and `npm run dev:web`.

Management remains disabled unless the backend explicitly has both settings. The frontend does not enable management itself and does not change the server's host, origin, forwarded-header, destination, or request restrictions. Every management request includes `X-Watchtower-Local: 1`, uses the same-origin Vite proxy and session cookie, disables redirects, and avoids browser response caching. Writes include the session's in-memory CSRF token. There is no CORS bypass or direct browser request to a monitored URL.

Production builds are compilation checks only. `vite preview` does not provide the development API proxy, and this local-development dashboard must not be hosted publicly. A 404 management response explains the opt-in settings; a 403 explains the local/CSRF restrictions. Phase 6A additionally handles missing or expired sessions with sign-in.

## Available workflows

- **Endpoints:** actual registrations with their latest persisted status, UTC check time, and measured latency. Never checked, healthy, failed, schema changed, and unavailable are distinct states. No check result is invented when a read fails.
- **Registration:** name/URL validation, Todo/Post presets for the two supported exact URLs, server error feedback, and a list reload after registration. Registering never starts a check automatically.
- **Detail:** current endpoint URL, latest saved result, accepted structural baseline, history, and manually triggered checks. Legacy URLs outside the current allowlist retain readable history but cannot trigger checks from this UI.
- **Schema changes:** select any loaded history record to inspect actual field paths, change kinds, and previous/current type sets. HTTP/JSON failures do not masquerade as schema matches.
- **Baseline capture/replacement:** a native confirmation dialog explains the fresh request and requires a checkbox before submitting. It sends the endpoint's exact `updatedAt` from when the dialog opened. A stale/conflicting acceptance closes the dialog, reloads state, and requires a new deliberate confirmation; it never automatically retries with a new timestamp.
- **Local setup:** launch instructions, supported URLs, and a process-health link that does not claim database readiness.

Healthy means the HTTP/JSON check succeeded, not that an API contract is guaranteed compatible. A null baseline remains visibly missing until explicitly captured. Saved history does not contain a per-check baseline version/comparison flag, so an old successful check with an empty change list is described as having no *recorded* changes, rather than as a proven schema match. Array/optional-field limitations from [Phase 2](schema-comparison.md) still apply.

Failed manual HTTP checks return a created check record; the UI inspects `check.outcome` and renders a failure instead of treating the API's HTTP 201 as upstream success. Failed baseline captures may already have saved a check, so the UI refreshes history even when acceptance returns an error. A 20-second client timeout reports that the operation may still finish on the server and asks for a refresh before retrying.

## Frontend structure and decisions

```text
apps/web/src/
  api/types.ts                     Express JSON wire types, without Prisma imports
  api/client.ts                    Relative API calls, safe error messages, URL presets
  hooks/useEndpointDetail.ts       Abortable endpoint/history reads
  components/common.tsx            Status, UTC time, notices, native modal
  components/AddEndpoint.tsx        Registration form and URL validation
  components/EndpointList.tsx       Endpoint table and bounded latest-check loading
  components/EndpointDetail.tsx     Manual action and explicit acceptance orchestration
  components/BaselineConfirmation.tsx
  components/CheckHistory.tsx       History selection and recorded schema differences
  App.tsx                          Small hash navigation and local setup page
  styles.css                       Quiet responsive layout and component styles
```

The existing backend list route returns endpoints without check summaries. The frontend therefore makes at most four concurrent history reads (`limit=1`) after loading registrations. This preserves the API and avoids a burst of 100 simultaneous reads. A partial read failure produces an unavailable status, not “never checked.” Detail reads combine the endpoint and history; a failed read never looks like an empty history and disables mutations until a successful refresh.

Plain React state/effects and hash navigation keep this phase understandable without adding a router, state framework, or query library. Reads are aborted when a view changes, and late results do not replace another endpoint's data. Mutations are not optimistically fabricated; the UI reloads persisted state after each attempt. The browser does not poll or schedule checks or simulate activity. An independently opted-in Phase 5A worker can produce new persisted results after its approved migration; use Refresh to load them. Lists/history are bounded to the existing API's latest 100 records, explicitly described as a view rather than a total.

The desktop sidebar becomes compact horizontal navigation on mobile. Wide tables scroll within their panels, can receive keyboard focus, and retain semantic captions/headers. Native dialogs provide focus containment and Escape cancellation; focus returns to the opener. Visible labels, status text alongside color, live notices, UTC timestamps, high-contrast text, and visible focus indicators support keyboard/screen-reader use. No decorative images, chart libraries, runtime UI dependencies, or fabricated dashboard metrics were added.

The two URL presets and wire types mirror the inspected backend contract. The backend remains authoritative; if its allowlist or response format changes, update these small frontend definitions and tests together.

## Screenshot-ready demonstration

1. Start the local stack as above and open `http://localhost:5173` at a desktop viewport around 1440 × 1000.
2. Select **Add endpoint**, enter a useful name such as “Todo response,” select **Todo**, then **Register endpoint**. The reloaded row should say **Never checked**.
3. Open that row and select **Run check**. The real HTTP outcome, timing, and history appear; failures remain failures if the public service is unavailable.
4. Select **Capture baseline**, read the fresh-response explanation, check the confirmation box, and select **Accept baseline**.
5. Run another check. Inspect its persisted history and expand **View saved schema**. An unchanged response has no recorded structural changes; the UI still explains the inference limits.
6. Reload or reopen the endpoint's `#endpoints/<id>` URL to verify persistence. Return to the list for an overview screenshot, or resize to 390 × 844 for mobile. Tables scroll horizontally inside their panels.

The stable public sample may never show a real schema-change incident. Do not insert fake changes or metrics just to populate a screenshot. Component tests cover those states using test-only fixtures.

Screenshots captured from the actual local application are ignored artifacts under `apps/web/artifacts`: `dashboard-desktop.png`, `dashboard-detail.png`, and `dashboard-mobile.png`. Browser verification creates real development registrations and three public requests per full workflow; it leaves that data intact for inspection.

## Tests

```powershell
npm test                 # Existing backend + frontend component/client tests
npm run test:web         # Frontend only
npm run test:db          # Existing isolated PostgreSQL integration suite
npm run typecheck
npm run build
```

Frontend tests use Vitest, jsdom, and Testing Library. Their fixtures live only under `apps/web/tests` and are not imported by the running application. Test coverage includes loading/empty/error states, status distinctions, partial history failures, registration validation and list reload, manual checking/busy states, failed upstream results, history selection, structural differences, deliberate capture/replacement, stale conflicts, and failed capture recovery.

Verified Phase 4 results (the current Phase 5A pre-migration results are in the worker guide):

| Verification | Actual result |
| --- | --- |
| `npm test` backend workspace | 158 passed across 7 files, including 7 PostgreSQL integration tests |
| `npm test` frontend workspace | 28 passed across 2 files |
| Full unit/component/integration suite | 186 passed; none skipped |
| Explicitly enabled live Playwright workflow | 1 passed using the actual local API and public HTTPS service |
| `npm run typecheck` | Both workspaces passed |
| `npm run build` | Both workspaces passed |
| `npm run db:validate` | Prisma schema valid |
| Final read-only mobile/browser inspection | 390-pixel viewport and content width; keyboard table scrolling worked; three persisted checks survived reload; no browser exceptions |

With the real local stack already running and Microsoft Edge installed, explicitly opt into the Playwright browser workflow in a separate terminal:

```powershell
$env:WATCHTOWER_LIVE_E2E = 'true'
npm run test:e2e
```

It uses no API mocks, exercises the real Vite proxy/security guards and full UI workflow, reloads persisted data, checks native modal focus/Escape behavior, validates mobile page width, captures screenshots, and fails on browser exceptions. Without the explicit flag it skips, since it creates real development history. It never initializes/resets a database or deletes existing data.

The first browser run exposed mobile overflow from absolutely positioned screen-reader table text. Giving the table scrollers a positioning context fixed it; the subsequent full workflow passed at desktop and mobile widths. An initial unit assertion also needed to allow identical timestamps across independent endpoint fixtures, and a test query used an unsupported TypeScript option that was removed. Those were corrected rather than bypassed. A supplemental read-only inspection initially timed out when the preview was stopped too early; it passed after restarting the stack and completing inspection before teardown.

## Known limits

Only the existing two public JSONPlaceholder URLs are supported. The browser has no automatic polling/checking or schedule controls. The separate [Phase 5A worker](scheduling.md) requires its approved migration, process opt-in, and per-endpoint opt-in; it does not run when stopped. Alerts, authentication, endpoint editing/deletion, cursor pagination, and public deployment are not included. Manual Refresh loads updates from other sessions or an active worker. Historical baseline versioning is not available. Testing-library tests mock network data, while live browser verification depends on actual local PostgreSQL and the public test provider.
