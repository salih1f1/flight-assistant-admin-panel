import { useEffect, useState } from 'react'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { loginRequest, apiRequest } from './msalConfig'
import { grantsAdmin, rolesFromAccessToken } from './jwt'

/**
 * `isAdmin` is derived from the ACCESS token, not the id token, and compared
 * exactly — mirroring the API's `RequireRole("admin")`.
 *
 * This is not a stylistic choice. The two tokens carry different casing in this
 * tenant: the id token says `["Admin"]`, the access token says `["admin"]`.
 * Reading the id token and comparing exactly therefore showed "Access Denied" to
 * a user the API would happily authorise; lowercasing the comparison fixed the
 * symptom while leaving the panel deciding admin-ness from a token the API never
 * looks at. Should the id token's role ever be granted independently of the
 * access token's, that version would hand someone the full admin UI in which
 * every request 403s. Reading the access token makes the panel's answer and the
 * API's answer the same answer, by construction.
 *
 * The cost is that the check is asynchronous — an access token has to be
 * acquired before the question can be answered — so callers get `isRoleResolved`
 * and must not treat `isAdmin === false` as a denial until it is true.
 */
export function useAdminAuth() {
  const { instance, accounts } = useMsal()
  const isAuthenticated = useIsAuthenticated()

  const account = accounts[0] ?? null
  const [isAdmin, setIsAdmin] = useState(false)
  const [isRoleResolved, setIsRoleResolved] = useState(false)

  useEffect(() => {
    if (!account) {
      setIsAdmin(false)
      // No account is a resolved state: the answer is "not an admin, because
      // nobody is signed in". Leaving it unresolved would hang the gate on the
      // signed-out path, which is the one path that must render immediately.
      setIsRoleResolved(true)
      return
    }

    let cancelled = false
    setIsRoleResolved(false)

    void (async () => {
      try {
        const result = await instance.acquireTokenSilent({ ...apiRequest, account })
        if (cancelled) return
        setIsAdmin(grantsAdmin(rolesFromAccessToken(result.accessToken)))
      } catch {
        // Could not obtain an access token: deny. The API would reject the
        // request anyway, so showing the admin UI here would only produce a
        // screen of failed calls.
        if (cancelled) return
        setIsAdmin(false)
      } finally {
        if (!cancelled) setIsRoleResolved(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [account, instance])

  const login = () => instance.loginRedirect(loginRequest)

  const logout = () =>
    instance.logoutRedirect({ postLogoutRedirectUri: import.meta.env.VITE_REDIRECT_URI as string })

  const getAccessToken = async (): Promise<string> => {
    if (!account) throw new Error('No account found')
    const response = await instance.acquireTokenSilent({ ...apiRequest, account })
    return response.accessToken
  }

  return { isAuthenticated, isAdmin, isRoleResolved, account, login, logout, getAccessToken }
}
