import { useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { apiRequest } from './msalConfig'

/**
 * Dev-only overlay that answers one question the panel cannot answer for itself:
 * does the ACCESS token carry the `roles` claim, and in what casing?
 *
 * Why this exists. `useAdminAuth` decides `isAdmin` from `idTokenClaims.roles`,
 * but the API validates the ACCESS token and enforces
 * `RequireRole("admin")` against a `roles` claim on it. Those are two different
 * tokens from the same app-role assignment, and the API app registration has to
 * be configured to emit the role on the access token specifically. When it
 * isn't, the panel renders the whole admin UI and every request behind it 403s —
 * which reads as a broken API rather than a claims problem.
 *
 * Casing matters just as much. ASP.NET Core's role comparison is ordinal, so a
 * claim value of "Admin" fails `RequireRole("admin")`. Verified against this
 * API: emitting "Admin" turns every /admin route into a 403 while a
 * case-insensitive check in this panel still reports the user as an admin.
 *
 * Rendered outside the router, because `RequireAdmin` gates every route on the
 * id-token check — mounting this inside would hide it in exactly the failure it
 * is meant to explain.
 *
 * The raw tokens are never printed or stored. Only the `roles` claim and a
 * couple of non-secret envelope fields are read out of them.
 */
type ClaimReport = {
  idTokenRoles?: string[]
  accessTokenRoles?: string[]
  accessTokenAudience?: string
  error?: string
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=')
    return JSON.parse(
      decodeURIComponent(
        atob(padded)
          .split('')
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join(''),
      ),
    ) as Record<string, unknown>
  } catch {
    return null
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') return [value]
  return undefined
}

export function RoleClaimDiagnostic() {
  const { instance, accounts } = useMsal()
  const [report, setReport] = useState<ClaimReport | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const account = accounts[0] ?? null

  useEffect(() => {
    if (!account) return
    let cancelled = false

    void (async () => {
      const idTokenRoles = asStringArray(
        (account.idTokenClaims as Record<string, unknown> | undefined)?.roles,
      )

      try {
        const result = await instance.acquireTokenSilent({ ...apiRequest, account })
        const payload = decodeJwtPayload(result.accessToken)
        if (cancelled) return
        setReport({
          idTokenRoles,
          accessTokenRoles: asStringArray(payload?.roles),
          accessTokenAudience: typeof payload?.aud === 'string' ? payload.aud : undefined,
        })
      } catch (e) {
        if (cancelled) return
        setReport({ idTokenRoles, error: e instanceof Error ? e.message : String(e) })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [account, instance])

  if (!import.meta.env.DEV || !account || dismissed) return null

  const accessRoles = report?.accessTokenRoles
  // The exact check the API performs: ordinal match against "admin".
  const apiWouldAllow = accessRoles?.includes('admin') ?? false

  const verdict = !report
    ? 'Reading access token…'
    : report.error
      ? `Could not acquire an access token: ${report.error}`
      : accessRoles === undefined
        ? 'NO `roles` claim on the access token. The API will 403 every /admin route. Fix: expose the app role on the API app registration so it is emitted on the access token.'
        : apiWouldAllow
          ? 'OK — the access token carries roles: ["admin"]. The API will authorise this user.'
          : `Casing/value mismatch. Access token roles = ${JSON.stringify(accessRoles)}, but the API matches "admin" ordinally, so every /admin route will 403.`

  const tone = !report || report.error ? '#7c5800' : apiWouldAllow ? '#0b5f2a' : '#8a1010'
  const bg = !report || report.error ? '#fff6d8' : apiWouldAllow ? '#e5f6ec' : '#fde8e8'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        right: 12,
        zIndex: 9999,
        background: bg,
        color: tone,
        border: `1px solid ${tone}33`,
        borderRadius: 8,
        padding: '12px 14px',
        font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        boxShadow: '0 2px 12px rgba(0,0,0,.12)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong>roles claim diagnostic (dev only)</strong>
        <button
          onClick={() => setDismissed(true)}
          style={{ background: 'none', border: 0, cursor: 'pointer', color: tone }}
        >
          dismiss
        </button>
      </div>
      <div style={{ marginTop: 6 }}>{verdict}</div>
      <div style={{ marginTop: 6, opacity: 0.8 }}>
        id token roles: {JSON.stringify(report?.idTokenRoles ?? null)}
        {'  |  '}access token roles: {JSON.stringify(accessRoles ?? null)}
        {report?.accessTokenAudience ? `  |  aud: ${report.accessTokenAudience}` : ''}
      </div>
    </div>
  )
}
