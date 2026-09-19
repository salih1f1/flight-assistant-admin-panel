# Deploying the admin panel to Azure

Design for issue #190.

## Why now

The panel runs only on a developer's machine. Everything it shows has to be verified by starting
Vite locally, which is why a run of recent features — the verification column, the loading
indicator, the lounges and loyalty grids — is recorded as merged but never seen in a browser. A
deployed panel pointed at the dev API turns that into opening a URL.

## Constraints that shaped this

Three facts about the existing environment did most of the deciding.

**The B1 plan is already paid for.** `ASP-flightassistantdev-88a9` in `flight-assistant-dev`
(westeurope, Linux, 1 worker) runs `flight-assistant-dev-api` and nothing else. Additional apps on
an App Service plan cost nothing, so hosting the panel there is €0 marginal against a €100/month
budget. Static file serving is negligible next to the API's background jobs.

**The CIAM tenant holds travelers.** `flightassistantextid` is the directory for the product's end
users: `RegisterTravelerCommand` is an idempotent upsert keyed on the sign-in token's `oid`, called
on every traveler login. So a gate that admits "anyone authenticated against the tenant" admits
every traveler who ever signed up. Authentication alone is not a lock here; the lock has to name
who is allowed.

**Static Web Apps cannot express that lock at €0.** Binding a Static Web App's gate to this tenant
requires a custom auth provider, which is Standard-plan only. On the Free plan the preconfigured
Entra provider accepts *any* Microsoft account, leaving invitation-assigned custom roles as the
only gate — a second, hand-maintained identity list beside the one the tenant already keeps. The
Free plan also has no IP restrictions. App Service has custom OIDC and IP restrictions for free,
and can gate on the tenant the project already uses.

## Architecture

```
request
  │
  ├─ App Service access restrictions ────── default Deny, allowlist of admin IPs
  │
  ├─ Easy Auth (separate container) ─────── requireAuthentication
  │                                          allowedPrincipals.identities = admin object IDs
  │
  ├─ server.js (Node, no dependencies) ──── dist/, SPA fallback, security headers
  │
  └─ browser: MSAL → access token → API ─── AdminOnly policy (unchanged)
```

Each layer blocks something the next one cannot: the network layer blocks the internet without
caring who holds an account, the identity layer blocks travelers and every other tenant account,
and the API's existing policy remains the only thing standing between a token and data. Layer three
is untouched by this work — `RequireAdmin` in the panel stays a UX gate, as it is today.

### Hosting

A new Linux Web App, `flight-assistant-dev-panel`, on the existing plan, same resource group and
region. No Application Insights resource: that one costs money, and the panel has no server-side
behaviour worth tracing.

### Serving the SPA

Linux App Service has no static-site runtime, so something has to serve the files. On Node images
after 14 LTS the container no longer starts an app with PM2 automatically; it runs the `start`
script, or an explicitly configured startup command. Rather than depend on PM2 being present in the
image at all, the deployment ships a small server of its own and a `start` script that runs it.

`server/server.js`, written against Node's built-in `http` and `fs` with no dependencies:

- serves files from `dist/`, resolving each request path and rejecting anything that escapes the
  root;
- falls back to `index.html` for any path that isn't a file, so client-side routes deep-link;
- sets `Cache-Control: public, max-age=31536000, immutable` on `/assets/*` (Vite hashes those
  names) and `no-cache` on `index.html`, so a deploy is picked up on the next load;
- sets `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a CSP
  allowing only self plus the API origin and the CIAM authority;
- listens on `process.env.PORT`.

It is application code, so it is tested: path traversal is refused, unknown paths return
`index.html` with a 200, real files return their own content type, and the cache headers differ
between a hashed asset and the entry document.

### The identity gate

Easy Auth runs in its own container ahead of the app, so a request that fails it never reaches
`server.js`. Configuration:

- `requireAuthentication: true`, unauthenticated action `RedirectToLoginPage` (302 — the docs'
  recommendation for websites, and right for a browser-only app);
- the Entra provider pointed at the CIAM issuer, `https://flightassistantextid.ciamlogin.com/<tenant-id>/v2.0`;
- `validation.defaultAuthorizationPolicy.allowedPrincipals.identities` listing the admin accounts'
  object IDs.

`allowedPrincipals` is chosen over the app registration's "user assignment required" flag
deliberately. The Microsoft documentation does not state whether External ID enforces that flag on
a CIAM sign-in flow, and an unverified assumption is a poor foundation for the layer that is
supposed to exclude travelers. An explicit list of object IDs is checked by the platform and is
readable in the app's configuration.

The gate needs its **own** app registration — web platform, client secret, redirect URI
`https://flight-assistant-dev-panel.azurewebsites.net/.auth/login/aad/callback` — separate from the
panel's SPA registration, following the documented guidance against sharing registrations between
purposes. A client secret makes Easy Auth a confidential client using the hybrid flow rather than
falling back to implicit.

The secret is stored in `flightassistantdev-kv` and referenced from an app setting with
`@Microsoft.KeyVault(...)`, matching how the backend already gets its secrets, so the secret never
appears in an app setting's value, a workflow, or this repository.

**Sign-in experience:** a first visit redirects to the tenant for the Easy Auth gate, then the page
loads and MSAL performs its own redirect for the API token. The second should be silent — the same
tenant, a session already established in that browser — but it is a round trip, not an in-page
event. This is verified, not assumed, before the work is called done.

### Network restrictions

App Service access restrictions on the panel app: allow rules for the admin IPs, default action
Deny. Public IPs from consumer ISPs rotate, so the README gets the one-line `az webapp
config access-restriction add` command to amend the list, rather than a portal walkthrough that
has to be re-read each time.

The API's own restrictions are **not** touched. It currently allows any IP, which is correct — the
traveler-facing app is a client of it.

### CORS (backend, separate PR)

`Program.cs` passes a single configured value to `WithOrigins`, sourced from
`AdminPanel:AllowedOrigin`, which in the deployed dev environment resolves from
`appsettings.Development.json` — the deployed API runs as `Development`, so that file is not
local-only. Setting it to the panel's URL would therefore stop local development working the moment
it deployed.

The key becomes `AdminPanel:AllowedOrigins`, a list, holding `http://localhost:5175` and the panel's
URL. This ships as its own backend PR and merges before the panel is deployed, otherwise the
deployed panel's first API call fails preflight.

### Deployment

A new workflow in this repository, on push to `main` and `workflow_dispatch`:

1. `npm ci`, then `npm run build` with the five `VITE_*` values supplied as repository
   **variables** — client ID, authority, known authority, API base URL and API scope are public
   identifiers, not secrets, and they are baked into the bundle at build time regardless;
2. package `dist/`, `server/server.js`, and a minimal `package.json` declaring the start command;
3. `azure/login@v2` via OIDC, then `azure/webapps-deploy@v3` to `flight-assistant-dev-panel`.

`VITE_REDIRECT_URI` becomes the deployed URL, which must also be registered as a SPA redirect URI
on the panel's existing app registration. The existing `ci.yml` is unchanged and still gates pull
requests; this workflow runs after merge.

OIDC needs a federated credential for this repository. The backend's credentials belong to the
backend's app registration and are not reused.

## What this does not do

- No custom domain. `*.azurewebsites.net` is sufficient for an internal dev tool, and a custom
  domain adds DNS and certificate steps that buy nothing here.
- No staging slot. B1 does not support deployment slots, and the panel has no traffic to protect.
- No production environment. There is no production backend to point one at.
- No change to the API's authorization, the panel's `RequireAdmin`, or the MSAL configuration
  beyond the redirect URI.

## Risks

**The gate configuration is unverified.** Easy Auth's Entra provider with a `ciamlogin` issuer, and
`allowedPrincipals.identities` against External ID accounts, are documented separately but not
together for this combination. The first task verifies both against the real tenant on a throwaway
configuration. If the combination does not hold, the fallback is the IP allowlist as the primary
lock with Easy Auth as an authenticated-only second layer, and the choice comes back to the user
rather than being silently downgraded.

**Azure and Entra changes are outside this repository.** Creating the web app, the gate
registration and its secret, the auth configuration, the IP rules and the federated credential are
portal or `az` operations. They are listed explicitly in the plan so that what was changed outside
version control is recoverable from the repository.

**The billing state is "Warned".** `az account list` reports the subscription as `Warned`, the
state behind the 2026-09-17 deploy outage. Everything here is €0 marginal, so the work does not
worsen it, but a hard disable would block deployment the same way it blocked the API's.

## Open items, needed before execution

1. Whether the user performs the Azure and Entra steps in the portal, or authorizes the `az`
   commands to be run on their behalf.
2. The object ID of each admin account that should pass the gate.
3. The public IP addresses for the allowlist.
