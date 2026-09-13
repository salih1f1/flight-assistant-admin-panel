/**
 * Minimal JWT payload reading, shared by the admin-role check and the dev
 * diagnostic so the two can never disagree about what the token says.
 *
 * This decodes only; it does NOT verify the signature. That is correct here and
 * must stay understood: the browser is not the security boundary. The API
 * validates the token properly, and everything read here drives UI affordances
 * only. Never treat a value from this file as an authorisation decision.
 */

/**
 * The role value the API authorises on. It MUST stay byte-identical to
 * `RequireRole("admin")` in the API's Program.cs, because ASP.NET Core compares
 * role claim values with StringComparison.Ordinal. Verified against this API:
 * a claim of "Admin" makes every /admin route return 403.
 *
 * Note the tenant emits DIFFERENT casing on the two tokens — "Admin" on the id
 * token, "admin" on the access token — which is exactly why the role check reads
 * the access token and compares exactly, rather than lowercasing either one.
 */
export const ADMIN_ROLE = 'admin'

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
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

/** Entra emits a single role as a bare string and multiple roles as an array. */
export function asRoleArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') return [value]
  return undefined
}

export function rolesFromAccessToken(accessToken: string): string[] | undefined {
  return asRoleArray(decodeJwtPayload(accessToken)?.roles)
}

/** The exact check the API performs, mirrored so the two cannot drift. */
export function grantsAdmin(roles: string[] | undefined): boolean {
  return roles?.includes(ADMIN_ROLE) ?? false
}
