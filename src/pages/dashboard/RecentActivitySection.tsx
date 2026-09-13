import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { useAdminGetAuditLog } from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { auditEntityLabel, auditEntityPage } from '@/lib/auditEntities'
import { formatUtcMinute } from '@/lib/formatUtc'

// Just enough to see what's happened lately; the Audit log page has the rest.
const RECENT_ROWS = 5

/** The latest admin audit rows (GET /admin/audit, newest first), with a way to the full log. */
export function RecentActivitySection() {
  const { data, isLoading, error } = useAdminGetAuditLog({ Page: 1, PageSize: RECENT_ROWS })
  const rows = data?.items ?? []

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Recent activity</h2>
        <Link to="/audit" className="text-sm text-gray-500 underline hover:text-gray-900">View all activity</Link>
      </div>
      <Card>
        <CardContent className="pt-6">
          {error ? (
            <ActivityError error={error} />
          ) : isLoading ? (
            <p className="text-sm text-gray-400">Loading activity…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500">No admin activity yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map(row => {
                const label = auditEntityLabel(row)
                const page = auditEntityPage(row)
                return (
                  <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="whitespace-nowrap text-gray-500">{row.actionUtc ? `${formatUtcMinute(row.actionUtc)} UTC` : '—'}</span>
                    <span className="font-medium">{row.actorName ?? row.actorId ?? '—'}</span>
                    <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-700">{row.action ?? '—'}</span>
                    <span>{page ? <Link to={page} className="underline">{label}</Link> : label}</span>
                    <span className="text-gray-500">{row.summary ?? ''}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function ActivityError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`Could not load recent activity: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
