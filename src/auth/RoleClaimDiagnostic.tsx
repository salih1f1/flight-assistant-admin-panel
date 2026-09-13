import { useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { apiRequest } from './msalConfig'
import { ADMIN_ROLE, asRoleArray, decodeJwtPayload, grantsAdmin } from './jwt'

/**
 * Dev-only overlay showing what each token actually says about `roles`, and
 * whether the API will authorise this user.
 *
 * It exists because this tenant emits different casing on the two tokens — the
 * id token carries `["Admin"]`, the access token `["admin"]` — which produced a
 * genuinely confusing failure: the panel read the id token, compared exactly,
 * and showed "Access Denied" to a user the API would have authorised. Seeing
 * both values side by side is what turned that from guesswork into a one-line
 * answer, so the overlay stays as the first thing to check when sign-in looks
 * right but the panel disagrees.
 *
 * Rendered outside the router, because `RequireAdmin` gates every route on the
 * role check — mounting this inside would hide it in exactly the failure it is
 * meant to explain.
 *
 * Raw tokens are never printed or stored; only `roles` and `aud` are read out.
 */
type ClaimReport = {
  idTokenRoles?: string[]
  accessTokenRoles?: string[]
  accessTokenAudience?: string
  error?: string
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
      const idTokenRoles = asRoleArray(
        (account.idTokenClaims as Record<string, unknown> | undefined)?.roles,
      )

      try {
        const result = await instance.acquireTokenSilent({ ...apiRequest, account })
        const payload = decodeJwtPayload(result.accessToken)
        if (cancelled) return
        setReport({
          idTokenRoles,
          accessTokenRoles: asRoleArray(payload?.roles),
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
  const apiWouldAllow = grantsAdmin(accessRoles)

  const verdict = !report
    ? 'Reading access token…'
    : report.error
      ? `Could not acquire an access token: ${report.error}`
      : accessRoles === undefined
        ? `No \`roles\` claim on the access token. The API will 403 every /admin route. Fix: expose the app role on the API app registration so it is emitted on the access token.`
        : apiWouldAllow
          ? `OK — the access token carries roles: ${JSON.stringify(accessRoles)}. The API will authorise this user.`
          : `Mismatch. Access token roles = ${JSON.stringify(accessRoles)}, but the API matches "${ADMIN_ROLE}" ordinally, so every /admin route will 403.`

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
