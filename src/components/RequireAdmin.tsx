import { Outlet } from 'react-router-dom'
import { useIsAuthenticated } from '@azure/msal-react'
import { useAdminAuth } from '@/auth/useAdminAuth'
import { Button } from '@/components/ui/button'
import { Plane, ShieldAlert } from 'lucide-react'

export function RequireAdmin() {
  const isAuthenticated = useIsAuthenticated()
  const { isAdmin, login } = useAdminAuth()

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <Plane className="mx-auto h-12 w-12 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">FlightAssistant Admin</h1>
          <p className="text-gray-500">Sign in to access the admin panel.</p>
          <Button onClick={() => login()}>Sign in with Microsoft</Button>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <ShieldAlert className="mx-auto h-12 w-12 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
          <p className="text-gray-500">Your account does not have the admin role.</p>
        </div>
      </div>
    )
  }

  return <Outlet />
}
