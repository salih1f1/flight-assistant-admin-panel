# Panel Azure Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the admin panel from a second Web App on the existing B1 App Service plan, reachable only from allowlisted IPs by named admin accounts.

**Architecture:** A dependency-free Node server ships alongside `dist/` and serves it with SPA fallback and security headers. App Service access restrictions and Easy Auth sit in front of it; the API's `AdminOnly` policy is unchanged behind it. A GitHub Actions workflow builds the bundle with the `VITE_*` values and deploys the package over OIDC.

**Tech Stack:** Node 22 (`node:http`, `node:fs`), Vitest, GitHub Actions, Azure App Service (Linux, B1), Easy Auth, ASP.NET Core CORS.

**Spec:** `docs/superpowers/specs/2026-09-19-panel-azure-deploy-design.md`

## Global Constraints

- App name `flight-assistant-dev-panel`, resource group `flight-assistant-dev`, plan `ASP-flightassistantdev-88a9`, region westeurope.
- Tenant `flightassistantextid`, issuer `https://flightassistantextid.ciamlogin.com/<TENANT_ID>/v2.0`.
- Every Azure resource in this plan is €0 marginal. Do not create an Application Insights resource, a custom domain, or a deployment slot (B1 has no slots).
- Node 22. The server has **no runtime dependencies** — `node:` built-ins only.
- The API's own access restrictions are not touched; it must stay reachable for the traveler app.
- Deploy branch is `main` in the panel repo. The backend's deploy branch is `development`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; PR bodies end with the Claude Code attribution line.

## Ordering note

The spec names gate verification as the first task. It is Task 5 here, deliberately: nothing in
Tasks 1–4 depends on which lock wins. If `allowedPrincipals` turns out not to work against External
ID accounts, the fallback (IP allowlist as the primary lock) needs exactly the same server, workflow
and CORS change. Task 5 still gates Task 6 and the decision returns to the user there.

## Inputs needed before Task 4

These are the spec's open items. Tasks 1–3 do not need them.

- `<TENANT_ID>` — the External ID tenant's GUID (in `.env.local` as part of `VITE_B2C_AUTHORITY`).
- `<ADMIN_OBJECT_ID>` — object ID of each admin account that may pass the gate.
- `<ADMIN_IP>` — public IPs for the allowlist.
- Confirmation of who runs the `az` commands.

## File Structure

| File | Responsibility |
|---|---|
| `server/server.js` (create) | Serve `dist/` over HTTP: SPA fallback, content types, cache and security headers. Exports `createStaticServer`. |
| `server/server.test.js` (create) | Tests for the above against a temp fixture directory. |
| `server/package.deploy.json` (create) | The `package.json` that ships **inside the deployment package** — declares `type: module` and the start script. Not this repo's own manifest. |
| `.github/workflows/deploy.yml` (create) | Build with `VITE_*` variables, assemble the package, deploy over OIDC. |
| `README.md` (modify) | Deployment section: what is deployed, how to amend the IP allowlist, how to admit an admin. |
| `FlightAssistant.API/Program.cs` (backend, modify, ~line 223) | `AdminPanel:AllowedOrigins` as a list. |
| `FlightAssistant.API/appsettings.Development.json` (backend, modify) | The list, holding localhost and the panel URL. |
| `FlightAssistant.API.Tests/Integration/AdminCorsTests.cs` (backend, create) | Preflight accepted for each configured origin, refused for others. |

---

### Task 1: Backend — CORS accepts a list of origins

**Repo:** `flight-assistant-backend`. Branch from `origin/development` as `feature/<issue>-cors-origin-list`, own issue, own PR. **This PR merges before Task 6.**

**Files:**
- Modify: `FlightAssistant.API/Program.cs:221-229`
- Modify: `FlightAssistant.API/appsettings.Development.json` (the `AdminPanel` section)
- Modify: `FlightAssistant.API/appsettings.Testing.json` (add an `AdminPanel` section)
- Test: `FlightAssistant.API.Tests/Integration/AdminCorsTests.cs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: configuration key `AdminPanel:AllowedOrigins` (a JSON array of strings). Task 6 sets it on the deployed API. The old singular key `AdminPanel:AllowedOrigin` ceases to exist — verified safe, because `az webapp config appsettings list` shows the dev App Service has no app setting of either name; the value comes only from `appsettings.Development.json`.

- [ ] **Step 1: Write the failing test**

Create `FlightAssistant.API.Tests/Integration/AdminCorsTests.cs`:

```csharp
using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace FlightAssistant.API.Tests.Integration;

/// <summary>
/// The panel is served from a different origin than the API, so every admin call is cross-origin
/// and dies at preflight if the origin is not configured. One origin is not enough: the deployed
/// panel and a developer's localhost:5175 both have to work, and appsettings.Development.json ships
/// to the dev App Service (the deployed API runs as Development), so a single value cannot hold
/// both. These tests pin that the policy is built from a list.
/// </summary>
public class AdminCorsTests : IClassFixture<AdminCorsTests.TwoOriginFactory>
{
    private readonly TwoOriginFactory _factory;

    public AdminCorsTests(TwoOriginFactory factory) => _factory = factory;

    public class TwoOriginFactory : FlightAssistantWebApplicationFactory
    {
        public const string LocalOrigin = "http://localhost:5175";
        public const string DeployedOrigin = "https://flight-assistant-dev-panel.azurewebsites.net";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureHostConfiguration(config =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["AdminPanel:AllowedOrigins:0"] = LocalOrigin,
                    ["AdminPanel:AllowedOrigins:1"] = DeployedOrigin,
                }));
        }
    }

    private async Task<HttpResponseMessage> Preflight(string origin)
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Options, "/admin/airlines");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "GET");
        return await client.SendAsync(request);
    }

    [Theory]
    [InlineData(TwoOriginFactory.LocalOrigin)]
    [InlineData(TwoOriginFactory.DeployedOrigin)]
    public async Task EveryConfiguredOriginIsAllowed(string origin)
    {
        var response = await Preflight(origin);

        Assert.True(
            response.Headers.TryGetValues("Access-Control-Allow-Origin", out var allowed),
            $"Preflight from the configured origin {origin} returned no Access-Control-Allow-Origin " +
            "header, so the browser will refuse every admin call from it.");
        Assert.Equal(origin, Assert.Single(allowed!));
    }

    [Fact]
    public async Task AnUnconfiguredOriginIsRefused()
    {
        var response = await Preflight("https://example.invalid");

        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Origin"),
            "An origin that is not configured must not be echoed back; otherwise the list is " +
            "decorative and any site could call the admin API from a browser.");
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
dotnet test FlightAssistant.API.Tests --filter FullyQualifiedName~AdminCorsTests
```

Expected: `EveryConfiguredOriginIsAllowed` fails for the deployed origin (the current code reads the
singular `AdminPanel:AllowedOrigin` and passes one value to `WithOrigins`). Read the failure before
continuing — if *both* cases fail, the in-memory configuration is not reaching `Program.cs`, which
is a different problem from the one this task fixes.

- [ ] **Step 3: Make the policy read a list**

In `FlightAssistant.API/Program.cs`, replace the CORS registration (currently lines 221–229):

```csharp
// The panel is a separate origin, and there is more than one of it: a developer's localhost and
// the deployed panel. A single configured origin cannot serve both, because the deployed dev API
// runs as Development and therefore reads the same appsettings.Development.json a developer does.
var adminPanelOrigins = builder.Configuration
    .GetSection("AdminPanel:AllowedOrigins")
    .Get<string[]>() ?? [];

builder.Services.AddCors(options =>
{
    options.AddPolicy("AdminPanel", policy =>
        policy.WithOrigins(adminPanelOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod());
});
```

- [ ] **Step 4: Put the origins in configuration**

`appsettings.Development.json` — replace the `AdminPanel` section:

```json
  "AdminPanel": {
    "AllowedOrigins": [
      "http://localhost:5175",
      "https://flight-assistant-dev-panel.azurewebsites.net"
    ]
  }
```

`appsettings.Testing.json` — add alongside the existing sections, so a test run that does not
override configuration still has a defined policy rather than an empty one:

```json
  "AdminPanel": {
    "AllowedOrigins": [ "http://localhost:5175" ]
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
dotnet test FlightAssistant.API.Tests --filter FullyQualifiedName~AdminCorsTests
```

Expected: 3 passed.

- [ ] **Step 6: Prove the tests catch the regression**

Derive the break from the code just written, not from this instruction: temporarily change
`WithOrigins(adminPanelOrigins)` to `WithOrigins(adminPanelOrigins.FirstOrDefault() ?? "")` — the
single-origin behaviour this task removes. Re-run.

Expected: `EveryConfiguredOriginIsAllowed` fails for the deployed origin and passes for localhost.
If it passes for both, the test is not pinning what it claims — fix the test before restoring the
code. Then restore.

- [ ] **Step 7: Run the whole suite and commit**

```bash
dotnet test
git add FlightAssistant.API/Program.cs FlightAssistant.API/appsettings.Development.json \
        FlightAssistant.API/appsettings.Testing.json \
        FlightAssistant.API.Tests/Integration/AdminCorsTests.cs
git commit -m "feat(cors): accept a list of admin panel origins, not one

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Regenerate the spec if any route changed**

No endpoint changed here, so `spec/openapi.json` should be untouched. Confirm with `git status`
before opening the PR — CI fails on spec drift.

---

### Task 2: The static server

**Files:**
- Create: `server/server.js`
- Test: `server/server.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createStaticServer({ root, csp }) => http.Server` — `root` is an absolute path to the
  directory to serve, `csp` an optional Content-Security-Policy string (header omitted when absent).
  Task 3 packages this file; Task 4 starts it with `node server.js`.

Tests use `node:http` directly rather than `fetch`, so they do not depend on what the jsdom test
environment provides. ESLint only lints `.ts`/`.tsx` and `tsc -b` only includes `src`, so a `.js`
file here is not type-checked — which is why its behaviour is pinned by tests instead.

- [ ] **Step 1: Write the failing tests**

Create `server/server.test.js`:

```js
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { createStaticServer } from './server.js'

let root
let server
let base

const INDEX = '<!doctype html><title>Panel</title>'

function get(path) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'panel-server-'))
  await writeFile(join(root, 'index.html'), INDEX)
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log(1)')
  await writeFile(join(root, 'assets', 'index-abc123.css'), 'body{margin:0}')
  server = createStaticServer({ root, csp: "default-src 'self'" })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => new Promise(resolve => server.close(resolve)))

describe('serving files', () => {
  it('serves index.html at the root', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(res.body).toBe(INDEX)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
  })

  it('serves a real asset with its own content type', async () => {
    const res = await get('/assets/index-abc123.css')
    expect(res.status).toBe(200)
    expect(res.body).toBe('body{margin:0}')
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8')
  })
})

describe('client-side routing', () => {
  // Every panel route below the root is a react-router route with no file behind it. Without a
  // fallback, opening or refreshing one 404s, which is the classic way a deployed SPA looks broken
  // while the build is perfectly fine.
  it('falls back to index.html for a path with no file', async () => {
    const res = await get('/admin/airlines/42')
    expect(res.status).toBe(200)
    expect(res.body).toBe(INDEX)
  })
})

describe('cache headers', () => {
  // Vite hashes asset filenames, so an asset is safe to cache forever; index.html names those
  // assets, so caching it means a deploy is invisible until the browser happens to revalidate.
  it('lets hashed assets be cached immutably', async () => {
    const res = await get('/assets/index-abc123.js')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('never caches the entry document', async () => {
    const res = await get('/')
    expect(res.headers['cache-control']).toBe('no-cache')
  })
})

describe('security headers', () => {
  it('asks not to be indexed', async () => {
    const res = await get('/')
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow')
  })

  it('sets the remaining hardening headers', async () => {
    const res = await get('/')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })

  it('sends the CSP it was given', async () => {
    const res = await get('/')
    expect(res.headers['content-security-policy']).toBe("default-src 'self'")
  })

  it('omits the CSP header when none is configured', async () => {
    const bare = createStaticServer({ root })
    await new Promise(resolve => bare.listen(0, '127.0.0.1', resolve))
    const port = bare.address().port
    const res = await new Promise((resolve, reject) => {
      const req = request(`http://127.0.0.1:${port}/`, r => {
        r.resume()
        r.on('end', () => resolve({ headers: r.headers }))
      })
      req.on('error', reject)
      req.end()
    })
    await new Promise(resolve => bare.close(resolve))
    expect(res.headers['content-security-policy']).toBeUndefined()
  })
})

describe('path traversal', () => {
  // The encoded form matters: an http client normalises "/../x" before it ever reaches the server,
  // so a test written with literal dot-segments proves nothing. These arrive at the server intact.
  it('refuses to serve a file outside the root', async () => {
    const res = await get('/%2e%2e%2f%2e%2e%2fpackage.json')
    expect(res.body).toBe(INDEX)
    expect(res.body).not.toContain('"devDependencies"')
  })

  it('refuses an encoded absolute path', async () => {
    const res = await get('/%2Fetc%2Fpasswd')
    expect(res.body).toBe(INDEX)
    expect(res.body).not.toContain('root:')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -- server/server.test.js
```

Expected: the whole file fails to collect — `Failed to resolve import "./server.js"`.

- [ ] **Step 3: Write the server**

Create `server/server.js`:

```js
// Serves the built panel on App Service. No dependencies on purpose: the deployment package is
// dist/ plus this file plus a package.json, with no npm install step on the way to production.
// Linux App Service has no static-site runtime, and Node images after 14 LTS no longer auto-start
// an app with PM2, so something in the package has to be the server.
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
}

const IMMUTABLE = 'public, max-age=31536000, immutable'

function securityHeaders(csp) {
  const headers = {
    // An internal admin tool has no reason to be in an index, and being absent from one is a
    // cheap reduction in how many people ever try the URL.
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  }
  if (csp) headers['Content-Security-Policy'] = csp
  return headers
}

// Returns the absolute path of the file to serve, or null when the request escapes the root.
// Decoding first is the point: an encoded "../" arrives here intact, having passed through every
// client-side normalisation untouched.
function resolveWithinRoot(root, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const candidate = resolve(join(root, normalize(decoded)))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  return candidate
}

export function createStaticServer({ root, csp } = {}) {
  const rootDir = resolve(root)

  return createServer(async (req, res) => {
    const headers = securityHeaders(csp)
    const urlPath = new URL(req.url, 'http://localhost').pathname

    const sendIndex = () => {
      res.writeHead(200, {
        ...headers,
        'Content-Type': CONTENT_TYPES['.html'],
        // index.html names the hashed assets, so a cached copy pins the whole app to an old
        // deploy. no-cache still allows a 304, it just forbids using it without asking.
        'Cache-Control': 'no-cache',
      })
      createReadStream(join(rootDir, 'index.html')).pipe(res)
    }

    const filePath = resolveWithinRoot(rootDir, urlPath)
    if (filePath === null) return sendIndex()

    try {
      const stats = await stat(filePath)
      if (stats.isDirectory()) return sendIndex()

      const extension = extname(filePath)
      res.writeHead(200, {
        ...headers,
        'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'Cache-Control': urlPath.startsWith('/assets/') ? IMMUTABLE : 'no-cache',
      })
      createReadStream(filePath).pipe(res)
    } catch {
      // No such file: either a client-side route or a genuine 404. The SPA cannot tell them apart
      // from out here, and its own router renders the not-found page for the second case.
      sendIndex()
    }
  })
}

// Started directly by App Service (`node server.js`), imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT ?? 8080
  const server = createStaticServer({
    root: fileURLToPath(new URL('./dist/', import.meta.url)),
    csp: process.env.CONTENT_SECURITY_POLICY,
  })
  server.listen(port, () => console.log(`panel listening on ${port}`))
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npm test -- server/server.test.js
```

Expected: 11 passed.

- [ ] **Step 5: Prove the tests catch real breaks**

Derive each break from the code just written. Run the suite after each, restore before the next:

1. In `resolveWithinRoot`, drop the `startsWith` guard (`return candidate` unconditionally) →
   expect both path-traversal tests to fail.
2. In the file branch, use `'no-cache'` for every path → expect the immutable-asset test to fail.
3. Delete the `catch` branch's `sendIndex()` and let the request hang → expect the SPA-fallback test
   to fail.

If any break passes, the test is the thing that is wrong: add the test that fails, then restore.

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/server.test.js
git commit -m "feat(deploy): serve the built panel from a dependency-free node server

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Deployment package and workflow

**Files:**
- Create: `server/package.deploy.json`
- Create: `.github/workflows/deploy.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `server/server.js` from Task 2.
- Produces: a package whose root holds `package.json`, `server.js` and `dist/`; a workflow deploying
  it to the app name `flight-assistant-dev-panel`. Task 4 creates that app and sets the matching
  startup command; Task 4 also creates the repository variables and secrets named here.

- [ ] **Step 1: Write the package manifest**

Create `server/package.deploy.json` — this becomes `package.json` *inside the deployment package*,
not this repository's manifest:

```json
{
  "name": "flight-assistant-admin-panel-server",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy panel

# Only after merge. ci.yml is what gates a pull request; this is what ships main.
on:
  push:
    branches: [main]
  workflow_dispatch:

# Two merges in quick succession must not race each other onto the same app, and cancelling a
# half-finished deploy would leave the app on whichever files happened to land first.
concurrency:
  group: deploy-panel
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      # Vite inlines these at build time, so an empty one produces a bundle that builds, deploys and
      # then fails at sign-in with an error pointing at Entra rather than at the missing variable.
      - name: Check the build variables are set
        env:
          VITE_B2C_CLIENT_ID: ${{ vars.VITE_B2C_CLIENT_ID }}
          VITE_B2C_AUTHORITY: ${{ vars.VITE_B2C_AUTHORITY }}
          VITE_B2C_KNOWN_AUTHORITY: ${{ vars.VITE_B2C_KNOWN_AUTHORITY }}
          VITE_REDIRECT_URI: ${{ vars.VITE_REDIRECT_URI }}
          VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}
          VITE_API_SCOPE: ${{ vars.VITE_API_SCOPE }}
        run: |
          missing=""
          for name in VITE_B2C_CLIENT_ID VITE_B2C_AUTHORITY VITE_B2C_KNOWN_AUTHORITY \
                      VITE_REDIRECT_URI VITE_API_BASE_URL VITE_API_SCOPE; do
            [ -z "${!name}" ] && missing="$missing $name"
          done
          if [ -n "$missing" ]; then
            echo "Repository variables not set:$missing" >&2
            exit 1
          fi

      - name: Build
        env:
          VITE_B2C_CLIENT_ID: ${{ vars.VITE_B2C_CLIENT_ID }}
          VITE_B2C_AUTHORITY: ${{ vars.VITE_B2C_AUTHORITY }}
          VITE_B2C_KNOWN_AUTHORITY: ${{ vars.VITE_B2C_KNOWN_AUTHORITY }}
          VITE_REDIRECT_URI: ${{ vars.VITE_REDIRECT_URI }}
          VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}
          VITE_API_SCOPE: ${{ vars.VITE_API_SCOPE }}
        run: npm run build

      - name: Assemble the deployment package
        run: |
          mkdir -p package
          cp -r dist package/dist
          cp server/server.js package/server.js
          cp server/package.deploy.json package/package.json

      - uses: actions/upload-artifact@v4
        with:
          name: panel
          path: package

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # required to request the OIDC token for azure/login
      contents: read
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: panel
          path: package

      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_PANEL_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_PANEL_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_PANEL_SUBSCRIPTION_ID }}

      - uses: azure/webapps-deploy@v3
        with:
          app-name: flight-assistant-dev-panel
          package: package
```

- [ ] **Step 3: Check the workflow parses**

```bash
npm run lint
gh workflow list
```

Expected: lint passes (it does not read YAML, this is just the guard against an unrelated break),
and after the branch is pushed the workflow appears. A YAML syntax error shows up as the workflow
failing to register — if `gh workflow list` omits it after the push in Step 5, that is the signal.

- [ ] **Step 4: Document it in the README**

Add a `## Deployment` section after `## Running locally`:

```markdown
## Deployment

`main` deploys to `flight-assistant-dev-panel.azurewebsites.net` via `.github/workflows/deploy.yml`.
The bundle is built with the `VITE_*` repository **variables** (not secrets — they are public
identifiers, and Vite inlines them into the bundle anyway).

The panel is reachable only from allowlisted IPs, by accounts named in the App Service
authentication settings. Two things therefore need maintaining:

**When your public IP changes** (consumer ISPs rotate them):

```sh
az webapp config access-restriction add -g flight-assistant-dev -n flight-assistant-dev-panel \
  --rule-name "$(whoami)-$(date +%Y%m%d)" --action Allow --priority 100 \
  --ip-address "$(curl -s https://api.ipify.org)/32"
```

**To admit another admin**, add their object ID to `allowedPrincipals.identities` in the app's
authentication settings, and make sure the account also holds the `admin` app role — the gate and
the API check different things, and an account that passes the gate without the role gets a panel
that loads and then refuses every request.
```

- [ ] **Step 5: Commit and push**

```bash
git add server/package.deploy.json .github/workflows/deploy.yml README.md
git commit -m "feat(deploy): build and ship the panel to App Service from main

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

The workflow will not run yet — it triggers on `main`, and the app it targets does not exist until
Task 4. That is the intended order: the code lands, reviewed, before anything is created in Azure.

---

### Task 4: Create the Web App and deploy to it

**Requires:** the inputs listed at the top, and confirmation of who runs these commands. Everything
here is an Azure write — do not run any of it without that confirmation.

**Files:** none in the repository. Every command is recorded here so that what was changed outside
version control is recoverable.

**Interfaces:**
- Consumes: the package layout from Task 3.
- Produces: the app `flight-assistant-dev-panel`, serving the panel over HTTPS with **no locks yet**.
  Tasks 5 and 6 add them.

- [ ] **Step 1: Create the app on the existing plan**

```bash
az webapp create -g flight-assistant-dev -p ASP-flightassistantdev-88a9 \
  -n flight-assistant-dev-panel --runtime "NODE:22-lts"
az webapp update -g flight-assistant-dev -n flight-assistant-dev-panel --https-only true
```

Confirm the plan still reports one plan and now two apps, and that no new plan was created:

```bash
az appservice plan list -g flight-assistant-dev -o table
az webapp list -g flight-assistant-dev --query "[].{name:name, plan:appServicePlanId}" -o table
```

- [ ] **Step 2: Set the startup command and runtime settings**

```bash
az webapp config set -g flight-assistant-dev -n flight-assistant-dev-panel \
  --startup-file "node server.js"
az webapp config appsettings set -g flight-assistant-dev -n flight-assistant-dev-panel --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  WEBSITE_NODE_DEFAULT_VERSION=~22
```

`SCM_DO_BUILD_DURING_DEPLOYMENT=false` because the package is already built and has no dependencies
to install; leaving build automation on invites Oryx to run npm against a manifest with no
dependency list.

- [ ] **Step 3: Create the deployment identity and federated credential**

```bash
az ad app create --display-name "flight-assistant-panel-deploy"
# capture appId as GITHUB_APP_ID and the created service principal's id
az ad sp create --id <GITHUB_APP_ID>

az ad app federated-credential create --id <GITHUB_APP_ID> --parameters '{
  "name": "panel-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:salih1f1/flight-assistant-admin-panel:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

az role assignment create --assignee <GITHUB_APP_ID> --role "Website Contributor" \
  --scope "/subscriptions/a39b9c33-675b-40ca-84fc-6e548ef6d6c5/resourceGroups/flight-assistant-dev/providers/Microsoft.Web/sites/flight-assistant-dev-panel"
```

Scoped to the one app, not the resource group: this credential only ever needs to deploy the panel.

- [ ] **Step 4: Set the repository variables and secrets**

```bash
gh variable set VITE_B2C_CLIENT_ID --body "<panel SPA app registration client id>"
gh variable set VITE_B2C_AUTHORITY --body "https://flightassistantextid.ciamlogin.com/<TENANT_ID>/v2.0"
gh variable set VITE_B2C_KNOWN_AUTHORITY --body "flightassistantextid.ciamlogin.com"
gh variable set VITE_REDIRECT_URI --body "https://flight-assistant-dev-panel.azurewebsites.net"
gh variable set VITE_API_BASE_URL --body "https://flight-assistant-dev-api.azurewebsites.net"
gh variable set VITE_API_SCOPE --body "api://<backend client id>/access_as_user"

gh secret set AZURE_PANEL_CLIENT_ID --body "<GITHUB_APP_ID>"
gh secret set AZURE_PANEL_TENANT_ID --body "967285b3-fe6f-48ae-b2b9-d9b136222022"
gh secret set AZURE_PANEL_SUBSCRIPTION_ID --body "a39b9c33-675b-40ca-84fc-6e548ef6d6c5"
```

- [ ] **Step 5: Register the panel's redirect URI**

On the panel's **existing SPA** app registration, add `https://flight-assistant-dev-panel.azurewebsites.net`
as a redirect URI of type SPA. Leave `http://localhost:5175` in place — local development still
needs it, and both can coexist on one registration.

- [ ] **Step 6: Deploy and verify the app serves**

```bash
gh workflow run "Deploy panel"
gh run watch
curl -sI https://flight-assistant-dev-panel.azurewebsites.net/ | head -20
```

Expected: `HTTP/2 200`, `content-type: text/html; charset=utf-8`, `cache-control: no-cache`,
`x-robots-tag: noindex, nofollow`.

```bash
curl -s https://flight-assistant-dev-panel.azurewebsites.net/admin/airlines/42 | head -c 200
```

Expected: the same HTML as the root — the SPA fallback working on the real host, not only in tests.

- [ ] **Step 7: Open it in a browser and sign in**

The page is still unlocked at this point, and that is expected — Tasks 5 and 6 add the locks. Sign
in with MSAL and confirm a grid loads. A CORS failure here means Task 1 has not been deployed to
the API yet; check that before touching anything else.

---

### Task 5: The identity gate, and verifying it actually excludes people

**This is the task the spec flagged as unverified.** It ends with a decision point, not an
assumption.

**Interfaces:**
- Consumes: the running app from Task 4.
- Produces: Easy Auth configured with `requireAuthentication` and an explicit list of admin object
  IDs — or, if that combination does not hold, a recorded finding and a return to the user.

- [ ] **Step 1: Register the gate's own application**

Separate from the panel's SPA registration, per the documented guidance against sharing one
registration across purposes:

```bash
az ad app create --display-name "flight-assistant-panel-gate" \
  --web-redirect-uris "https://flight-assistant-dev-panel.azurewebsites.net/.auth/login/aad/callback"
az ad app credential reset --id <GATE_APP_ID> --append --display-name "easyauth"
```

- [ ] **Step 2: Put the secret in Key Vault and reference it**

```bash
az keyvault secret set --vault-name flightassistantdev-kv --name panel-gate-client-secret \
  --value "<the secret from Step 1>"

az webapp identity assign -g flight-assistant-dev -n flight-assistant-dev-panel

az keyvault set-policy --name flightassistantdev-kv --secret-permissions get list \
  --object-id "$(az webapp identity show -g flight-assistant-dev -n flight-assistant-dev-panel --query principalId -o tsv)"

az webapp config appsettings set -g flight-assistant-dev -n flight-assistant-dev-panel --settings \
  GATE_CLIENT_SECRET="@Microsoft.KeyVault(SecretUri=https://flightassistantdev-kv.vault.azure.net/secrets/panel-gate-client-secret/)"
```

Confirm the reference resolved before going further — an unresolved Key Vault reference shows up as
the literal `@Microsoft.KeyVault(...)` string being treated as the secret, and the failure surfaces
later as an opaque sign-in error:

```bash
az webapp config appsettings list -g flight-assistant-dev -n flight-assistant-dev-panel \
  --query "[?name=='GATE_CLIENT_SECRET']" -o json
```

- [ ] **Step 3: Configure Easy Auth**

Write `authsettings.json`:

```json
{
  "properties": {
    "platform": { "enabled": true, "runtimeVersion": "~1" },
    "globalValidation": {
      "requireAuthentication": true,
      "unauthenticatedClientAction": "RedirectToLoginPage",
      "redirectToProvider": "azureactivedirectory"
    },
    "identityProviders": {
      "azureActiveDirectory": {
        "enabled": true,
        "registration": {
          "openIdIssuer": "https://flightassistantextid.ciamlogin.com/<TENANT_ID>/v2.0",
          "clientId": "<GATE_APP_ID>",
          "clientSecretSettingName": "GATE_CLIENT_SECRET"
        },
        "validation": {
          "allowedAudiences": ["<GATE_APP_ID>"],
          "defaultAuthorizationPolicy": {
            "allowedPrincipals": { "identities": ["<ADMIN_OBJECT_ID>"] }
          }
        }
      }
    },
    "login": { "tokenStore": { "enabled": true } }
  }
}
```

```bash
az rest --method put \
  --uri "/subscriptions/a39b9c33-675b-40ca-84fc-6e548ef6d6c5/resourceGroups/flight-assistant-dev/providers/Microsoft.Web/sites/flight-assistant-dev-panel/config/authsettingsV2?api-version=2020-09-01" \
  --body @authsettings.json
```

- [ ] **Step 4: Verify an anonymous request never reaches the app**

```bash
curl -sI https://flight-assistant-dev-panel.azurewebsites.net/ | head -5
```

Expected: `HTTP/2 302` with a `location` pointing at `/.auth/login/aad` or the tenant — **not** a
200, and none of `server.js`'s headers.

- [ ] **Step 5: Verify an allowed account gets in**

In a browser: open the site, complete the tenant sign-in, land on the panel, sign in with MSAL,
load a grid. Note whether the MSAL step prompted or completed silently, and record which — the spec
predicts silent, and a prompt is a finding worth writing down, not a failure.

- [ ] **Step 6: Prove the gate actually excludes — the break test**

The lock is worthless unless a non-listed account is refused, and the way to know is to make the
listed account non-listed. Temporarily replace the object ID in `allowedPrincipals.identities` with
a different GUID, re-PUT, wait for the app to pick it up, then open the site in a fresh private
window.

Expected: sign-in succeeds and the app **still refuses** with 403 — authentication passed,
authorization did not. If the panel loads anyway, `allowedPrincipals` is not being enforced for
External ID accounts: that is the spec's flagged risk landing, so **stop**, restore the real object
ID, and report back — the fallback is the IP allowlist as the primary lock, which is the user's
call, not the implementer's.

Restore the real object ID and confirm access returns.

- [ ] **Step 7: Record the outcome**

Append a short "Verified" note to the spec file recording what the gate actually did: whether
`allowedPrincipals` was enforced, whether the second sign-in was silent, and the exact 403 body
Easy Auth returns. Commit it on the branch.

---

### Task 6: The IP allowlist, and closing the loop

**Interfaces:**
- Consumes: the verified gate from Task 5.
- Produces: the finished deployment — three locks, CORS live on the API, README accurate.

- [ ] **Step 1: Make sure the backend CORS change is deployed first**

Task 1's PR must be merged to `development` and deployed. Check it landed on the running API:

```bash
gh run list --repo salih1f1/flight-assistant-backend --workflow "Build and deploy ASP.Net Core app to Azure Web App - flight-assistant-dev-api" --limit 3
```

Without this, the next step locks you out of a panel that cannot call the API anyway.

- [ ] **Step 2: Add the allow rules, then close the door**

Add every admin IP **before** switching the default action, or the rule that locks the door lands
before the key exists:

```bash
az webapp config access-restriction add -g flight-assistant-dev -n flight-assistant-dev-panel \
  --rule-name admin-primary --action Allow --priority 100 \
  --ip-address "$(curl -s https://api.ipify.org)/32"

az webapp config access-restriction show -g flight-assistant-dev -n flight-assistant-dev-panel
```

Confirm the rule is listed, then set the default action to Deny (the portal's "Unmatched rule
action", under Networking → Access restriction).

**Do not restrict the SCM site.** GitHub-hosted runners deploy from IPs that change per run, and
`azure/webapps-deploy` goes through the SCM endpoint. Leave `scmIpSecurityRestrictionsUseMain`
false, and confirm it:

```bash
az webapp config access-restriction show -g flight-assistant-dev -n flight-assistant-dev-panel \
  --query "scmIpSecurityRestrictionsUseMain"
```

Expected: `false`. If it is true, the next deploy fails with a 403 from Kudu.

- [ ] **Step 3: Prove the allowlist excludes**

From an allowlisted network: `curl -sI https://flight-assistant-dev-panel.azurewebsites.net/`
→ 302 to sign-in.

From somewhere else — Azure Cloud Shell is the cheapest off-allowlist network to hand, a phone
hotspot also works: the same curl → `HTTP/2 403` with an `x-ms-forbidden-ip` style response,
**before** any sign-in redirect. If it returns the 302 instead, the default action is still Allow.

- [ ] **Step 4: Redeploy and confirm deployment still works through the locks**

```bash
gh workflow run "Deploy panel"
gh run watch
```

Expected: green. This is the step that catches an SCM restriction applied by accident.

- [ ] **Step 5: Turn on the CSP and verify the app still works**

```bash
az webapp config appsettings set -g flight-assistant-dev -n flight-assistant-dev-panel --settings \
  CONTENT_SECURITY_POLICY="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://flight-assistant-dev-api.azurewebsites.net https://flightassistantextid.ciamlogin.com; frame-src https://flightassistantextid.ciamlogin.com; base-uri 'none'; object-src 'none'"
```

`frame-src` is load-bearing: MSAL renews tokens silently in a hidden iframe pointed at the
authority, so a CSP without it produces an app that works until a token expires and then fails in a
way that looks nothing like a CSP problem. `style-src` needs `'unsafe-inline'` because the UI
components set inline styles.

Open the panel, load two or three pages, and watch the browser console for CSP violations. If
anything is blocked, remove the app setting (the server omits the header when it is unset), fix the
policy, and re-apply — never leave a half-working CSP in place.

- [ ] **Step 6: Final verification pass**

- [ ] Anonymous request from an allowed IP → 302 to sign-in.
- [ ] Any request from a disallowed IP → 403.
- [ ] Non-listed account → 403 after sign-in.
- [ ] Listed admin → panel loads, grids load, a record page opens.
- [ ] A write (verify a row, or edit a record) succeeds — proves CORS covers more than GET.
- [ ] `npm test` and `npm run lint` pass locally; CI green on the branch.

- [ ] **Step 7: Close out**

Update the README's Deployment section with anything the real setup contradicted, open the PR, and
report to the user: what is deployed, what the three locks actually refused, and the exact IP
allowlist entries in place.

---

## Self-review

**Spec coverage.** Hosting on the existing B1 plan → Task 4 Step 1. Zero-dependency server with SPA
fallback, cache and security headers → Task 2. Easy Auth with `allowedPrincipals` → Task 5. Gate app
registration separate from the SPA registration, secret in Key Vault → Task 5 Steps 1–2. IP
allowlist with default Deny, API restrictions untouched → Task 6 Step 2. CORS as a list, backend PR
first → Task 1, enforced by Task 6 Step 1. Workflow with `VITE_*` as variables and OIDC → Task 3.
README on amending the allowlist and admitting an admin → Task 3 Step 4. "What this does not do"
(no custom domain, slot, production, or auth changes) → nothing in the plan creates them. The risk
section's verification and fallback → Task 5 Step 6.

**Placeholders.** The `<...>` values are the spec's declared open items (tenant ID, object IDs,
IPs, generated app IDs), listed under "Inputs needed before Task 4" and blocking only Tasks 4–6.
No step says "handle errors appropriately" or defers a decision.

**Type consistency.** `createStaticServer({ root, csp })` is the same name and shape in Task 2's
test, Task 2's implementation, and the direct-start branch. `CONTENT_SECURITY_POLICY` is the env var
in `server.js` and the app setting in Task 6 Step 5. `AdminPanel:AllowedOrigins` is the same key in
Task 1's test, `Program.cs`, and both appsettings files. The app name `flight-assistant-dev-panel`
is identical in the workflow, every `az` command, the role assignment scope, and the redirect URIs.
