# RUYIN workbench backend

This existing service serves RUYIN's browser workbench and its optional desktop
adapter. The registered listeners remain web 3060 and BFF 3061. Native support
does not create a new process, image, Compose overlay, database role or pool.
The only production entry is `src/main.ts`, in `platform_bff-workbench`.

```ts
import { AppModule, configureHttp } from "@vxture/bff-workbench";
```

## Surfaces and authentication

| Public origin            | Internal paths                                     | RP identity     | Accepted credentials                           |
| ------------------------ | -------------------------------------------------- | --------------- | ---------------------------------------------- |
| `https://ruyin.work`     | Existing `/auth/*`, `/api/*`                       | `workbench`     | Host-only browser cookie, browser-bound state  |
| `https://api.ruyin.work` | Approved paths map to `/desktop/*` on the same BFF | `ruyin-desktop` | Native approval/claim, then `X-Vxture-Session` |

The browser ingress rejects `/desktop` and `/desktop/*`. The API ingress exposes
only the approved native paths, removes browser cookies and preserves native
session headers. The desktop guard additionally checks its configured host.
There is no peer-BFF business request or source dependency. Accounts remains the
identity authority; Console owns organization administration, billing and orders.

Native PKCE, nonce, one-time claim, refresh, central revocation and original-scope
checks reuse the public `core-oidc-rp` package. Desktop and browser sessions use
separate client identifiers and Redis namespaces. Tokens and RP client secrets
stay on the server. The desktop client receives an opaque session only.

## Optional configuration

All private settings stay in the existing `.env.workbench-bff`:

| Setting                            | Meaning                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `WORKBENCH_DESKTOP_ENABLED`        | `0` by default; `1` explicitly enables native routes                                  |
| `RUYIN_BFF_BASE`                   | Confirmed public native origin `https://api.ruyin.work`                               |
| `RUYIN_DESKTOP_OIDC_CLIENT_SECRET` | Server-only secret for `ruyin-desktop`; must differ from browser `OIDC_CLIENT_SECRET` |
| `RUYIN_DESKTOP_SESSION_TTL`        | 300–86400 seconds, default 86400                                                      |

The browser's `OIDC_CLIENT_ID=workbench`, `OIDC_CLIENT_SECRET`, callback and
host-only cookie remain independent. Issuer/back-channel transport, the existing
Redis connection, primary read pool and reporting read pool are reused.
Desktop code is not given the inbox/activity write pools. Existing `/healthz`
readiness behavior stays unchanged; native `/desktop/healthz` reports the same
service identity and build provenance, without claiming dependencies are ready.

Disabled native routes return 404 and do not need native credentials. Enabling
the module requires valid independent settings. The deployment audit and ingress
preflight verify the registered workbench listener and IdP hash; no new port is
allocated. Browser-only deployments continue to use their existing configuration.

## Read models

Membership uses the existing `OrganizationService` and `ScopeService` with the
exact RP organization/workspace, never an arbitrary request scope or fallback.
Applications reuse `CatalogService` and `ProductSeatService` from the browser
workbench. An ordinary member does not need `tenant.billing.read` to list apps.

The native projection retains actual subscription IDs, primary and bundled
products, access (`allowed`/`denied`/`unknown`), catalog description, logo, version
and authoritative online address. It does not calculate entitlement or expose
plan management, price or order records. Missing subscription identity fails
explicitly rather than inventing an ID. Public icon bytes use the existing
shared subscription-domain query; MIME, size and validators stay bounded.

## Verification and activation

```powershell
pnpm --filter @vxture/bff-workbench type-check
pnpm --filter @vxture/bff-workbench lint
pnpm --filter @vxture/bff-workbench test
pnpm --filter @vxture/bff-workbench build
node --test deploy/guardrails/39-audit-env.test.mjs
```

`src/desktop/app.ts` is a test-only composition, not another production server.
HTTP tests use a disposable RSA issuer and Redis protocol fixture. Composition
tests resolve the real production graph, including disabled mode and connection
reuse. Surface tests run browser and desktop controllers on one HTTP listener
and reject cross-surface credentials and incorrect hosts.

The opt-in database tests use two explicit loopback URLs for an otherwise empty
`workbench_desktop_itest_*` database with the authoritative DDL already applied.
They use the existing `reporting_ro` role, not a new desktop role. No ambient
application credentials are used. The fixture deletes only its generated rows.

```powershell
$env:RUYIN_BFF_DB_ITEST = '1'
$env:RUYIN_DB_TEST_ADMIN_URL = 'postgresql://postgres@127.0.0.1:<test-port>/workbench_desktop_itest_example'
$env:RUYIN_DB_TEST_READ_URL = 'postgresql://reporting_ro@127.0.0.1:<test-port>/workbench_desktop_itest_example'
pnpm --filter @vxture/bff-workbench exec vitest run src/desktop/database-read.itest.spec.ts
```

Local implementation and isolated tests do not register the production client,
provision production secrets or deploy the service. Before activation, review
the exact native client registration, callbacks, changed workbench image and
ingress together. The targeted credential tool writes only the native key in
the workbench file and the matching IdP hash; it preserves the browser key.
Those operations still need their own explicit production authorization.

Use the current `deploy/database/seed/seed-catalog.mjs --ruyin-desktop-only`
entry for registration, not the legacy Prisma catalog entry or a full seed.
Unknown or extra CLI arguments are rejected before opening a database connection.
Bootstrap registration without a hash cannot authenticate. Provision the native
secret through the targeted 27 script, then persist only its hash with the same
targeted seed and verify both RP identities before enabling the adapter.

The 33 recreation preflight validates desktop settings only when its targets
include `workbench-bff`. A broken optional adapter must not block repairs of
unrelated platform services. Full-stack deployment and native ingress preparation
retain their complete preflight checks.

Rollback disables `WORKBENCH_DESKTOP_ENABLED` and removes the controlled API
ingress through the existing deployment process. Browser routes remain under
their original RP. Never silently fall back to Console or a standalone BFF.
