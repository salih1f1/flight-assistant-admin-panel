import { Link, useLocation } from 'react-router-dom'
import { managedItemFor } from '@/components/layout/navigation'
import { cn } from '@/lib/utils'

/**
 * Manage | Raw data tabs between a management page and its raw table (/data/{table}).
 * Renders nothing for a table with no management page.
 */
export function ViewTabs({ table }: { table: string }) {
  const { pathname } = useLocation()
  const item = managedItemFor(table)
  if (!item) return null

  const rawPath = `/data/${table}`
  const onRaw = pathname === rawPath
  const tabs = [
    { label: 'Manage', to: item.to, current: !onRaw },
    { label: 'Raw data', to: rawPath, current: onRaw },
  ]

  return (
    <nav aria-label="Views" className="flex gap-6 border-b border-gray-200">
      {tabs.map(tab => (
        <Link
          key={tab.label}
          to={tab.to}
          aria-current={tab.current ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-1 pb-2 text-sm font-medium',
            tab.current ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
