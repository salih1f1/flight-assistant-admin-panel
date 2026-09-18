import { ADMIN_ROLE, grantsAdmin } from './jwt'

/** What the two tokens say about `roles`, as read from the signed-in account. */
export type ClaimReport = {
  idTokenRoles?: string[]
  accessTokenRoles?: string[]
  accessTokenAudience?: string
  error?: string
}

export type RoleClaimVerdict = {
  severity: 'error' | 'warning'
  message: string
}

/**
 * What the dev overlay has to say about a claim report, or `null` when it has nothing
 * to say and should not render.
 *
 * Silence is the point. The overlay is worth having only for the failure it was built
 * for — the tenant emits `["Admin"]` on the id token and `["admin"]` on the access
 * token, which once produced "Access Denied" for a user the API would have authorised
 * — and an overlay that also announces the normal case is a permanent band of chrome
 * across the bottom of every dev page, which is how a real warning gets ignored.
 *
 * So it speaks for the three states that cost an afternoon to diagnose otherwise — no
 * `roles` claim, roles that do not match, no access token at all — and for nothing
 * else. A report that has not arrived yet is not one of them: reading the access token
 * is asynchronous, and speaking early would flash the overlay on every load of an
 * account that turns out to be fine.
 */
export function roleClaimVerdict(report: ClaimReport | null): RoleClaimVerdict | null {
  if (!report) return null

  // An acquisition failure is about the token, not about the roles: report it as
  // itself rather than as the missing-roles case it would otherwise look like.
  if (report.error) {
    return { severity: 'warning', message: `Could not acquire an access token: ${report.error}` }
  }

  const roles = report.accessTokenRoles
  if (roles === undefined) {
    return {
      severity: 'error',
      message:
        'No `roles` claim on the access token. The API will 403 every /admin route. Fix: expose the app role on the API app registration so it is emitted on the access token.',
    }
  }

  if (grantsAdmin(roles)) return null

  return {
    severity: 'error',
    message: `Mismatch. Access token roles = ${JSON.stringify(roles)}, but the API matches "${ADMIN_ROLE}" ordinally, so every /admin route will 403.`,
  }
}
