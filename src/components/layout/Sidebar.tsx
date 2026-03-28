import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Users, Plane, Building2, MapPin, Globe, Award, Sofa, LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAdminAuth } from '@/auth/useAdminAuth'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/travelers', label: 'Travelers', icon: Users },
  { to: '/flights', label: 'Flights', icon: Plane },
  { to: '/airlines', label: 'Airlines', icon: Building2 },
  { to: '/airports', label: 'Airports', icon: MapPin },
  { to: '/countries', label: 'Countries', icon: Globe },
  { to: '/loyalty', label: 'Loyalty Programs', icon: Award },
  { to: '/lounges', label: 'Lounges', icon: Sofa },
]

export function Sidebar() {
  const { logout, account } = useAdminAuth()

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-800 bg-gray-900 text-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-gray-800 px-5">
        <Plane className="h-5 w-5 text-blue-400" />
        <span className="font-semibold text-sm tracking-wide">FlightAssistant Admin</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-0.5 px-2">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* User info + logout */}
      <div className="border-t border-gray-800 p-4">
        <p className="truncate text-xs text-gray-400 mb-2">{account?.username}</p>
        <button
          onClick={() => logout()}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
