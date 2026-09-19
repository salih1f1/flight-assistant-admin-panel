// Serves the built panel on App Service. Dependency-free on purpose: the deployment package is
// dist/ plus this file plus a package.json, with no npm install between the build and production.
// Linux App Service has no static-site runtime, and Node images after 14 LTS no longer auto-start
// an app with PM2, so something in the package has to be the server.
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, extname, resolve, sep } from 'node:path'
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
    // An internal admin tool has no reason to be in an index, and being absent from one is a cheap
    // reduction in how many people ever try the URL.
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  }
  // Omitted when unset on purpose: a wrong policy breaks MSAL in ways that look nothing like a CSP
  // problem, and this is what makes one recoverable by clearing a single app setting.
  if (csp) headers['Content-Security-Policy'] = csp
  return headers
}

// The absolute path of the file to serve, or null when the request escapes the root.
//
// Exported because it cannot be reached through the server: `new URL()` collapses dot segments
// before this ever runs, and the URL spec counts the percent-encoded forms (%2e%2e) as dot segments
// too, so every traversal attempt arrives here already neutralised. That makes this defence in
// depth — the thing that still holds if the request path is ever taken from `req.url` directly, or
// if `join` is swapped for `resolve` — and defence in depth that no test can fail is just a
// comment. So it is tested here, at the only door that opens onto it.
export function resolveWithinRoot(rootDir, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  // No normalize() here, deliberately. normalize('/../x') collapses to '/x', which would quietly
  // neutralise the climb and leave the guard below unreachable — dead code wearing a security
  // comment. join() does its own normalising but lets the path escape upward, so the guard is what
  // actually refuses it, and can be proved to.
  const candidate = resolve(join(rootDir, decoded))
  if (candidate !== rootDir && !candidate.startsWith(rootDir + sep)) return null
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
        // deploy. no-cache still allows a 304; it forbids using the copy without asking.
        'Cache-Control': 'no-cache',
      })
      createReadStream(join(rootDir, 'index.html')).pipe(res)
    }

    const filePath = resolveWithinRoot(rootDir, urlPath)
    if (filePath === null) return sendIndex()

    try {
      const stats = await stat(filePath)
      if (stats.isDirectory()) return sendIndex()

      res.writeHead(200, {
        ...headers,
        'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': urlPath.startsWith('/assets/') ? IMMUTABLE : 'no-cache',
      })
      createReadStream(filePath).pipe(res)
    } catch {
      // No such file: either a client-side route or a genuine 404. The server cannot tell them
      // apart, and the SPA's own router renders the not-found page for the second case.
      sendIndex()
    }
  })
}

// Started directly by App Service (`node server.js`); imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT ?? 8080
  const server = createStaticServer({
    root: fileURLToPath(new URL('./dist/', import.meta.url)),
    csp: process.env.CONTENT_SECURITY_POLICY,
  })
  server.listen(port, () => console.log(`panel listening on ${port}`))
}
