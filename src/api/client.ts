import axios from 'axios'
import { PublicClientApplication } from '@azure/msal-browser'
import { apiRequest } from '@/auth/msalConfig'

// Shared MSAL instance for the interceptor (outside React tree)
let msalInstance: PublicClientApplication | null = null

export function setMsalInstance(instance: PublicClientApplication) {
  msalInstance = instance
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL as string,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use(async (config) => {
  if (!msalInstance) return config
  const accounts = msalInstance.getAllAccounts()
  if (!accounts.length) return config
  try {
    const response = await msalInstance.acquireTokenSilent({
      ...apiRequest,
      account: accounts[0],
    })
    config.headers.Authorization = `Bearer ${response.accessToken}`
  } catch {
    // Token refresh failed — let request go without auth; API will return 401
  }
  return config
})
