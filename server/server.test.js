import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { createStaticServer, resolveWithinRoot } from './server.js'

let root
let server
let base
let outsideFile
let outsideName

const INDEX = '<!doctype html><title>Panel</title>'

// node:http rather than fetch, so these tests do not depend on what the jsdom test environment
// provides — the server is the subject, not the client.
function getFrom(origin, path) {
  return new Promise((resolve, reject) => {
    const req = request(`${origin}${path}`, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

const get = path => getFrom(base, path)

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'panel-server-'))
  // A real, readable file OUTSIDE the served root. Without one, every traversal test passes for the
  // wrong reason — the path simply does not exist — and the containment guard can be deleted with
  // the suite still green. Proved: it was, before this file existed.
  outsideName = `panel-secret-${randomUUID()}.txt`
  outsideFile = join(dirname(root), outsideName)
  await writeFile(outsideFile, 'LEAKED')
  await writeFile(join(root, 'index.html'), INDEX)
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log(1)')
  await writeFile(join(root, 'assets', 'index-abc123.css'), 'body{margin:0}')
  server = createStaticServer({ root, csp: "default-src 'self'" })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(outsideFile, { force: true })
})

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
  // fallback, opening or refreshing one 404s — the classic way a deployed SPA looks broken while
  // the build is perfectly fine.
  it('falls back to index.html for a path with no file', async () => {
    const res = await get('/admin/airlines/42')
    expect(res.status).toBe(200)
    expect(res.body).toBe(INDEX)
  })
})

describe('cache headers', () => {
  // Vite hashes asset filenames, so an asset is safe to cache forever; index.html names those
  // assets, so caching it means a deploy stays invisible until a browser happens to revalidate.
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

  // The CSP is configured per environment, and a wrong one breaks MSAL in ways that look nothing
  // like a CSP problem. Omitting the header when unset is the escape hatch that makes a bad policy
  // recoverable with one app setting, so it is pinned rather than left to chance.
  it('omits the CSP header when none is configured', async () => {
    const bare = createStaticServer({ root })
    await new Promise(resolve => bare.listen(0, '127.0.0.1', resolve))
    const bareBase = `http://127.0.0.1:${bare.address().port}`
    try {
      const res = await getFrom(bareBase, '/')
      expect(res.headers['content-security-policy']).toBeUndefined()
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow')
    } finally {
      await new Promise(resolve => bare.close(resolve))
    }
  })
})

describe('path traversal, over HTTP', () => {
  // These pass because `new URL()` has already collapsed the dot segments — including the
  // percent-encoded forms, which the URL spec counts as dot segments too. That is worth pinning:
  // it is the reason the server is safe, and it would stop being true the moment someone used
  // `req.url` instead of the parsed pathname. What they do NOT prove is the containment guard;
  // deleting it leaves both of these green, which is why the block below exists.
  it('does not leak a file outside the root', async () => {
    const res = await get(`/%2e%2e%2f${outsideName}`)
    expect(res.body).not.toContain('LEAKED')
    expect(res.body).toBe(INDEX)
  })

  it('does not leak via an encoded absolute path', async () => {
    const res = await get(`/${encodeURIComponent(outsideFile)}`)
    expect(res.body).not.toContain('LEAKED')
    expect(res.body).toBe(INDEX)
  })
})

describe('resolveWithinRoot', () => {
  // The guard's own door. Inputs here are what a URL parser would have removed, which is exactly
  // what makes these the only tests that can fail when the guard is deleted.
  it('resolves a path inside the root', () => {
    expect(resolveWithinRoot(root, '/assets/index-abc123.js'))
      .toBe(join(root, 'assets', 'index-abc123.js'))
  })

  it('refuses a path that climbs out of the root', () => {
    expect(resolveWithinRoot(root, `/../${outsideName}`)).toBeNull()
  })

  it('refuses a path that climbs out and back in under a different name', () => {
    expect(resolveWithinRoot(root, `/../${outsideName}/../../etc/passwd`)).toBeNull()
  })

  it('refuses a sibling directory whose name merely starts with the root', () => {
    // `startsWith(rootDir)` without the separator would accept "/tmp/panel-server-abc-evil" for a
    // root of "/tmp/panel-server-abc".
    expect(resolveWithinRoot(root, `/../${outsideName}`)).toBeNull()
    expect(resolveWithinRoot('/tmp/panel', '/../panel-evil/secret')).toBeNull()
  })

  it('refuses a path that cannot be decoded', () => {
    expect(resolveWithinRoot(root, '/%E0%A4%A')).toBeNull()
  })
})
