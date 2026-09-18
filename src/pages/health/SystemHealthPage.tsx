import { useAdminGetHealth } from '@/api/generated/admin'
import { Card, CardContent } from '@/components/ui/card'
import { apiErrorMessage } from '@/lib/apiError'
import { DataSourcesSection } from './DataSourcesSection'
import { HealthReport } from './HealthReport'

/**
 * Everything an operator needs to answer "is anything wrong, and with what?" — the live health
 * checks and the process facts from GET /admin/health, and every outside dependency this
 * application has (#113).
 *
 * Its own page rather than a dashboard section: the dashboard answers "is something wrong" in a
 * line, and this answers "with what, since when, and what was actually checked" — which is more
 * than a dashboard card can carry without burying the numbers beside it.
 */
export function SystemHealthPage() {
  const { data, isLoading, error } = useAdminGetHealth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">System health</h1>
        <p className="text-sm text-gray-500">Live checks, and every outside source this application depends on.</p>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          {error ? (
            <HealthError error={error} />
          ) : isLoading || !data ? (
            <p className="text-sm text-gray-400">Loading health…</p>
          ) : (
            <HealthReport health={data} />
          )}
        </CardContent>
      </Card>

      <DataSourcesSection />
    </div>
  )
}

function HealthError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load system health: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
