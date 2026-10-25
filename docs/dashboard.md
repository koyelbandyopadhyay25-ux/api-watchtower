# Developer dashboard (Phase 4)

## Launch the existing local stack

Keep the existing migrated `watchtower_dev` and isolated `watchtower_test` databases. Do not run database initialization again. Preserve the credentials in the ignored `apps/api/.env`; no frontend environment file or database credentials are needed.

From `D:\Github\api-watchtower` in PowerShell:

```powershell
npm install
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
npm run dev
```

Open `http://localhost:5173`. The API binds to `127.0.0.1:3001`; Vite proxies relative `/api` requests to it. Keep the default ports for this configuration. Separate terminals can use `npm run dev:api` with the same opt-in variables and `npm run dev:web`.

Management remains disabled unless the backend explicitly has both settings. The frontend does not enable management itself and does not change the server's host, origin, forwarded-header, destination, or request restrictions. Every frontend management request includes `X-Watchtower-Local: 1`, uses the same-origin Vite proxy, omits credentials, disables redirects, and avoids browser response caching. There is no CORS bypass or direct browser request to a monitored URL.

Production builds are compilation checks only. `vite preview` does not provide the development API proxy, and this unauthenticated dashboard must not be hosted publicly. A 404 management response explains the opt-in settings; a 403 explains how to use the expected local server without weakening the guards.

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

Plain React state/effects and hash navigation keep this phase understandable without adding a router, state framework, or query library. Reads are aborted when a view changes, and late results do not replace another endpoint's data. Mutations are not optimistically fabricated; the UI reloads persisted state after each attempt. There is no polling, scheduling, or live-activity simulation. Lists/history are bounded to the existing API's latest 100 records, explicitly described as a view rather than a total.

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

Final local results:

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

Only the existing two public JSONPlaceholder URLs are supported. No automatic polling/checking, scheduling, alerts, authentication, endpoint editing/deletion, cursor pagination, or public deployment is included. Manual Refresh loads updates from other sessions. Historical baseline versioning is not available in the existing database model. Testing-library tests mock network data, while live browser verification depends on the actual local PostgreSQL service and public test provider being available.
