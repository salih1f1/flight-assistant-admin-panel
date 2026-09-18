import { Link } from 'react-router-dom'
import { useAdminGetDataSources, useAdminGetHealth } from '@/api/generated/admin'
import type { AdminDataSourceDto } from '@/api/generated/model'
import { Card, CardContent } from '@/components/ui/card'
import { apiErrorMessage } from '@/lib/apiError'
import { Status } from '../health/HealthPrimitives'
import { countsNeedingAttention } from './healthSummary'

/**
 * One line of system health, and a way to the page that explains it (#113).
 *
 * The dashboard answers "is anything wrong?" — the overall status from GET /admin/health plus how
 * many outside sources are not currently fine. Everything that answers "wrong with what, and since
 * when" lives on /health: repeating the full report here made the dashboard's other numbers scroll
 * off the screen, and said nothing the page does not say better.
 */
export function SystemHealthSection() {
  const health = useAdminGetHealth()
  const sources = useAdminGetDataSources()

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">System health</h2>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
          {health.error ? (
            <HealthError error={health.error} />
          ) : health.isLoading ? (
            <p className="text-gray-400">Loading health…</p>
          ) : (
            <p className="flex flex-wrap items-center gap-2">
              <Status status={health.data?.status} />
              <SourceSummary sources={sources.data} failed={Boolean(sources.error)} loading={sources.isLoading} />
            </p>
          )}

          <Link to="/health" className="underline decoration-gray-300 hover:decoration-gray-900">
            System health detail
          </Link>
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * How many sources there are, and how many an operator should look at. The inventory failing to
 * load is said plainly rather than left as a silent absence: "9 sources" with nothing after it
 * would read as "all fine".
 */
function SourceSummary({ sources, failed, loading }: {
  // The DTO the endpoint returns, not `ReturnType<typeof useAdminGetDataSources>['data']`: that hook
  // is generic over TData and overloaded, so ReturnType resolves the last overload with TData left
  // uninstantiated, and the prop silently lands as `{}` — which is what broke the build (#135).
  sources: AdminDataSourceDto[] | undefined
  failed: boolean
  loading: boolean
}) {
  if (failed) return <span className="text-amber-600">· couldn't read the data sources</span>
  if (loading || !sources) return null

  const total = sources.length
  const needingAttention = countsNeedingAttention(sources)

  return (
    <span className="text-gray-500">
      {`· ${total} ${total === 1 ? 'source' : 'sources'}`}
      {needingAttention > 0 && (
        <span className="text-amber-600">{` · ${needingAttention} ${needingAttention === 1 ? 'needs' : 'need'} attention`}</span>
      )}
    </span>
  )
}

function HealthError({ error }: { error: unknown }) {
  const { title } = apiErrorMessage(error)
  return (
    <p role="alert" className="text-red-700">{`Could not load system health: ${title}`}</p>
  )
}
