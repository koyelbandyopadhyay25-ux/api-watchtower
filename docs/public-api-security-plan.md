# Public API monitoring security plan — Phase 7A.1

Review date: 2026-10-25. **Architecture review only; implementation and network expansion require explicit Phase 7A.2 approval.** The two exact JSONPlaceholder URLs, all runtime guards, applied migrations and database records are unchanged. A passing existing test is not evidence that the proposed broader policy already exists.

## Recommendation and approval boundary

Use **C with a hardened A transport** for the first expansion: a small source-controlled catalog of exact, reviewed public hostnames and permitted read-only path families, fetched through the existing DNS-pinned IPv4 HTTPS implementation. Users can enter URLs within that catalog; they cannot add hosts, wildcard subdomains, proxy settings or credentials. Do not interpret a catalog entry as permission to skip DNS/IP checks. Keep the two current URLs as compatible entries.

This permits useful additional APIs without introducing a separate fetching deployment or promising safe arbitrary-domain access. The catalog needs individual review before additions; this document proposes no new hostname. An approved Phase 7A.2 implementation must add the enforcement and tests below **before** changing any destination entry. If the product requirement instead becomes unrestricted user-controlled domains, require a separate approval for a network-isolated egress boundary (B); do not silently remove the catalog.

The combination of destination allowlisting, validation of resolved addresses, connection-time pinning and network-layer defense follows the [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). The exact scope and restrictions below are this project's proposed design, not a claim that the guidance certifies the implementation.

Application validation is a useful boundary inside the current trusted, localhost-only environment. It cannot prove that an apparently public address is not routed internally by a VPN, corporate network, transparent proxy or cloud routing configuration. Public deployment and arbitrary-domain access are separate security decisions.

## Inspection and present request architecture

Reviewed AGENTS.md, README, monitoring/authentication/notification documentation; `monitoring/url-policy.ts`, `safe-json-fetcher.ts`, `monitoring-service.ts`, `management-routes.ts`; repository/check coordination; scheduling worker; Prisma models; AddEndpoint/client/setup components; fetcher, service, management/ownership/authentication, scheduling, persistence and notification tests. URL-policy tests are currently inside `safe-json-fetcher.test.ts`, not a separate file. The inspected runtime is Node **24.21.0**; package engines currently accept versions from 22.12 upward, so behavior across that broad range is not assumed identical.

Current request sequence:

1. Express mounts management only with development mode and explicit local opt-in. A loopback peer, local Host, allowed Origin when present, no forwarded headers and `X-Watchtower-Local: 1` are required. Sessions establish ownership; writes require CSRF and bounded JSON bodies. Another owner's or unclaimed endpoint returns 404.
2. Registration accepts only name and URL. `service.register()` calls `validateTarget()` and stores its canonical `href` with the authenticated owner. Registration does not resolve DNS or fetch. The frontend independently limits input to the two presets; backend validation is authoritative.
3. `validateTarget()` uses WHATWG URL parsing, a 2,048-character limit, raw whitespace/backslash/`@`/`?`/`#` rejection, HTTPS, no userinfo, port 443, and exact equality of the parsed `href` with one of two constants. It permits equivalent normalization such as explicit :443, hostname case and dot-segment normalization when the final URL is exactly allowed. This is not a general raw-input canonicalization policy.
4. Manual checking, explicit baseline capture and scheduled checking all enter the same service and PostgreSQL transaction/advisory locks. Endpoint overlap is excluded; at most three checks are admitted across participating processes using the same database. The operation budget is 15s, transaction cap 25s, acquisition maxWait 2s; statement and lock timeouts are 3s and 1s. The worker polls up to three due schedules and does not impersonate a browser user.
5. Every check revalidates the stored URL, then creates a cancellable `dns.promises.Resolver` with 3s query timeout and one try per configured name server. `resolve4()` returns A addresses; all returned candidates must pass `isPublicIpv4()`. This is DNS resolution, not the OS hostname lookup/hosts-file path. The whole fetch still has an 8s deadline. AAAA addresses are neither requested nor dialed. [Node DNS reference](https://nodejs.org/docs/latest-v24.x/api/dns.html#implementation-considerations).
6. The fetcher selects the lexicographically first eligible IPv4 string. `https.request()` receives that literal address, family 4 and port 443. Original hostname is retained for Host, SNI and `tls.checkServerIdentity`; `rejectUnauthorized` is true. `agent:false` creates a fresh connection rather than using the shared connection pool. There is no second hostname resolution or address fallback.
7. Only GET and fixed Host/Accept/Accept-Encoding headers are sent. No API keys, user cookies, authorization or custom request headers are supported. Redirect responses are HTTP failures; Location is never fetched. Proxy configuration is not passed to the agent.
8. The reader accepts 2xx JSON media types, identity/no content encoding and valid UTF-8. It bounds headers at 16 KiB, streamed body at 128 KiB, JSON depth at 50 and nodes at 5,000. Its absolute deadline covers DNS, connection, headers and body, including stalled streams. Parsing and schema inference are synchronous; timer callbacks cannot preempt CPU execution.
9. Actual status, timing, safe error category, schema differences and scheduled provenance are persisted. Baseline replacement remains explicit. Incident transitions and optional outbox writes share that transaction; SMTP runs separately and only to local Mailpit. No full response body or remote headers are persisted.

Current tests prove literal-IP request options, one resolver call, mixed unsafe-A refusal, hostname-check callback behavior, redirect refusal and resource/error paths with mocked transport. Earlier live tests prove actual successful HTTPS checks. They do **not** establish a comprehensive adversarial socket/DNS/TLS enforcement suite or inspect the actual peer address.

## Threat model and evidence limits

Attackers may be authenticated local users, malicious DNS/API operators or compromised public endpoints. Inputs include URLs, DNS results, certificates, response headers and JSON. Assets include local/cloud services, PostgreSQL and Mailpit, user/session data, baselines/history, worker availability and outbound reputation. Application source, process startup settings, trusted CA store and the host network are trusted operational inputs; a compromised runtime/OS is outside an application-only guarantee.

| Attack | Current enforcement / identified weakness | Required first-expansion treatment |
| --- | --- | --- |
| localhost, loopback, private IPv4 | Exact URL gate plus IPv4 filtering; rejects 127/8, RFC1918 and other special blocks before request creation | Retain DNS-only curated hosts and all existing blocked ranges; assert zero connector calls for every blocked case |
| Private IPv6, mapped IPv6, IPv6 zones | No literal is allowlisted, `isIPv4` rejects IPv6, transport is family 4 | Reject every IPv6 literal, mapped form and zone identifier; no resolve6, dual-stack fallback, NAT64 synthesis or Happy Eyeballs |
| Link-local, unspecified, multicast, reserved | Several explicit IPv4 ranges are blocked; classifier is hand-maintained | Checked-in conservative CIDR table, boundary tests and maintenance provenance; reject unclassifiable input |
| Cloud metadata/control addresses | Link-local/CGN blocks and explicit 168.63.129.16 refusal cover important cases | Preserve these blocks and reserved metadata/internal hostname refusals; do not claim an exhaustive provider metadata inventory |
| Rebinding between checks | URL and A set are revalidated on every attempt | No saved IP or registration result grants permission to later checks |
| DNS change between validation and connection | Selected literal IP is passed to HTTPS, with no second name lookup | Keep pinning; verify socket peer and prove no second resolver/fallback path using adversarial tests |
| Mixed safe/unsafe records | Any unsafe returned A candidate rejects the entire set | Reject the whole A result, including one bad record after many good ones; never filter to a seemingly safe subset |
| Unsafe AAAA mixed with safe A | Current implementation does not inspect AAAA and cannot contact it | Explicit IPv4-only policy: AAAA is not an eligible candidate. Do not claim that all DNS record families were validated |
| CNAME to internal address | Resolver can follow aliases; returned final A addresses are classified | Reject prohibited terminal A addresses; alias loops/errors fail closed. No separate CNAME lookup grants trust or triggers connection |
| Alternate numeric IP spelling | Exact URL gate excludes literals, including normalized integer IPv4 | Reject IP literals after parsing and encoded/noncanonical authority before normalization: decimal, octal, hex, shortened/dotted, brackets and mapped forms |
| IDNs and normalization | Canonical allowed-host equality prevents alternate-host expansion; no reviewed IDN policy | ASCII DNS names only initially; reject Unicode authority, `xn--` labels, trailing dots, percent-encoded authority, empty/invalid labels |
| Credentials or secret-bearing URL | Userinfo, all queries and fragments currently refused | Retain all-query rejection; a token-name denylist cannot reliably detect credentials. Secret path segments also remain unsupported |
| Unsafe ports / protocol downgrade | HTTPS and 443 only; no redirects | Retain, including explicit rejection of HTTP, scheme-relative URLs, custom ports, file/data/gopher and redirect downgrade |
| Open redirects / chains | 3xx never followed | Reject all redirect responses, regardless of Location or whether the new URL appears safe; no retry through Location |
| TLS identity bypass | Certificate validation true, original hostname SNI and explicit identity check | Real handshake tests for wrong host, untrusted/expired chains; no insecure environment flags, custom production CA override or TLS downgrade fallback |
| Proxy environment routing | No supplied proxy agent; fresh direct agent in inspected runtime | Dedicated private direct connector/agent; hostile proxy environment and global-agent tests on supported Node versions |
| Pool reuse to an obsolete destination | `agent:false` avoids shared pool | Keep fresh sockets, no session/connection sharing between endpoint checks and no generic client fallback |
| Oversize/compression/parser abuse | Byte/header/depth/node limits and identity-only input | Keep limits; verify chunked bodies, compressed variants, malformed framing/UTF-8, abort cleanup and exact boundaries |
| Slow DNS/TLS/headers/body; concurrency | 8s deadline, three fetch slots and cross-process DB coordination | Preserve budgets; prove socket destruction and capacity release, add bounded manual-action rate limiting using existing library |
| Public-address targets serving harmful content | TLS/public IP cannot establish provider intent or GET safety | Individually reviewed providers/path families, no attacker-controlled hosting wildcard; treat every response as untrusted |

No current path that bypasses the exact two-URL gate was established by this review. The identified gaps are reasons not to remove that gate, rather than proof of complete arbitrary-URL SSRF protection. In particular:

- The current IP predicate is conservative but has no versioned registry provenance. Its broad **192.0.0.0/16** refusal blocks more than just 192.0.0.0/24; preserve existing refusals initially rather than accidentally broadening access while refactoring.
- No explicit socket `remoteAddress`/`remotePort` assertion is present. Checking a peer after TCP connect cannot undo that connect; literal dialing is the pre-connect control, and peer assertions are additional enforcement/diagnostics.
- Runtime proxy/agent behavior is not comprehensively tested. On the inspected Node build, internal client code creates a new default-agent constructor for `agent:false`, without inheriting global proxy options. This source observation is not a stable cross-version guarantee. Node documents opt-in environment proxy support for global/custom agents. [Node HTTP proxy behavior](https://nodejs.org/docs/latest-v24.x/api/http.html#built-in-proxy-support).
- Global concurrency is not tenant fairness or a comprehensive outbound request-rate limit. Public APIs can still receive abusive repeated GETs; a single account can occupy the three slots. Network operations also hold bounded DB transactions.

## Proposed destination contract

### URL and provider catalog

The backend parses once and produces an immutable `ValidatedTarget` containing canonical URL, ASCII hostname, path and fixed port. The transport accepts this structure internally, never caller-supplied connection options. Maintain one authoritative backend catalog of exact hostname plus explicit reviewed paths/path families; expose its public descriptions/presets to the authenticated UI through a small read-only capabilities route. No runtime/user-editable host additions, suffix matching or wildcard subdomains.

Build the outgoing path from the matched catalog template and narrowly validated parameters, not from a second parser or an unchecked raw path. Initially parameterized routes should accept bounded integer IDs or short ASCII slugs; arbitrary encoded path segments need separate review. Source-controlled path matching must be bounded and avoid user-defined regular expressions. An exact provider hostname alone does not authorize every path on that provider.

Reject input over 2,048 characters; raw C0/C1 controls, whitespace/backslashes, encoded controls, userinfo, query delimiters (even empty query), fragments (even empty), ambiguous authority, IP literals, zone IDs and non-443 ports. Host labels must use bounded ASCII LDH syntax, valid label lengths and no local/reserved namespace. Lowercase hostname and normalize optional :443; keep path case. Reject encoded separators/backslashes, traversal ambiguity and double-encoding tricks in newly accepted path families. Define accepted path spellings explicitly rather than decoding repeatedly. Existing stored canonical URLs remain valid; normalization never rewrites existing rows.

No query strings in the first expansion, including pagination and apparently harmless filters. This is deliberately narrower than detecting only sensitive query tokens: aliases, encodings and unnamed bearer values make such detection unreliable. Later safe query support would need an explicit per-provider key/value schema and separate approval. No custom headers, bodies, credentials, signed URLs or client certificates. Arbitrary path secrets cannot be recognized reliably: only cataloged public paths are supported, and URLs must not be logged or echoed in rejection messages.

Registration approves syntax/catalog membership and stores the canonical URL, without DNS/HTTP side effects or a claim of reachability. DNS/IP authorization happens immediately before each actual check. The UI must distinguish registered, never checked, policy blocked and actual monitoring outcomes. Registration-time DNS validation would not replace per-check validation and is not needed for this first curated version.

### DNS, address classification and IPv6

Use the existing cancellable A resolver, bounded by the same fetch deadline. Validate every returned A value with `net.isIPv4` and a small auditable unsigned-IPv4 CIDR matcher; reject empty, malformed or more than 64 answers. Deduplicate and sort eligible addresses deterministically; dial exactly one. Do not retry alternate addresses, reuse a previous good address after DNS failure, or fall back to OS lookup/AAAA.

Check in a dated table that conservatively excludes **all IANA IPv4 special-purpose ranges**, multicast/reserved blocks, all existing exclusions and selected documented cloud control addresses. This deliberately rejects some special-purpose entries marked globally reachable. Do not download policy at runtime, interpret a missing/unknown classification as permission, or claim that an IANA flag proves local routing safety. Review table changes on runtime/dependency updates and before any public deployment. [IANA registry and routability caveat](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml).

A CNAME alias is not a new allowed URL, nor a redirect: final A addresses still require classification, and TLS/Host use the original catalog hostname. CDNs need not have their alias names added to the URL catalog. `resolve4` does not provide a complete auditable alias chain; do not claim chain-by-chain validation or DNSSEC. A separate CNAME probe can race and must never authorize a later resolution. Alias failures/loops and overlong resolution operations fail closed under DNS/deadline bounds. Tests must demonstrate final prohibited destinations cannot reach the connector.

**IPv6 is not safely supported by the existing classifier/transport.** Continue to reject all literals and dial IPv4 only, including for dual-stack names. AAAA-only APIs are unsupported. A safe A answer plus unsafe AAAA cannot trigger IPv6 traffic because no AAAA dialing path exists; this is an exclusion, not IPv6 classification. Future IPv6 support would need an IPv6/CIDR parser, mapped/translation/tunnel/range policy, zone restrictions, peer normalization and equivalent socket tests under separate review.

### Connection, TLS and response enforcement

Retain fixed GET, IPv4 literal port 443, original hostname SNI/Host and Node's trusted-chain/hostname verification. Use a private direct, non-pooling HTTPS agent with no proxy configuration and a small pinned-connection helper. Its asynchronous connection callback must not release a socket to HTTP until the literal TCP peer and port match the approved candidate and TLS authorization/hostname verification succeed. Do not return an early synchronous socket that bypasses this gate. Use standard Node net/TLS APIs rather than implementing certificate cryptography. Disable session caching for this one-shot agent, destroy the agent/socket after each attempt and test every cancellation/error path. [TLS identity checking](https://nodejs.org/docs/latest-v24.x/api/tls.html#tlscheckserveridentityhostname-cert).

Never inherit a process-global agent/dispatcher, proxy URL, socketPath, custom lookup, client certificate, redirect policy or caller request options. A private connector must not use HTTP CONNECT or a proxy to resolve the hostname elsewhere. Add startup diagnostics for unsupported/insecure runtime settings without printing environment values or credentials; explicitly reject `NODE_TLS_REJECT_UNAUTHORIZED=0` for monitoring processes. Do not change global networking or mutate unrelated Mailpit behavior. Supported Node versions and proxy-env flag behavior need tests before declaring compatibility; an unsupported runtime fails closed for expanded monitoring.

A post-connect peer check cannot detect transparent routing/NAT masquerading behind a public destination or undo earlier network contact. Deployment egress policy remains necessary for stronger guarantees. TLS does not make an IP safe: certificate validity never overrides IP classification.

Preserve 8s total DNS/network/body deadline, 3s DNS query timeout, three global check slots, 128 KiB body, 16 KiB headers, JSON depth 50 and 5,000 nodes. Reject compressed responses rather than decompressing them; require UTF-8 and JSON media types. Reject non-2xx, protocol upgrades and redirects; never fetch response links. Keep Node's strict HTTP parser, no lenient parsing. Destroy requests/responses on rejection, deadline and external cancellation, including header floods, partial bodies and premature close. Payload limits bound synchronous work; do not describe an event-loop timer as a hard CPU deadline.

Use the existing rate-limit dependency for conservative authenticated local manual-check/baseline burst limits (proposed 12 combined attempts/minute/user) and registration limits (6/minute/user). Include rejected/admitted attempts consistently, return 429 without fabricated checks and retain the DB-backed three-slot gate for API/worker coordination. These per-process limits are not distributed fairness; a public product needs shared tenant/provider quotas and egress rate control. Do not add Redis for this local increment.

## Architecture comparison

| Approach | Security boundary | Complexity / cost | Windows development | Deployment and maintenance |
| --- | --- | --- | --- | --- |
| **A: extend pinned fetcher, arbitrary domains** | Application validates addresses and pins transport; arbitrary DNS/content remains attacker-controlled; no network isolation | Lowest infrastructure cost but significant hostile-input/abuse testing | Native Node; no Docker required | Needs runtime/IP-policy maintenance, provider fairness and separate egress review; insufficient alone for a strong public arbitrary-domain guarantee |
| **B: controlled proxy or isolated fetch process/service** | Can deny private/cloud/internal routes at the network layer as well as in code, and isolate DB/session secrets | Highest operational cost: extra process/network policy, authenticated narrow interface, deployment and failure handling | A bare Windows proxy does not create isolation; VM/WSL/container or controlled remote test infrastructure adds setup | Best long-term arbitrary-domain option only if direct bypass is impossible, proxy re-resolves safely or accepts validated literal destinations, TLS identity is preserved, and egress rules are independently tested |
| **C: reviewed hostnames/path catalog plus A hardening** | Small reviewed destination surface plus per-attempt IP validation/pinning; compromise of a listed provider still matters | Lowest defensible initial scope; adds catalog review rather than infrastructure | Reuses current native Node stack | Recommended first increment; retain fail-closed checks and consider egress firewall defense in depth; no claim of production readiness |

A generic forward proxy is not an SSRF fix. If it resolves unchecked hostnames, permits private CONNECT targets or can be bypassed by direct sockets, it moves the vulnerability. A future isolated fetcher must receive no database/session/SMTP credentials, accept only narrow jobs, use authenticated local/internal coordination and return bounded sanitized results; the current trusted service remains responsible for ownership and transactional persistence.

## Phase 7A.2 implementation sequence (not authorized by this document)

1. Approve the curated-first scope, exact provider/path entries, IPv4-only/no-query limitations and controlled fixture infrastructure. Record provider consent/terms/rate limits and why each permitted GET path is appropriate; GET syntax alone does not establish lack of side effects. Keep current URLs enabled throughout.
2. Add policy types, conservative address table and pure normalization/classification tests **while retaining the existing exact two-URL gate**. No production catalog entry is added yet. Avoid unnecessary dependencies; an auditable IPv4-only matcher is small. Do not invent an IPv6 parser.
3. Extract the bounded DNS and pinned-connection functions behind internal typed dependencies. Add actual socket/TLS and proxy-environment tests before integrating them. Keep no public resolver/connector/test-mode switches; test injection must not be configurable through HTTP/environment in the running application.
4. Integrate hardened transport under the unchanged destination gate. Run the existing regressions, isolated-database transaction/ownership suites and controlled transport tests. A security test failure blocks expansion; do not relax assertions or trust arbitrary CAs to make it pass.
5. Add the small reviewed catalog only after transport gates pass. Expose authenticated read-only capabilities via the existing local router, and replace the frontend's duplicated exact-URL rule with syntax feedback plus server-authoritative catalog errors. Do not promise frontend DNS verification.
6. Add safe rejection reasons, bounded manual-action rate limits and regressions across manual/baseline/scheduled calls. Keep existing persisted outcome enums; destination policy rejection during a stored endpoint check is `network_error/unknown`, with no fabricated status. Bad registration returns 400 and creates no endpoint/check. Continue recording actual attempts atomically and do not label policy blocks as upstream HTTP outages.
7. Verify the controlled live DNS/TLS scenarios, then the authenticated dashboard/worker/notification workflow with suite-owned endpoints in isolated tests. Existing dev history is not a fixture. Any approved dev demonstration must be explicitly opt-in and leave its schedules/preferences disabled; it must not edit old baselines or create synthetic production-looking checks.
8. Run final tests/typechecks/build/Prisma validation and read-only preservation checks. Document exact passing/failing/skipped counts and any missing live evidence. No public deployment or unrestricted URL mode is part of this approval. A failed security case or unavailable mandatory fixture blocks release of expanded destinations, not silent fallback to a weaker client.

Policy removal is a runtime change: revalidate on every check, never grandfather a stored URL into outbound access, never silently rewrite/delete its row, disable its schedule, erase history or accept a baseline. A stored endpoint rejected by a tightened catalog retains its data and records safe policy failures under existing incident rules; deliberate preference/schedule changes remain user decisions. Reverting to the previous catalog is a code rollback, not a database rollback.

Detailed rejection codes are API-only for input/catalog errors; if an immediate check response adds a transient `policyRejection` field, it must be a fixed safe enum with matching frontend types. A historical `network_error/unknown` alone cannot establish that DNS was blocked: after reload display an unknown network/check failure rather than inventing its cause. Existing availability incidents describe failed checks, including local-policy failures, not proof of an upstream outage. Preserve deduplication and use truthful check-failure wording in notifications; richer persisted diagnostics would require a separately reviewed schema decision rather than silently changing an applied enum.

## Automated security test matrix

Existing coverage below refers to the inspected tests, mostly mock-transport assertions. Every planned case is a Phase 7A.2 requirement, **not an implementation claim**. Negative destination tests assert resolver/connector call counts and no outbound HTTP bytes, not just an error message.

| Area / cases | Required observable assertion | Existing evidence / planned gap |
| --- | --- | --- |
| Existing two URLs, explicit :443, hostname case | Same canonical URL; baseline/history unaffected | Existing policy/unit/regression coverage; retain |
| Approved new catalog path versus unknown host/subdomain/path | Only approved canonical target can reach DNS; no wildcard/suffix bypass | Planned |
| 127/8, RFC1918, 0/8, CGN, link-local, multicast, reserved, documentation/benchmark ranges | For each CIDR: start/end and neighboring values; unsafe result means zero connector calls | Many representative cases exist; exhaustive boundaries/provenance planned |
| 169.254.169.254, 100.100.100.200, 168.63.129.16 and metadata names | Static URL refusal or unsafe DNS refusal before any TCP attempt | Representative existing tests; expand names/boundaries |
| ::1, ::, fc00/7, fe80/10, ff00/8, documentation IPv6, mapped public/private IPv4, scoped IPv6 | Every IPv6 form rejected; no resolve6/IPv6 connector | Representative rejection tests; complete family tests planned |
| Integer/hex/octal/short IPv4, leading zeros, encoded host delimiters | Rejected before DNS; WHATWG normalization cannot turn user input into an unreviewed address | Some existing inputs; expand |
| Unicode and xn-- hosts, percent-encoded authority, trailing dot, underscores, label bounds | Reject with stable safe reason; catalog comparison cannot be bypassed | Planned |
| Userinfo, raw/encoded controls, whitespace/backslash, fragments, empty delimiters, all query forms | No request or raw secret echo/log; server authoritative even if UI bypassed | Common cases exist; normalization/property corpus planned |
| HTTP, alternate schemes, 80/444/8443/zero/invalid ports, scheme-relative URL | No DNS/connection; only 443 on accepted targets | Existing partial coverage; expand |
| Rebinding: first query public, next query private | First attempt connects once to selected public IP; next attempt makes zero connections | Existing mock asserts one resolution per attempt; socket-level proof planned |
| DNS switches after validation but before connect | Socket sees the original selected literal; changed DNS target sees no connection; lookup fallback is never called | Mock request-options proof exists; controlled DNS/socket test planned |
| Mixed A set in every ordering, duplicates, malformed/empty/>64 answers | Any unsafe element rejects all; deterministic one-IP selection; bounded work | Mixed/empty cases exist; cardinality and order/property tests planned |
| CNAME public chain, private final A, loop, inconsistent subsequent answer | Only classified terminal A can be dialed, original Host/SNI retained; failure cannot reuse previous IP | Planned controlled DNS tests |
| Dual-stack safe A/unsafe AAAA; AAAA only | IPv4-only behavior proven; no hidden IPv6 fallback or claim AAAA was classified | Planned |
| DNS NXDOMAIN, SERVFAIL, timeout, cancelled resolver | Safe error, no socket, slot released; overall deadline wins over per-server delays | Existing mocks; real resolver fixture planned |
| Actual peer pinning | Spy on net/TLS connector and assert socket.remoteAddress/remotePort, family, one selected address and no second lookup | Current test inspects https.request options only; mandatory new integration evidence |
| Peer mismatch, mapped/malformed peer, unexpected remote port | Connection destroyed; HTTP request bytes never released; no fallback | Planned at connector unit boundary; never dial prohibited real IPs to test it |
| Correct cert, wrong hostname, expired/self-signed/untrusted cert, TLS hang | Only authorized original-host handshake yields JSON; no insecure retry | Callback/error mocks exist; real handshake coverage planned |
| Host/SNI, cookies/authorization/proxy header injection, client credentials | Exact fixed headers; original hostname identity; no attacker-owned option passthrough | Fixed-header/SNI mocks exist; raw TLS fixture observations planned |
| Upper/lowercase proxy variables, ALL_PROXY, NO_PROXY, NODE_USE_ENV_PROXY / Node flags, replaced global agent | Canary proxy sees zero connections/CONNECT; controlled origin sees the pinned direct peer; no leaked credentials | Runtime source reviewed; behavioral child-process tests planned |
| Fresh connection per check, changed DNS, keep-alive offered by server | Second check uses a new socket and new classification; no previous-IP/session fallback | agent:false mocked today; real connection counters planned |
| 300–399 including relative Location, HTTP/private/metadata Location and loops | One request only, status retained, every redirect sink sees zero requests | 301/302/307/308 mocks exist; expand status/capture tests |
| 404/500, early close, malformed framing, duplicate/invalid lengths, upgrade/CONNECT response | No successful JSON outcome; bounded cleanup and no second protocol path | Partial HTTP/error tests; raw fixture cases planned |
| JSON null/primitives/arrays and application/*+json | Correct existing schema/value behavior; status/latency accurate | Existing coverage; retain |
| HTML, missing/wrong media type, invalid UTF-8/JSON, non-finite number | Safe invalid_json, no body/headers persisted/logged | Existing coverage; retain |
| gzip/br/deflate, oversized declared length and chunked size, exact byte/header boundaries | No decompression; streamed count and max-header enforcement; stream destroyed | Existing gzip/body tests; full variants/header proof planned |
| Slow DNS/connect/TLS/headers/body, byte trickle, external abort | Absolute 8s budget, sockets/timers/resolver cleaned up and slots reusable | Existing HTTP/body/cancellation mocks; full stages planned |
| Deep JSON, many nodes, large key/path, malicious JSON property names | Bounded inference, no prototype mutation, escaped UI, safe template limits | Existing depth/node/schema/template cases; hostile end-to-end corpus planned |
| Manual/baseline/scheduled overlap, multiple worker/API processes | Shared endpoint/global locks still hold; max three admitted checks; rejection creates no fake result | Existing PostgreSQL suites; rerun only after implementation approval |
| Per-user rate limits and sustained failures | 429 at configured boundary, no unbounded queue, no bypass by baseline route | Planned; retain existing authentication limits |
| Missing session, cross-user/legacy ID, forged CSRF, hostile Host/Origin/forwarding | No policy capability or monitoring action bypass; no secret/IP leak | Existing management/auth/ownership tests; add capabilities route assertions |
| Incident dedup, policy refusal, recovery, explicit baseline, notification disable | Same atomic persistence and dedup; no baseline autoaccept, historical replay or external email | Existing notification tests; extend policy-refusal scenario |

### Controlled live test infrastructure

Use an explicitly owned public DNS zone with a small TLS JSON fixture on **public IPv4 port 443**. It must support recording connection identity/Host/SNI and bounded responses for valid JSON, redirects, trickles, excessive headers, compression and premature close. Restrict fixture control endpoints to the test operator, not the monitored unauthenticated data route. No resource is provisioned or contacted by this review.

Use a test-owned DNS server/authoritative records for public-to-public rebinding and CNAME behavior, with one approved public server as a canary for unintended second resolution. For private/cloud-address cases, inject resolver answers and prove the real connector is never called; do not contact actual metadata, a developer's LAN or an internal service. A redirect to an unsafe literal may be returned as inert Location text; receiving that string is not permission to fetch it.

Offline socket/TLS tests can use a local server at the **connector test boundary**, with explicitly injected test sockets and ephemeral test CA material trusted only by that test process. Those tests do not prove the production destination policy permits localhost; it must still refuse it. Do not add a production private-network switch, change the system trust store, or set NODE_TLS_REJECT_UNAUTHORIZED=0. A valid public fixture with normal certificate trust is required separately to prove the production route end to end. Missing fixtures must be reported as incomplete, not reclassified as passing security tests.

Windows unit/connector tests should run natively under Node without requiring Docker, admin firewall edits or global DNS/hosts-file changes. Run proxy-env scenarios in fresh child processes because Node startup flags/global agents are process-scoped. Collect selected destination, observed peer and canary connection counts in test-only artifacts, never credentials, full production bodies or sensitive URL values.

## Product compatibility and data safety

**No database migration is required.** Endpoint.url already supports canonical strings up to 2,048 characters; owner IDs, JSON baselines, checks, schedules and notification/outbox records need no structural changes. Existing outcome/error enums suffice for policy failures; structured rejection reasons can be API-only. Do not add an enum merely for nicer frontend copy. A later requirement for persisted policy provenance or distributed quotas would need separate migration review.

The catalog is versioned code/configuration, not a new endpoint ownership mechanism. Keep per-attempt validation in the shared fetcher so manual checks, fresh baseline acceptance and the independent worker cannot diverge. Never mutate legacy ownership or existing URL/baseline/history records. Preserve the endpoint/global transaction locks and atomic check/incident/outbox boundary. Preserve every session/CSRF/local guard, exact body allowlists and Mailpit-only recipient/SMTP restrictions. The outbound hostname catalog does not alter inbound Origin/Host allowlists.

New returned JSON is still transient; store schema and safe metadata only. Reject URLs containing apparent credentials before persistence, but acknowledge that arbitrary paths and JSON field names can carry sensitive strings. Do not render raw HTML, automatically open URLs, or fetch schema links. Monitoring success proves only that one authorized attempt received bounded valid JSON, not API trust, universal schema compatibility or lack of GET side effects.

## Proposed Add Endpoint experience

Keep the current modal, name/monospace HTTPS input, compact preset buttons and existing keyboard/focus behavior. Replace the duplicated frontend two-URL rule with lightweight syntax checks and authenticated server catalog/capability data. Show “Supported providers” and their approved paths rather than implying any HTTPS address is supported. An unavailable catalog disables registration with a retry control; it never falls back to arbitrary URLs. Preserve working server validation for clients that bypass the UI.

Use short messages without echoing URL secrets or resolved/private IPs:

| API reason (proposed, no schema change) | Message |
| --- | --- |
| invalid_url / https_required | Enter a complete HTTPS URL on port 443. |
| credentials_not_supported | URLs containing credentials are not supported. |
| query_not_supported / fragment_not_supported | Remove query strings and fragments. Only public, unauthenticated endpoints are supported. |
| host_not_supported / path_not_supported | This provider or path is not supported. Choose a listed public endpoint. |
| destination_blocked | This destination is not eligible for public monitoring. |
| dns_failure | The hostname could not be resolved safely. Try again later. |
| unsupported_address_family | This endpoint requires IPv6, which is not supported yet. |

Only use the IPv6-specific message if the backend actually has evidence of that condition; an empty A result alone is not proof of an AAAA-only host. Never call registration a successful check. Continue the current real loading/error/never-checked states, explicit baseline confirmation and no fabricated metrics.

## Review verification actually executed

- `npm exec -w @watchtower/api -- vitest run --exclude '**/*.integration.test.ts'`: **258 passed, 0 failed, 0 skipped**, 12 files. This deliberately excludes four database suites (39 tests) and the Mailpit test (1), rather than invoking fixture writes/SMTP during a design-only review.
- `npm run test:web`: **56 passed, 0 failed, 0 skipped**, five files. Total executed tests: **314**; no expanded-network tests were implemented or claimed.
- `npm run typecheck`: passed for both workspaces. `npm run db:validate`: passed; this validates the schema without applying it.
- Existing read-only preservation script: both exact local database identities, all four migration names/checksums and all original per-row hashes verified. Development remains at **27 endpoints / 64 checks**, original baseline of 17 / 38 preserved; zero enabled schedules/preferences. Test tables remain empty. No database integration tests, SMTP, workers or browser demonstrations were run in this review.
- `git diff --check`: run after writing this plan. No runtime source/configuration, dependency, allowlist or applied migration file was edited. The pre-existing unusual untracked file was left untouched.

## Expected implementation files (proposal only)

| File / area | Expected future change |
| --- | --- |
| `apps/api/src/monitoring/url-policy.ts` | Canonical target type, strict URL/catalog policy; keep current entries until security gates pass |
| New `public-ipv4-policy.ts` / `public-api-catalog.ts` in that directory | Auditable CIDR table and reviewed exact hostname/path catalog with provenance |
| `safe-json-fetcher.ts`; new `pinned-https-connection.ts` | Bounded resolver integration, private direct connector, peer/TLS gate and cleanup |
| `monitoring-service.ts` | Shared validation and consistent safe policy-failure behavior, without persistence redesign |
| `management-routes.ts` | Authenticated capabilities route, safe input error codes and manual-action rate limiting; preserve all guards |
| `apps/web/src/api/client.ts`, `api/types.ts`, `components/AddEndpoint.tsx`, setup copy in `App.tsx` | Server catalog and concise field errors/presets; no unrelated redesign |
| Fetcher/service/management/security tests; new URL/IP/connector/DNS/proxy test files and fixture harness | Matrix above, including real address-contact assertions |
| Existing ownership/database/scheduling/notification tests and browser workflows | Compatibility and isolation regressions, using suite-owned records |
| `README.md`, monitoring/security docs, possibly package engines/scripts | Document restrictions and controlled test commands; runtime support narrowed only after validation |
| Prisma schema/migrations | **No change expected** |

Only this document is created in Phase 7A.1. Implementation approval is still required for every proposed code/catalog change. Deployment remains local-only; unrestricted destinations, isolated egress deployment, external email and any subsequent product phase are outside this review.

## Phase 7A.2A implementation status (2026-10-26)

This section records the fetcher hardening completed after the architecture review. **The URL allowlist has not changed:** only the two exact JSONPlaceholder `/todos/1` and `/posts/1` URLs remain accepted. This is not approval for arbitrary public destinations.

### Completed protections

- `url-policy.ts` retains HTTPS, port 443, no credentials, no query, no fragment and exact-URL checks. It rejects IPv6 and mapped IPv6 as dialable addresses. IPv4 classification now uses explicit subnets rather than broad second-octet checks. It blocks 0/8, RFC1918, loopback, CGNAT, link-local, multicast, limited broadcast, benchmarking, documentation, deprecated 6to4 relay, the Azure platform virtual IP, and reserved 240/4. Within 192.0.0.0/24 it permits only the IANA globally reachable 192.0.0.9/32 and .10/32 exceptions; the table is intentionally conservative elsewhere. See the [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml) for the currently registered classifications. This list requires maintenance as allocations change.
- DNS A results are capped at 64, every returned result is validated, and any unsafe/malformed/mixed result fails closed. The eligible set is deduplicated and the selected IPv4 is deterministic. DNS is rerun for each check; no cached validation authorizes future requests.
- A new `pinned-https-agent.ts` creates a private, non-pooling HTTPS agent. It calls `net.connect` with the selected literal IPv4, family 4 and port 443; it does not use a hostname lookup or proxy. Before TLS starts, it checks the connected socket's `remoteAddress` and `remotePort` against that selection. It then wraps that socket with TLS using the original hostname for SNI and certificate identity verification, with `rejectUnauthorized: true`. The request is returned to Node's HTTP client only after TLS authorization. Failure, abort and timeout destroy the sockets. The agent has no keep-alive or cached TLS sessions and is destroyed after the response.
- Redirects remain errors and are not followed. Requests stay GET-only, send fixed non-secret headers, request identity encoding, reject compressed responses, cap headers at 16 KiB and body at 128 KiB, and enforce the existing absolute 8-second budget across DNS, connection and body streaming. JSON UTF-8, depth and node limits remain in force. Errors returned to callers remain categorized without raw exception messages or response bodies.

### Test evidence and limits

The connector tests inject socket/TLS constructors. They assert the literal selected address passed to `net.connect`, the peer address and port that the connector observes, that a different peer is rejected before TLS, and that TLS uses the original hostname with certificate verification enabled. These are deterministic transport-boundary tests; they do not open attack connections to local/private services. Resolver tests cover mixed unsafe answers, empty/failing answers, ordering, and no second resolver call. Other tests cover redirect handling, certificate hostname mismatch behavior, unauthorized TLS, timeouts/abort, body limits, content type, invalid JSON, concurrency and proxy-independent direct connection options.

Socket pinning and application address checks do **not** create an isolated network egress boundary. A VPN, transparent proxy, host route, compromised resolver/runtime, or an internal route to an otherwise globally assigned address can still affect reachability. This stage does not inspect CNAME records as a separate graph: `resolve4` returns A answers after DNS alias processing and every returned A address is checked, but the code does not log or validate each CNAME hop. It does not request AAAA; IPv6 is unsupported. It cannot infer subnet-specific directed broadcast addresses from an IPv4 address without the active route prefix. No live public TLS fixture was provisioned as part of this hardening; tests use controlled mocks. A future production deployment still needs an egress firewall/proxy boundary, constrained DNS/network routes, operational rate limits and security review.

### Proposed Phase 7A.2B candidates — approval required

These are proposals only and have **not** been added to the catalog or accepted by the backend. Both use the current provider hostname, so Phase 7A.2B would add reviewed exact paths without permitting user-selected hosts or wildcards.

| Exact candidate URL | Provider and expected JSON | Auth/query | Redirect and reliability notes |
| --- | --- | --- | --- |
| `https://jsonplaceholder.typicode.com/users/1` | JSONPlaceholder by typicode; one user object, with fields such as `id`, `name`, `username`, `email`, address, phone, website and company. The provider lists users as a supported resource. | No API key/account documented; no query string required. | No redirect is required by the documented route; our checker would still reject any 3xx. The provider describes itself as a free fake API, not a contracted SLA. It publishes a high volume of requests but no numeric per-client limit or uptime guarantee; keep schedule opt-in and monitor provider policy. |
| `https://jsonplaceholder.typicode.com/posts/1/comments` | JSONPlaceholder by typicode; an array of comment objects with `postId`, `id`, `name`, `email` and `body`, shown in its guide. | No API key/account documented; no query string required. | Same no-redirect enforcement and service reliability caveats. Arrays make this useful for exercising structural inference, but one response is only a sample and does not establish a universal schema. |

JSONPlaceholder documents its mock service, supported resource types, sample JSON, and nested `/posts/1/comments` route in its [official guide](https://jsonplaceholder.typicode.com/?locale=en_us). Its home page describes the service as free fake data, with no signup or API key, and does not state an SLA or numeric rate limit. That absence should not be interpreted as unlimited capacity. If approved, requests remain HTTPS GET only on port 443, exact path only, no query/fragment, no redirects, fixed request headers, existing body/time/concurrency limits, per-check IPv4 validation and pinned TLS transport. Keep the 5-minute scheduler opt-in; avoid any promise of provider availability.

### Database and compatibility status

No Prisma schema, migration, ownership, endpoint, baseline, history, schedule, incident or notification record was changed for Phase 7A.2A. The fetcher is shared by manual and scheduled checks, so monitoring persistence, baseline handling, locks, ownership, CSRF, localhost management guards, incident deduplication and Mailpit-only notification behavior remain in their existing code paths. No database reset, migration or historical rewrite was performed.

### Verification actually run

- Fetcher and pinned-connector tests: **98 passed** in 2 files.
- Full `npm test`: API **327 passed, 1 skipped** (18 files); web **56 passed** (5 files). Combined: **383 passed, 1 skipped**. The skipped API test requires Mailpit opt-in.
- `npm run test:db`: **39 passed** across the existing database integration suites.
- `npm run typecheck`, `npm run build`, `npm run db:validate`, and `git diff --check`: passed.
- A live, read-only HTTPS check through the new connector to the existing allowlisted `https://jsonplaceholder.typicode.com/todos/1` returned HTTP 200 and bounded valid JSON. It used the normal system certificate chain and hostname verification.
- `npm run test:e2e`: **4 skipped**. The browser tests are guarded behind explicit `WATCHTOWER_LIVE_E2E=true` (and notification tests also require Mailpit opt-in); the complete local API/UI/worker/dispatcher stack was not started for this fetcher-only phase.

The integration tests used the isolated test database. No development database reset, migration, or historical rewrite was run. `git diff --check` reported only Git's LF-to-CRLF normalization notices for edited files, not whitespace errors. The pre-existing unusual untracked filename noted in the project status was left untouched.

Phase 7A.2B requires explicit approval of the two exact candidate paths above before implementation. No other hostname, path, query, arbitrary destination, network proxy, deployment or product phase is approved by this document.
