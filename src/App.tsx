import { RouterProvider } from 'react-router-dom'
import { MsalProvider } from '@azure/msal-react'
import { QueryClientProvider } from '@tanstack/react-query'
import { msalInstance } from '@/auth/msalConfig'
import { setMsalInstance } from '@/api/client'
import { createQueryClient } from '@/api/queryClient'
import { router } from './router'
import { RoleClaimDiagnostic } from '@/auth/RoleClaimDiagnostic'

setMsalInstance(msalInstance)

const queryClient = createQueryClient()

export default function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {/* Outside the router on purpose: RequireAdmin gates every route on the
            id-token role check, so a diagnostic mounted inside would be hidden by
            the very failure it explains. Renders nothing outside dev. */}
        <RoleClaimDiagnostic />
      </QueryClientProvider>
    </MsalProvider>
  )
}
