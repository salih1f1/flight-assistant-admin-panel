import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, LayoutDashboard, LogOut, Plane } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAdminAuth } from '@/auth/useAdminAuth'
import { isCurrent, NAV_GROUPS } from './navigation'

const linkClass = (current: boolean) =>
  cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    current ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white',
  )

export function Sidebar() {
  const { logout, account } = useAdminAuth()
  const { pathname } = useLocation()
  // A group the admin opened or closed keeps that choice; any other is open only while it holds the current page.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-800 bg-gray-900 text-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-gray-800 px-5">
        <Plane className="h-5 w-5 text-blue-400" />
        <span className="font-semibold text-sm tracking-wide">FlightAssistant Admin</span>
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        <Link to="/" aria-current={pathname === '/' ? 'page' : undefined} className={linkClass(pathname === '/')}>
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          Dashboard
        </Link>

        {NAV_GROUPS.map(({ label, icon: Icon, items }) => {
          const holdsCurrent = items.some(item => isCurrent(item, pathname))
          const open = toggled[label] ?? holdsCurrent
          return (
            <div key={label}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled(previous => ({ ...previous, [label]: !open }))}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-gray-800 hover:text-white',
                  holdsCurrent ? 'text-white' : 'text-gray-400',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')} />
              </button>
              {open && (
                <ul aria-label={label} className="mt-0.5 space-y-0.5 pl-7">
                  {items.map(item => {
                    const current = isCurrent(item, pathname)
                    return (
                      <li key={item.to}>
                        <Link to={item.to} aria-current={current ? 'page' : undefined} className={cn(linkClass(current), 'py-1.5')}>
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
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
