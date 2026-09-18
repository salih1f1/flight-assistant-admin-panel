import { useAdminGetHealth } from '@/api/generated/admin'
import { Card, CardContent } from '@/components/ui/card'
import { apiErrorMessage } from '@/lib/apiError'
import { HealthReport } from '../health/HealthReport'

/**
 * Operator health from GET /admin/health. The endpoint always answers 200 and puts
 * the overall status in the body, so an unhealthy API still renders its report here;
 * only a failure to produce the report at all shows as an error.
 *
 * Refetching is cheap: none of the checks spend AeroAPI quota (the aeroapi check is
 * a HEAD to the base URL on its own client, outside the throttle).
 */
export function SystemHealthSection() {
  const { data, isLoading, error } = useAdminGetHealth()

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">System health</h2>
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
    </section>
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
