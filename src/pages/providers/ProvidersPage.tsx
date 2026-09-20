import { useAdminGetProviderRoutes } from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { CallMapSection } from './CallMapSection'
import { HeadroomSection } from './HeadroomSection'
import { RoutingSection } from './RoutingSection'

/**
 * Which external provider serves which job, and the room left on each (backend #531).
 *
 * The switch exists for cost steering: moving a job to the cheaper provider as budgets change,
 * without a deploy. So the page puts the three things that decision needs together — what can be
 * changed, what is called when, and how much headroom is left.
 *
 * One query feeds all three sections. `GET /admin/providers` returns routes, operations and
 * headroom in one response, so the loading and error states belong here rather than three times
 * over: three spinners for one request reads as three requests, and three copies of the same
 * failure reads as three failures.
 */
export function ProvidersPage() {
  const { data, isLoading, error } = useAdminGetProviderRoutes()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Providers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Which external provider serves which job, what each costs, and how much room is left.
        </p>
      </div>

      {error ? (
        <ProvidersError error={error} />
      ) : isLoading || !data ? (
        <p className="text-sm text-gray-400">Loading providers…</p>
      ) : (
        <>
          <RoutingSection routes={data.routes ?? []} />
          <CallMapSection operations={data.operations ?? []} />
          <HeadroomSection headroom={data.headroom ?? []} />
        </>
      )}
    </div>
  )
}

function ProvidersError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load the providers: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
