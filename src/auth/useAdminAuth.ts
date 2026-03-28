import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { loginRequest, apiRequest } from './msalConfig'

export function useAdminAuth() {
  const { instance, accounts } = useMsal()
  const isAuthenticated = useIsAuthenticated()

  const account = accounts[0] ?? null
  const roles = (account?.idTokenClaims as Record<string, unknown>)?.roles as string[] | undefined
  const isAdmin = roles?.includes('admin') ?? false

  const login = () => instance.loginPopup(loginRequest)

  const logout = () =>
    instance.logoutPopup({ postLogoutRedirectUri: import.meta.env.VITE_REDIRECT_URI as string })

  const getAccessToken = async (): Promise<string> => {
    if (!account) throw new Error('No account found')
    const response = await instance.acquireTokenSilent({ ...apiRequest, account })
    return response.accessToken
  }

  return { isAuthenticated, isAdmin, account, login, logout, getAccessToken }
}
