# Client data integration v1

This checkpoint prepares Claude's mobile UI and the existing Honeybee backend
to work through a shared read contract. It does not activate a live connection.
The app still constructs its existing Supabase repositories. No screens, source
records, authentication settings, migrations, or provider connections change.

## Working together

Keep one UI branch and one integration branch in this repository. Merge small
reviewed integration changes into the UI branch as they stabilize. The backend
can remain a separately deployed service; merging two complete applications or
copying both sets of database migrations is unnecessary.

| Area                                       | Owner and integration point                           |
| ------------------------------------------ | ----------------------------------------------------- |
| Screens, navigation, native auth lifecycle | Claude; retain existing screen and loader interfaces  |
| Read contract, adapters, source projection | Codex; `src/data/client-data/`                        |
| QBO OAuth, token refresh, sync workers     | Existing backend; server only                         |
| Scope bindings and pilot activation        | Kody-approved records and tested server authorization |

The shared version is `hive.client-data.v1`. Existing Requests screens already
accept the adapter's `RequestsLoader` shape. `AppServices` now uses loader
interfaces while preserving its existing production construction.

## Implemented in this branch

| Operation         | Result                                               | Source behavior                                                                        |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `requests.list`   | Request summaries and newest requested date          | Maps supported legacy requests after explicit scope and presentation approval; max 200 |
| `requests.get`    | One request detail or null                           | Filters by source entity and request ID; missing, draft and foreign records share null |
| `connections.qbo` | QBO state, provider environment, last sync timestamp | Projects existing status response; excludes credentials and company identifiers        |

`contract.ts` is portable TypeScript. `validation.ts` validates exact fields,
versions, enum values, dates, IDs, list sizes, and all four scope identifiers.
An unavailable source produces an error state, never a fabricated empty result.
A genuine empty list is `{items: [], recordedThrough: null}`. Lists over the
window return unavailable until a versioned pagination contract is introduced.

`adapter.ts` implements `RequestsLoader` and `getQboConnection(scope)`. Its
transport and current access accessor are injected. It registers with the same
`ScopedRegistry` as the auth controller, aborts reads on clearing, and rejects
late responses even if a transport ignores cancellation. It stores no data or
tokens across calls. `transport.ts` performs authenticated JSON reads to one
explicit HTTPS endpoint and acquires the session token for each call.

`server.ts` implements the request/status projection service. Its authorization
and source ports must be supplied by the deployment. Those ports are interfaces,
not an implemented authentication system. Test doubles occur only in tests.
The public wire contract does not expose source project IDs, QBO realm IDs,
private audit events, bank account numbers, document content, or provider tokens.

## Resolve schema differences explicitly

The mobile scope is environment + client + legal entity + membership. The older
backend is scoped by entity and uses different roles. A server-owned binding
must map the complete mobile scope to a fixed source project, source entity and
QBO provider environment. Never identify an entity by its display name, assume
client ID equals entity ID, or treat `approver` as QBO/release authority.

Application environment IDs and QBO `sandbox`/`production` are separate fields.
Every authorized read requires the existing backend's stricter AAL2 level,
including client users. The eventual UI activation must provide that MFA path.

The legacy request's `owner_user_id` is a person, not the mobile owner role.
Its `created_at` is not proof of issuance. Supply approved presentation records
with `ownerRole` and `requestedOn`; missing records remain unavailable. Convert
`due_at` in the entity timezone and preserve the target schema's
`requests_due_after_requested` constraint.

Legacy `open`, `answered`, and `closed` have exact mappings. Drafts are not
client-facing. `accepted`, `cancelled`, and `overdue` have no approved equivalent
in this version and make the requested surface unavailable. Financial review
states are never converted into case approval states. QBO connection health and
last sync time say nothing about reconciliation completion or review approval.

## Source retrieval beyond this checkpoint

| Source                   | Planned service responsibility                                                                          | Status                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| QBO                      | Per-entity OAuth connection, refresh, scheduled reads and provenance                                    | Existing backend remains separate; no live activation by this branch                            |
| Bank and credit accounts | Connector capability check, authorized feeds where available, statement retrieval and coverage tracking | Requires provider-specific adapters; credentials alone do not establish API or statement access |
| Permanent evidence       | Index Drive record references, source period, retrieval time and integrity metadata                     | Separate contract; no document bytes in this read API                                           |
| Financial review         | Released, nonsuperseded snapshots with period, basis, currency and source/review provenance             | Separate contract and existing release gates                                                    |
| Home cases and Activity  | Genuine workflow records and enumerated client-facing events                                            | Continue existing repositories; private audit logs are not an Activity feed                     |
| Senior Bookkeeper / MCP  | Narrow firm service identity calling the shared integration service with explicit client scope          | Separate authorization and tool facade; not a borrowed mobile login                             |

Use one client/source registry as additional clients are onboarded; do not add
client-specific conditionals to screens. Keep provider credentials in the server
credential store. Retrieval workers should record coverage and failures so
missing statements cannot be mistaken for completed reconciliation. Provider
reauthorization must be observable and recoverable. A permanently signed-in
browser is not a prerequisite or a guarantee of this architecture.

## Next implementation and activation steps

1. Implement current-session authorization and approved binding storage in the
   chosen backend. Verify issuer, signature, audience, expiry, live session,
   profile, membership, entitlement and AAL2. A missing binding may be reported
   only after successful authorization. No trust in user-editable metadata.
2. Implement scoped source ports under existing RLS or equivalently narrow
   reviewed routines, including revocation, byte/time limits and explicit
   request presentation metadata. Do not forward a JWT to a different Supabase
   project and assume it has authority there.
3. Expose a read-only JSON endpoint invoking `createClientDataService().read`.
   Require bearer authorization; validate bounded request bytes; map invalid /
   unauthorized / denied failures to 400 / 401 / 403; suppress raw errors; send
   `Cache-Control: no-store`; bound response bytes and disallow redirects.
4. Wire `createClientDataTransport` and `ClientDataAdapter` into `app-runtime.ts`
   using the existing controller and registry. Keep Dashboard and Activity on
   their existing sources until their contracts have genuine producers.
5. Prove the full route with synthetic accounts: wrong scope at every dimension,
   revoked membership, expired session, MFA, source failure, identity switching,
   and native iOS/Android cancellation and redirect behavior. Then run the
   authorized pilot before onboarding additional client bindings.

The endpoint, production ports, durable binding records and runtime switch are
deliberately absent from this checkpoint. Unit tests do not replace database
RLS tests, native-device evidence, live OAuth checks or release verification.

Native fetch can buffer a body before JavaScript checks its size; the server and
gateway therefore need real byte limits. Redirect prevention and session-cookie
behavior require native verification. React Native documents known networking
limitations in its [networking guide](https://reactnative.dev/docs/0.86/network).
Server authorization should retain the protections described in
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Reproduce the code checks

Checkpoint verification on 2026-09-06: 178 tests passed across eight suites
(119 integration tests plus 59 existing auth, tenancy and safe-error tests).
Strict TypeScript, scoped ESLint and new-module/document formatting passed.
Independent review found enum coercion and request ordering issues; both were
reproduced with failing tests and corrected before this checkpoint.
Native builds, database policy tests and live provider authorization were not
run for this dormant integration. Dependency installation retained the existing
lockfile and emitted upstream deprecation notices; this is not a full release
or dependency-audit gate.

Use the repository's exact Node 22.23.2 and npm 10.9.8 pins:

```sh
cd hive-app
npm ci
npm test -- --runInBand src/data/client-data
npm run typecheck
npx eslint src/data/client-data src/app-runtime.ts src/core/errors.ts --max-warnings 0
npx prettier --check src/data/client-data docs/integrations/client-data-v1.md
```

No new package dependencies or database migrations are introduced.
