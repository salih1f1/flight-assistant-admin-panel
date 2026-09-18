import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { LoadingBar } from './LoadingBar'

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Above the page rather than inside it: one bar covers every page, and the negative
            margin keeps it from nudging the content down as it comes and goes. */}
        <LoadingBar />
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
