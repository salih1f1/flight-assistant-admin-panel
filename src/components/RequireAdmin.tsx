import { Outlet } from 'react-router-dom'
import { useAdminAuth } from '@/auth/useAdminAuth'
import { Button } from '@/components/ui/button'
import { Loader2, Plane, ShieldAlert } from 'lucide-react'

/**
 * A UX gate only. The real one is the API's `AdminOnly` policy — nothing here
 * protects data, it just avoids rendering a UI whose every call would 403.
 */
export function RequireAdmin() {
  const { isAuthenticated, isAdmin, isRoleResolved, login } = useAdminAuth()

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

  // The admin role now comes from the access token, so answering takes a token
  // acquisition. Until it lands, the honest state is "don't know yet" — rendering
  // the denial screen in the meantime would flash Access Denied at every admin on
  // every cold load, training people to ignore the one screen that should alarm
  // them.
  if (!isRoleResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="text-gray-500">Checking permissions…</p>
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
