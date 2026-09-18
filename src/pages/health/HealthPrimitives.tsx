import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Status names as the API sends them, from two different enums: HealthStatus on a health check,
 * and DataSourceStatusValue on a data source (#113).
 */
export const statusColor: Record<string, string> = {
  Healthy: 'text-green-600',
  Ok: 'text-green-600',
  Degraded: 'text-amber-600',
  Unhealthy: 'text-red-600',
  // Gray, not amber: "not configured" is a deliberate choice and "unknown" is an absence of
  // information. Neither is a fault, and neither may read as healthy.
  NotConfigured: 'text-gray-500',
  Unknown: 'text-gray-500',
}

/** A status name in its tone. An unrecognised or missing status reads as Unknown, never as healthy. */
export function Status({ status }: { status: string | null | undefined }) {
  const name = status ?? 'Unknown'
  return <span className={cn('font-medium', statusColor[name] ?? 'text-gray-500')}>{name}</span>
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border border-gray-200 p-4 text-sm">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {children}
    </div>
  )
}
