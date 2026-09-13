import { Configuration, PopupRequest, PublicClientApplication } from '@azure/msal-browser'

export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_B2C_CLIENT_ID as string,
    authority: import.meta.env.VITE_B2C_AUTHORITY as string,
    knownAuthorities: [import.meta.env.VITE_B2C_KNOWN_AUTHORITY as string],
    redirectUri: import.meta.env.VITE_REDIRECT_URI as string,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
}

export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile', import.meta.env.VITE_API_SCOPE as string],
}

export const apiRequest = {
  scopes: [import.meta.env.VITE_API_SCOPE as string],
}

export const msalInstance = new PublicClientApplication(msalConfig)
