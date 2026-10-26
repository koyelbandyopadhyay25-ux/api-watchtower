# Independent API provider review — Phase 7A.3A

Review date: 2026-10-26. This section records the original research phase; the dated implementation/preflight status below supersedes its catalog and no-request statements. The initial GOV.UK proposal was corrected by explicit approval to `https://www.gov.uk/bank-holidays.json`. The earlier `/api/bank-holidays.json` path was not approved.

## Executive recommendation

Take three candidates to the next approval checkpoint, in this order:

1. **GOV.UK Bank Holidays API** — `https://www.gov.uk/bank-holidays.json` (corrected from the original proposal)
2. **Nager.Holidays Community API v4** — `https://nagerholidays.com/api/v4/Holidays/AT/2026`
3. **DummyJSON** — `https://dummyjson.com/products/categories`

All are public read-only JSON resources with documented examples and no request parameters in the proposed exact URL. GOV.UK and Nager provide real public reference data; DummyJSON is explicitly synthetic and useful for repeatable sample object-array shapes. These are proposals, not approved destinations. Before adding any URL, verify that the exact route returns 2xx JSON without redirects, its final DNS A set is public and unambiguous, and the connected peer and TLS identity satisfy the existing fetcher. DNS/IPv4 and redirect behavior have not been established by documentation alone.

Prefer exact sample URLs at first, rather than arbitrary input or broad path patterns. Nager's selected URL is tied to a year; a future year would require another reviewed catalog change. Do not expand to an unrestricted host/path interface.

## Candidate comparison

The five independent providers below were assessed against the project's current constraints. “No authentication” means the official example/API page does not require credentials for the selected public route; no candidate was contacted. “IPv4” and redirect cells are deliberately marked unverified unless primary documentation establishes them. All candidates remain subject to the fetcher's strict 443, direct IPv4, certificate, no-redirect, byte/time and concurrency gates.

| Provider and operator | Candidate URL / JSON shape | Access and request shape | Terms, request policy and operational fit | Decision |
| --- | --- | --- | --- | --- |
| GOV.UK Bank Holidays API (UK Government Digital Service) | Corrected URL: `https://www.gov.uk/bank-holidays.json`; a JSON object with `england-and-wales`, `scotland`, and `northern-ireland` divisions containing event lists. | Official GOV.UK reference documents the Bank Holidays API as JSON; GET, no key, no query or custom header documented. HTTPS URL is documented. Redirect behavior and IPv4 reachability were not documented and required live preflight. | GOV.UK reuse guidance points to the Open Government Licence. This endpoint has a small, published reference-data shape and should be low volume. No endpoint-specific numeric rate limit, uptime SLA, or redirect guarantee was found in the reviewed material. Holiday updates and service/content publishing can change; schema monitoring should treat data content as distinct from schema. | **Recommend.** Government-maintained non-personal data, compact nested object, and a clear official re-use route. |
| Nager.Holidays (Nager.Date project/community API) | `https://nagerholidays.com/api/v4/Holidays/AT/2026`; JSON array of holiday objects with date/name/country fields, booleans, nullable subdivision list and a type list. | Official API page shows HTTPS GET `/api/v4/Holidays/{CountryCode}/{Year}` and JSON preview. No key/header/query is shown for the Community API route. Redirect behavior and IPv4 reachability are unverified; reject redirects. | The official page currently states no request limits; treat that as provider guidance, not a guarantee or permission for high volume. Its service terms should be reviewed directly before any non-local/commercial use. API v4 is the current Community version in the project release notes; v3 has an announced end-of-life date. A fixed-year URL is intentionally selected, so moving to another year must be deliberate. Community-maintained holiday facts can be corrected/added, and official documentation notes records can be tentative or change with government announcements. | **Recommend conditionally.** Useful array/null/enum structure across a separate provider, but inspect terms and confirm the fixed path is still served without redirect before approval. |
| DummyJSON (independently operated sample-data service) | `https://dummyjson.com/products/categories`; JSON array of small category objects such as `{ slug, name, url }`. | Official product documentation gives HTTPS GET examples for the products API. No key/header/query is needed in the documented examples. Redirect behavior and IPv4 reachability are unverified. | Explicitly placeholder/sample data rather than a production business API. The GitHub repository's MIT license applies to its source; it should not be read as a license for the hosted service/data. The reviewed docs do not state a numeric request limit or uptime SLA; keep checks sparse and honor 429. Small expected response, but actual size is not measured in this research phase. | **Recommend.** Useful stable-looking array-of-objects case without personal-looking review data; it gives the dashboard a safe structural sample. |
| PokéAPI (community API) | Candidate route `https://pokeapi.co/api/v2/pokemon/ditto/`; JSON object with scalar properties and nested resource/array objects. | Official v2 docs show HTTPS GET `/api/v2/pokemon/{id or name}/`. No authentication or custom request header appears in the route examples. IPv4 and no-redirect behavior are not established here. | Official fair-use guidance asks clients to cache resources whenever requested and warns against abuse. Its separate GraphQL beta documents a 100 calls/hour/IP cap and scheduled reboot; do not incorrectly apply that exact GraphQL cap to REST, but it signals limited operational capacity. API Watchtower does not retain full response bodies for caching, so repeated uncached REST checks may conflict with the fair-use request. | **Do not recommend yet.** Resolve caching/fair-use compatibility with the provider or design a compliant cache without storing sensitive bodies. |
| Free Dictionary API (community-maintained) | Candidate route `https://api.dictionaryapi.dev/api/v2/entries/en/hello`; JSON array of dictionary entries, nested meanings/definitions/phonetics. | Maintainer's official repository documents GET `/api/v2/entries/en/{word}` and an example URL; it describes the project as a free API and shows no key. No custom header/query requirement is documented in that example. IPv4/redirect behavior are unverified. | The maintainer repository says usage has grown and server costs are difficult to cover, and asks for support. No numeric cap, formal service SLA, or terms suitable for repeated monitoring were established in reviewed first-party material. The response may include external audio URLs; bodies are not persisted by Watchtower, but schema shape is relatively variable. | **Do not recommend for initial expansion.** Low operational assurance and no clear published request policy. |

Other checked alternatives were excluded: the current REST Countries documentation says its API endpoints require a bearer API key and quota, which conflicts with the no-credentials requirement; httpbin is an HTTP-client diagnostic service rather than an independently operated production-like API, and its legacy documentation lists redirect and query-driven behavior that the current checker intentionally refuses. Open-Meteo was not shortlisted because ordinary forecast routes require query parameters.

## Evidence and provider references

- [GOV.UK API Catalogue — Bank Holidays](https://www.api.gov.uk/gds/bank-holidays/) identifies the official Bank Holidays API and lists the exact `/bank-holidays.json` endpoint; [GOV.UK reuse guidance](https://www.gov.uk/help/reuse-govuk-content) confirms JSON and reuse terms; [GOV.UK developer documentation](https://docs.publishing.service.gov.uk/repos/frontend/calendars.html) describes the divisions/data structure; [UK Government Licensing Framework](https://www.nationalarchives.gov.uk/information-management/re-using-public-sector-information/uk-government-licensing-framework/) explains OGL policy. The 2014 blog linked there describes a legacy API convention and is not used to establish the approved target URL.
- [Nager.Holidays API documentation](https://nagerholidays.com/api) describes the v4 Community API route, JSON model and stated request-limit guidance; [Nager.Date repository and lifecycle](https://github.com/nager/Nager.Date) identify the project, supported API versions and release activity. The repository MIT license covers software; it is not assumed here to settle hosted API terms/data licensing.
- [DummyJSON product documentation](https://dummyjson.com/docs/products) provides the product/category request examples and response shapes; [DummyJSON source repository](https://github.com/Ovi/DummyJSON) describes the service as sample data and carries a repository license, not an identified hosted-service SLA or data license.
- [PokéAPI v2 documentation](https://pokeapi.co/docs/v2) documents the resource route; [PokéAPI fair-use/GraphQL notes](https://pokeapi.co/docs/graphql) describe its cache request and the distinct GraphQL beta's rate/availability constraints.
- [Free Dictionary API maintainer documentation](https://github.com/meetDeveloper/freeDictionaryAPI) shows its endpoint example and maintainership/support context. This is first-party project documentation, not a formal SLA or rate-limit policy.
- Excluded REST Countries evidence: [current official API docs](https://restcountries.com/docs) state that API endpoints authenticate with a bearer token and share account quotas. Excluded diagnostic service evidence: [httpbin's legacy documentation](https://httpbin.org/legacy) describes its HTTP testing purpose and redirect/query test endpoints.

## Current fetcher review across multiple providers

### What already carries over

The fetcher has a strong transport boundary for a deliberately curated set of targets:

- Endpoint registration calls the shared `validateTarget()` policy. Manual checks, explicit baseline capture, and the scheduled worker all revalidate stored endpoint URLs immediately before the common fetcher is called.
- DNS uses a controlled `dns.promises.Resolver.resolve4()` lookup for the URL hostname. It caps results at 64, rejects empty, malformed, or mixed public/private A sets, and deterministically selects one allowed IPv4. Every check resolves again.
- `createPinnedHttpsAgent()` dials the selected literal IPv4 with family 4 and port 443. It checks `remoteAddress` and `remotePort` before TLS, then uses the original hostname for SNI and certificate identity validation with normal CA verification. The connection is not pooled/reused; the agent does not use a configured proxy.
- Only GET, fixed headers, 2xx responses and JSON media types are accepted. Redirects are not followed, compressed bodies are rejected, headers/body/JSON complexity and total time are bounded, and error results use safe categories.
- `MonitoringService` persists real checks and compares only successful JSON against the explicitly accepted baseline. Incident/outbox transitions observe those persisted outcomes under the existing endpoint coordination. The independent worker invokes this same service without browser credentials; HTTP routes still enforce session ownership and CSRF separately.

### What must change before multiple hosts

The current canonicalizer is intentionally coupled to `jsonplaceholder.typicode.com` for its explicit `:443` compatibility forms, and its entries are host/path triples that happen to share one host. Multi-provider support should:

1. Keep a single source-controlled catalog of entries with provider ID/label, canonical hostname, exact path, and exact canonical URL. Keep the API contract exact URL initially; do not accept arbitrary path variables or host patterns.
2. Canonicalize from an entry-specific URL, not string replacement of one shared hostname. Compare raw input with the one canonical URL, permitting only a separately justified compatibility spelling. Continue rejecting IDNs/noncanonical spellings, userinfo, query, fragment, encoded separators and normalization changes.
3. Pass the matched entry (or derive host from its canonical URL) into the same validation and pinned transport. Do not add per-provider clients, proxy settings, headers, TLS exceptions, or resolver fallbacks.
4. Add every host's accepted media type and response constraints only if the existing JSON-only policy can support it consistently. Do not follow redirects even when a provider's normal web route redirects: select a final canonical HTTPS URL or reject that candidate.
5. Ensure frontend presets and backend policy import the one catalog; registration, manual checks, baseline checks and scheduled checks must all continue to revalidate against it.

The URL catalog is an application allowlist, not a complete egress firewall. The OS/network can still route globally addressed space through a VPN, transparent proxy or internal route. IPv6 remains intentionally unsupported; no AAAA dial/fallback should be introduced. Current runtime DNS validates A answers and pins the selected address. For each new hostname, deployment review must consider CDN/DNS address rotation and ensure all possible A answers pass the existing public-address policy. Documentation cannot prove current A answers or TLS behavior; an approved implementation stage must verify them through the same pinned fetcher and record actual socket-peer evidence.

## Failure and incident semantics

The current fetcher stores safe categories rather than raw errors or response bodies:

| Observed condition | Current result | Incident/notification interpretation |
| --- | --- | --- |
| Resolver failure/empty/unsafe DNS result | `network_error`, generally `dns_failure` or safe `unknown` | An endpoint check failed. It does not prove the provider's entire service is down; local DNS/routing can cause it. |
| Deadline exceeded during DNS/connect/TLS/headers/body | `network_error`, `timeout` | Failed check; one timeout is an observation from this monitor, not an upstream-wide outage claim. |
| TCP connection failure | `network_error`, `connection_failure` | Failed check. Could reflect local network, provider network, or destination availability. |
| TLS chain/identity error | `network_error`, `tls_failure` | Failed check, with no certificate detail exposed to users. Do not bypass verification. |
| HTTP non-2xx, including 4xx/5xx and 3xx | `http_error`, `http_status`, actual status retained | Failed check. A 429 is rate limiting, not by itself proof of a provider outage. |
| Invalid media type, compressed payload, over-limit bytes/complexity, invalid UTF-8/JSON | `invalid_json`, safe `invalid_json` category | Failed check, not a schema comparison. |
| 2xx valid JSON with accepted baseline | Successful check or `schema_changed` | Compare structure; values alone do not change schema. No baseline means no schema-change claim. |

The existing availability incident state treats non-success outcomes uniformly. That is suitable for a factual “check failed” notification, but the UI and email must display the safe error category and HTTP status rather than assert a confirmed upstream outage. For 429 specifically, keep it an actual HTTP failure while identifying rate limiting explicitly in presentation. A later policy may suppress/hold incident escalation for repeated 429 responses, but should not rewrite the persisted result. Structural-change incidents must continue to require an accepted baseline; missing baselines and all failed/non-JSON responses must not create schema-change incidents. Recovery remains based on a subsequent real successful check under current incident logic.

No raw URL query, response body, TLS detail or upstream error text should be added to logs, notification messages, or stored check metadata.

## Proposed Phase 7A.3B implementation

If the recommendations are approved, implement only the exact approved entries, with per-provider exact URL catalog records. Do not add a dynamic wildcard or generic endpoint registration field.

Likely files to update:

- `apps/api/src/monitoring/supported-endpoints.ts` — provider metadata and exact candidate URLs, subject to approval.
- `apps/api/src/monitoring/url-policy.ts` — derive URL/host checks from catalog records; preserve IPv4 block policy.
- `apps/api/src/monitoring/safe-json-fetcher.ts` and `pinned-https-agent.ts` — only if required to thread matched hostname safely; preserve current transport contract.
- `apps/api/tests/safe-json-fetcher.test.ts`, pinned-agent tests and a new provider catalog test — accepted entries, exact path/host, normalization, mixed DNS, actual dial IP, peer mismatch, TLS name, no redirect, size/deadline/proxy limits.
- `apps/api/tests/approved-targets.integration.test.ts` or a new guarded integration suite — use only confirmed isolated `watchtower_test`, create owned fixture rows, check real targets only after approval, accept baseline explicitly, compare a second real result, verify persistence and delete only owned test rows.
- `apps/web/src/components/AddEndpoint.tsx`, `apps/web/src/App.tsx`, API client/types and associated component/E2E tests — grouped, compact provider selector with explicit labels; no free-form URL input.
- `README.md`, `AGENTS.md`, `docs/monitoring-api.md`, and this review plan — document exact catalog and limits after implementation.

There should be no fetcher redesign and no schema-comparison change. Keep 429 records and statuses as observed; no automatic retries should turn a burst into more provider load. Any retry/backoff design needs bounded behavior and rate guidance.

## Frontend proposal

Use one native, accessible `<select>` grouped with `<optgroup>` labels by provider, followed by a compact selected URL/path preview and a short note that only reviewed destinations are supported. Keep the existing name field, validation, and submit behavior. No arbitrary text URL field, editable hostname, custom header/key field, monitoring statistics, or provider card grid. For rejected attempts, show a concise message such as “This destination is not in the supported catalog.” For a saved endpoint whose provider later becomes unavailable, retain the stored endpoint/history and show the actual safe check result; do not hide or mutate it when the catalog changes.

## Security test plan

Tests should run before and after integration:

1. **Catalog and normalization:** all four existing URLs remain valid; each candidate's exact approved URL becomes valid only after its approval; reject all other hosts/paths, query/fragment/userinfo, custom ports, encoded slash/backslash, dot segments, case or trailing-dot host tricks, Unicode/IDN/punycode variations, and malformed URL forms. Test the provider labels and exact selector count.
2. **Resolver policy:** public-only A set accepted; any empty, too-large, malformed, private/special-use, or mixed public/private set rejected before connector invocation; DNS failures/timeouts classified safely; each check resolves anew.
3. **Destination integrity:** inject resolver and socket constructors; assert the exact selected literal IP and port 443 are dialed, the connected remote peer must match, a mismatch is rejected before TLS/HTTP, hostname SNI and certificate verification use the approved hostname, and no second lookup/pool/proxy path exists.
4. **Transport responses:** reject redirects without contacting Location, wrong TLS hostname/untrusted chain, timeout at each stage, over-limit chunked body/headers, compressed response, non-JSON media type, malformed JSON and status failures. Confirm 429 remains distinguishable as HTTP rate limiting.
5. **Schema and workflow:** structural inference for object/array samples, no structural changes from ordinary value changes, null/empty/heterogeneous-array cases, and no schema-change claim without an explicitly saved baseline. Confirm response bodies are absent from persistence.
6. **DB and authorization:** using isolated test DB only, verify real check/baseline/history persistence, schedules and incident/notification transitions, CSRF, owner A/B isolation, unclaimed legacy records, no extra schemas or migrations, cleanup only of test-suite-owned rows, and notification/schedule disabled defaults.
7. **Conservative live checks:** after security and terms approval, one manual check per selected target, spaced by at least 10 seconds, then an explicit baseline and at most one follow-up comparison per URL. Do not enable schedules during initial provider verification. Capture status, elapsed time, safe error category, A set and actual peer address without persisting response bodies or secrets. Stop that target's live testing after 429, 5xx bursts, policy notice, or unusual latency; do not retry automatically.

Never simulate attacks by contacting local/private/cloud metadata destinations. Use mocks and controlled socket/TLS fixtures. Browser E2E should add only the selected catalog options and use the existing local API, test DB, and Mailpit where notification flows are exercised.

## Database and backward compatibility

**No Prisma migration is required or proposed.** `Endpoint.url` is already a string with a 2048-character limit, checks and baselines are URL-agnostic, and schedules/incidents/notification rows link through the existing endpoint ID. Existing endpoints and history can remain as-is. Do not rewrite their URLs or baselines. The shared catalog controls new registration and revalidation for historical records; any prior endpoint not in the current catalog would fail its next check safely, but the current four existing destinations remain valid. Before eventual expansion, read-only inventory should confirm all stored URLs and ownership; do not mutate records. Do not reset/reinitialize either database.

The initial expansion should retain current incident/outbox transaction semantics, per-endpoint/database coordination, owner-scoped routes, CSRF, localhost management boundary, and local Mailpit-only SMTP. No API key support, endpoint-specific custom headers, external email, or public deployment is part of this plan.

## Remaining limitations and deployment implications

- No candidate has passed live redirect, DNS A-set, IPv4, TLS, peer-address, body-size, or availability verification in this phase. This document does not authorize live checks.
- Provider behavior, routes, terms and limits can change. Catalog entries need dated review and a removal/disable policy that preserves existing records and history.
- Three candidates include two community/synthetic services. None creates a multi-provider reliability guarantee or SLA for Watchtower.
- A 429 indicates this request was throttled; it is not evidence of a general outage. A 403 may be auth/quota/policy. Error details cannot be inferred beyond the returned code safely.
- The fetcher is IPv4-only. IPv6-only DNS records are not dialed; actual A records must be present and public. VPNs, transparent proxies, host routes, or cloud network configuration still require an egress boundary outside this process.
- The current service is localhost-only. Public deployment needs separate network egress isolation, operational quotas/abuse controls, security and privacy review, provider terms review, and authentication/notification production review.

## Phase 7A.3B approval checkpoint

The Phase 7A.3A checkpoint below is historical and superseded by the explicit Phase 7A.3B authorization recorded next.

Please approve or reject each exact candidate independently:

1. `https://www.gov.uk/api/bank-holidays.json` — GOV.UK Bank Holidays JSON.
2. `https://nagerholidays.com/api/v4/Holidays/AT/2026` — Nager.Holidays Community v4, Austria 2026 sample route.
3. `https://dummyjson.com/products/categories` — DummyJSON synthetic category array.

Approval would authorize only the exact URLs explicitly approved above to proceed to Phase 7A.3B security preflight and implementation; it would not authorize arbitrary host/path access, broad wildcard routes, query parameters, or any unlisted API. The implementation must stop if a target requires redirects, fails the existing public IPv4/TLS/socket checks, exceeds limits, or its applicable terms conflict with monitoring. No candidate was contacted in Phase 7A.3A.

## Phase 7A.3B implementation and preflight record (2026-10-26)

The user corrected and approved the exact GOV.UK URL, then approved the GOV.UK, Nager.Holidays and DummyJSON URLs subject to preflight. A temporary preflight harness used an exact three-URL list and the existing `isPublicIpv4()` classifier and `createPinnedHttpsAgent()`. It did not invoke a generic fetch client, open the production catalog, follow redirects, print response bodies, or persist any data.

| Approved candidate | Preflight evidence | Catalog decision |
| --- | --- | --- |
| `https://www.gov.uk/bank-holidays.json` | HTTPS/443; DNS A `199.232.100.144` passed the existing public IPv4 policy; the pinned connection's peer was `199.232.100.144:443`; SNI was `www.gov.uk`; certificate/hostname validation passed; HTTP 200, `application/json`, 22,207 bytes, valid JSON object, about 1.0 second. No redirect, credentials, query, cookies or custom headers were used. | Added. This is the corrected, authorized route. `/api/bank-holidays.json` is not supported. |
| `https://nagerholidays.com/api/v4/Holidays/AT/2026` | DNS A answers `104.21.81.123` and `172.67.161.27` passed public IPv4 classification. The deterministic selected address was `104.21.81.123`, but the existing 8-second deadline expired before a connected peer or HTTP response was established. | **Not added.** No retry was made and no security control was weakened. |
| `https://dummyjson.com/products/categories` | HTTPS/443; DNS A answers `172.67.205.42` and `104.21.61.23` passed public IPv4 classification; deterministic selected peer was `104.21.61.23:443`; SNI was `dummyjson.com`; certificate/hostname validation passed; HTTP 200, `application/json`, 2,512 bytes, valid JSON array, about 0.7 second. No redirect, credentials, query, cookies or custom headers were used. | Added. |

The preflight established those facts only for those requests and DNS answers; it does not guarantee future availability, redirect behavior, DNS sets, or provider policy. The Nager timeout is a failed preflight even though DNS was public. No alternative Nager URL or provider was substituted.

The shared production catalog now has exactly six URLs: the four JSONPlaceholder routes, corrected GOV.UK `/bank-holidays.json`, and DummyJSON `/products/categories`. Nager is deliberately absent. Add Endpoint groups current choices under JSONPlaceholder, GOV.UK and DummyJSON; it does not show an unavailable provider choice.

The temporary preflight script was removed after evidence was recorded. Real persistence tests use the isolated test database and only the two successfully preflighted new URLs. For each they create an owned disposable fixture, capture a fresh explicit baseline and perform a real follow-up check; DummyJSON also exercises a real scheduled check. No response body is stored. Test-owned records are cleaned by endpoint-specific cleanup. There is no Prisma change or migration.

### Phase 7A.3B verification status

- Preflight: GOV.UK and DummyJSON passed through the pinned transport; Nager timed out at 8 seconds before peer/HTTP evidence and was not added. The exact GOV.UK route is `/bank-holidays.json`; the previously suggested `/api/bank-holidays.json` is rejected.
- PostgreSQL integration: `npm run test:db` **41 passed**; live persisted checks, explicit baseline acceptance/comparison, and the DummyJSON scheduled check ran against `watchtower_test`.
- Automated suites: `npm test` **428 passed, 3 skipped, 0 failed** (API 350 passed/3 skipped; web 78 passed). The full browser E2E suite **4 passed**.
- Static/build checks: `npm run typecheck`, `npm run build`, `npm run db:validate`, and `git diff --check` passed.
- Read-only preservation check: both databases are at `127.0.0.1:5432`; all four applied migration checksums match. The verified backup's original development rows remained unchanged: 17 endpoints, 38 checks, 6 schedules, 7 scheduled checks, 9 users and 3 sessions. Integration cleanup left the test database with zero endpoint/check rows. Both databases had zero enabled schedules and zero enabled notification preferences.
- No migration, reset, drop, truncate, recreation, backfill, or ownership reassignment was performed. Browser E2E workflows created additional legitimate development records; those were retained. No demonstration schedule or notification preference remains enabled.

The final catalog has exactly six entries: four JSONPlaceholder URLs, the corrected GOV.UK URL and DummyJSON categories. Nager is not supported. Known boundaries: public IPv4 egress is not isolated at the network layer, IPv6 and arbitrary domains remain unsupported, and preflight does not promise provider availability or an SLA. SMTP delivery remains limited to local Mailpit.
