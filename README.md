# FlightAssistant Admin

The admin panel for the FlightAssistant API: travelers, flights, airlines, airports, countries, loyalty programs and lounges.

React 19, Vite 7, TypeScript, TanStack Query and Table, Tailwind 4 with shadcn/ui components, and MSAL for sign-in. The API client is generated from the backend's OpenAPI spec.

## Prerequisites

- Node 22 and npm.
- An account in the Entra External ID tenant with the admin app role.
- To run the API locally:
  - [flight-assistant-backend](https://github.com/salih1f1/flight-assistant-backend) cloned next to this repo (`npm run api:sync` expects `../flight-assistant-backend`).
  - The .NET 10 SDK.
  - `az login` with access to the dev Key Vault.

## Setup

```sh
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Value |
|---|---|
| `VITE_B2C_CLIENT_ID` | The panel's app registration client ID. |
| `VITE_B2C_AUTHORITY` | `https://<tenant>.ciamlogin.com/<tenant-id>/v2.0` |
| `VITE_B2C_KNOWN_AUTHORITY` | `<tenant>.ciamlogin.com` |
| `VITE_REDIRECT_URI` | `http://localhost:5175`. Must also be registered on the app registration. |
| `VITE_API_BASE_URL` | `http://localhost:5100` for a local API. |
| `VITE_API_SCOPE` | `api://<backend-client-id>/access_as_user` |

The `B2C` in the names is historical; the tenant is Entra External ID.

## Running locally

### 1. Start the API

```sh
cd ../flight-assistant-backend
dotnet run --project FlightAssistant.API --launch-profile http
```

It listens on `http://localhost:5100`.

- **Use the `http` profile.** Under the `https` profile, HTTPS redirection answers CORS preflights with a 307, and the browser rejects that.
- **It uses the shared dev database.** The local API reads the Azure dev database through the dev Key Vault, not the Docker Postgres. Anything you create, edit or delete in the panel changes shared dev data, so only delete records you created for testing.
- **CORS** allows `http://localhost:5175`, set by `AdminPanel:AllowedOrigin` in the backend's `appsettings.Development.json`.

### 2. Start the panel

```sh
npm run dev
```

Open `http://localhost:5175` and sign in.

The port is fixed (`strictPort`), because sign-in redirects back to `VITE_REDIRECT_URI`. If 5175 is taken, another dev server is still running:

- Stop it with Ctrl+C in its terminal. Ctrl+Z only suspends it, and it keeps the port.
- `lsof -i :5175` shows what holds the port.

## Deployment

`main` deploys to `https://flight-assistant-dev-panel.azurewebsites.net` via
`.github/workflows/deploy.yml`. It builds the bundle, assembles a package of `dist/`, `server.js`
and a manifest, and ships it to a Linux Web App on the same App Service plan as the dev API — so it
costs nothing beyond the plan that was already running.

**The panel is not publicly reachable.** Three separate things have to agree before a page loads:

| Layer | What it checks | Where it is configured |
|---|---|---|
| Access restrictions | your IP is allowlisted, default action Deny | App Service → Networking |
| Easy Auth | your account is named in `allowedPrincipals.identities` | App Service → Authentication |
| The API | your access token carries the `admin` role | unchanged, `AdminOnly` policy |

The second layer carries the weight, because the `flightassistantextid` directory also holds
**traveler** accounts — an admin account is created the same way a traveler's is. "Signed in to the
tenant" is therefore not a meaningful gate on its own, which is why the allowlist is a list of
object IDs rather than a "require authentication" flag. That it genuinely refuses a non-listed
account was proved, not assumed: with the allowlist pointed at a different GUID, a valid sign-in
ends in `403 — You don't have authorization to view this page`.

### The server

`server/server.js` serves the build: SPA fallback so client routes survive a refresh, `immutable`
caching for hashed assets and `no-cache` for `index.html`, and `noindex` plus the usual hardening
headers. It has no dependencies, so nothing is installed between the build and production. Linux
App Service has no static-site runtime, and Node images after 14 LTS no longer auto-start an app
with PM2, which is why the package carries a server at all.

`server/package.deploy.json` is the manifest that ships **inside the package** — it is not this
repository's own `package.json`.

The Content-Security-Policy comes from the `CONTENT_SECURITY_POLICY` app setting and is omitted
when unset. If a policy change breaks the app, clear that setting to recover.

### Things that will confuse you later

**Every auth configuration change restarts the auth container**, and this B1 plan takes 60 seconds
or more to warm up. A timeout or `ERR_TIMED_OUT` immediately after changing auth settings is the
restart, not a fault. Wait a minute before concluding anything.

**The gate's app registration needs ID token issuance enabled.** Easy Auth uses the hybrid flow
(`response_type=code+id_token`), and `az ad app create` does *not* enable it — the portal does it
silently when it creates the registration for you. Without it, sign-in succeeds at the tenant and
then the callback returns a bare `401`, which looks exactly like a secret or allowlist problem and
is neither:

```sh
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications(appId='<gate app id>')" \
  --headers "Content-Type=application/json" \
  --body '{"web":{"redirectUris":["https://flight-assistant-dev-panel.azurewebsites.net/.auth/login/aad/callback"],"implicitGrantSettings":{"enableIdTokenIssuance":true}}}'
```

That PATCH replaces the whole `web` object, so `redirectUris` has to be repeated in it or the
callback URL is wiped.

**The gate lives in a different tenant from the subscription.** The deploy identity is in the
subscription's tenant; the gate's registration is in `flightassistantextid`, which has no
subscriptions — so reaching it needs `az login --tenant <ciam tenant> --allow-no-subscriptions`.
Without that flag the CLI silently falls back to the subscription's tenant and Graph answers
`Request_ResourceNotFound` for an app that exists perfectly well in the other directory.

**The Key Vault is RBAC-based**, so access is a role assignment (`Key Vault Secrets User` on the
vault), not `az keyvault set-policy`.

### When your public IP changes

Consumer ISPs rotate them, and the symptom is a flat `403` before any sign-in redirect:

```sh
az webapp config access-restriction add -g flight-assistant-dev -n flight-assistant-dev-panel \
  --rule-name "$(whoami)-$(date +%Y%m%d)" --action Allow --priority 100 \
  --ip-address "$(curl -s https://api.ipify.org)/32"
```

**Never restrict the SCM site.** Deployments reach Kudu from GitHub runners whose IPs change every
run, so mirroring the main site's rules there breaks every deploy after the first.

### To admit another admin

Add their object ID to `allowedPrincipals.identities` in the app's authentication settings, **and**
make sure the account holds the `admin` app role. The gate and the API check different things: an
account that passes the gate without the role gets a panel that loads and then refuses every
request.

### When the API's origin list changes

The API allows the panel's origin through `AdminPanel:AllowedOrigins` in the backend's
`appsettings.Development.json` — a list, because the deployed dev API also runs as `Development`
and therefore reads the same file a developer does. Adding an environment means adding its origin
there, not replacing the existing one.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 5175. |
| `npm run build` | Type-checks (`tsc -b`) and builds to `dist/`. |
| `npm run lint` | ESLint. |
| `npm test` | Runs the tests once. |
| `npm run test:watch` | Runs the tests in watch mode. |
| `npm run api:sync` | Copies `../flight-assistant-backend/spec/openapi.json` to `openapi/openapi.json`. |
| `npm run api:generate` | Regenerates `src/api/generated/` from `openapi/openapi.json` with orval. |
| `npm run preview` | Serves the built `dist/`. |

## The API client

`src/api/generated/` is generated by [orval](https://orval.dev) from `openapi/openapi.json` (config: `orval.config.ts`). Only operations tagged `Admin - …` are included. The output is committed and excluded from lint; never edit it by hand.

**When the backend's API changes:**

1. The backend regenerates its spec with `scripts/generate-openapi.sh`; CI there fails if the committed spec drifts.
2. Here, run `npm run api:sync`, then `npm run api:generate`.
3. Fix any type errors (`npm run build`), and commit `openapi/openapi.json` together with `src/api/generated/`.

**Using it:**

- **Requests** go through `apiClient` (`src/api/client.ts`), which attaches the MSAL access token, via the mutator in `src/api/orvalMutator.ts`.
- **Hooks** are named after the operation: `useAdminGetAllAirlines({ Page, PageSize })`, `useAdminUpdateAirline()`, and so on.
- **Generated mutations don't invalidate anything.** After a write, call the matching helper in `src/api/cache.ts` (for example `invalidateAirlines(queryClient, id)`) so lists and the edited record refetch.
- **Every DTO field is optional and nullable** in the spec, so pages handle missing values.
- **Paged lists** return `{ items, total, page, pageSize }`. `PageSize` must be 1–200; the API answers 400 otherwise.
- **Error messages:** `apiErrorMessage` in `src/lib/apiError.ts` turns a failed request into the API's ProblemDetails title and detail.
- **Loyalty programs** have no get-by-ID endpoint, and kind IDs only come from the data browser (`/admin/data/loyalty-program-kinds`). `src/api/loyaltyLookups.ts` handles both.

## Auth and the admin role

Sign-in uses the MSAL redirect flow, with the token cache in `sessionStorage`.

**The tenant emits the role with different casing on the two tokens:** `Admin` on the id token, `admin` on the access token. The API's `RequireRole("admin")` is case-sensitive and reads the access token. So the panel:

- reads roles **only from the access token** (`src/auth/useAdminAuth.ts`), and
- compares them **exactly** to `admin`.

Never lowercase the comparison, and never read roles from the id token. Either change can make the panel disagree with the API.

`RequireAdmin` is only a UX gate; the API's `AdminOnly` policy is what protects data. In development, `RoleClaimDiagnostic` shows an overlay with the roles on each token — but only when there is something to explain: roles that do not match, no `roles` claim at all, or no access token. When the access token already grants admin it renders nothing, so the overlay appearing is itself the signal.

## Tests

Vitest with Testing Library in jsdom. Tests live next to the pages (`*.test.tsx`).

Tests fake the API at the HTTP boundary, so the generated client, hooks, page and table all run for real:

```ts
vi.mock('@/api/client', () => ({ apiClient: { request: vi.fn() } }))

const { sent } = installFakeApi(req => {
  if (req.method === 'GET' && req.url === '/admin/airlines') return pagedResult(airlines, req.params)
  throw httpError(404)
})
```

- `installFakeApi` (`src/test/fakeApi.ts`) records each request in `sent` and answers it with the handler.
- `pagedResult` builds a paged response and applies the API's `PageSize` rules.
- `httpError(status, body?)` builds a failed response.

Assert on what the page shows and what was sent, not on which hook sent it.

## Reference data imports

The panel has no import screen. CSV imports go straight to the API: `POST /admin/import/{alliances|countries|airports|airlines|…}`, one file per request.

Import in this order: **alliances, countries, airports, airlines**.

## Project layout

```
openapi/openapi.json    Copy of the backend spec (npm run api:sync)
src/api/generated/      orval output: clients, hooks, DTO types
src/api/                apiClient, orval mutator, cache invalidation, loyalty lookups
src/auth/               MSAL config, admin-role check, dev role diagnostic
src/components/         DataTable, dialogs, layout, shadcn/ui components
src/lib/                Form number coercion, API error messages, class-name helper
src/pages/              One folder per section; list and form pages with their tests
src/test/               Test setup, fake API, render helper
src/router.tsx          Routes, all behind RequireAdmin
server/                 The static server that ships with the deployment, and its manifest
```
