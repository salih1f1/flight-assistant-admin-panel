import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminGetAeroApiUsage } from '@/api/generated/admin'
import type { AeroApiUsageDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'

// The API caches the upstream report for 10 minutes, so refetching sooner shows nothing new.
const SERVER_CACHE_MS = 10 * 60 * 1000

// Spend at or above this share of the budget is flagged before the budget is reached.
const NEAR_BUDGET_PERCENT = 80

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function untilNextSlot(nextSlotUtc: string | null | undefined): string {
  const seconds = nextSlotUtc ? Math.ceil((new Date(nextSlotUtc).getTime() - Date.now()) / 1000) : 0
  if (seconds <= 0) return 'available now'
  return seconds < 60 ? `in ${seconds}s` : `in ${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * AeroAPI spend for the current UTC month, from FlightAware's own usage report
 * (GET /admin/usage/aeroapi). FlightAware bills per page and bills failed calls,
 * so the cost here is what the invoice will say, not a local estimate.
 */
export function AeroApiUsageSection() {
  // No range is sent: the API's default (month to date, end floored onto its cache
  // grid) is what its cache is keyed on.
  const { data, isLoading, error } = useAdminGetAeroApiUsage(undefined, { query: { staleTime: SERVER_CACHE_MS } })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">AeroAPI usage</h2>
      <Card>
        <CardContent className="space-y-6 pt-6">
          {error ? (
            <UsageError error={error} />
          ) : isLoading || !data ? (
            <p className="text-sm text-gray-400">Loading usage…</p>
          ) : (
            <UsageReport usage={data} />
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function UsageError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load AeroAPI usage: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function UsageReport({ usage }: { usage: AeroApiUsageDto }) {
  const cost = usage.totalCostUsd ?? 0
  const budget = usage.monthlyBudgetUsd ?? 0
  const percent = budget > 0 ? Math.round((cost / budget) * 100) : null
  const overBudget = percent !== null && percent >= 100
  const nearBudget = percent !== null && !overBudget && percent >= NEAR_BUDGET_PERCENT
  const operations = [...(usage.byOperation ?? [])].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-3xl font-bold">{`${usd.format(cost)} of ${usd.format(budget)}`}</p>
          {overBudget && <span className="text-sm font-medium text-red-600">Budget reached</span>}
          {nearBudget && <span className="text-sm font-medium text-amber-600">Near budget</span>}
        </div>
        {percent !== null ? (
          <>
            <div
              role="progressbar"
              aria-label="Monthly budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(percent, 100)}
              className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
            >
              <div
                className={cn('h-full rounded-full', overBudget ? 'bg-red-500' : nearBudget ? 'bg-amber-500' : 'bg-blue-500')}
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
            <p className="text-sm text-gray-500">{`${percent}% of monthly budget`}</p>
          </>
        ) : (
          <p className="text-sm text-gray-500">No monthly budget is configured.</p>
        )}
        {usage.rangeStartUtc && usage.rangeEndUtc && (
          <p className="text-xs text-gray-400">{`${formatUtcMinute(usage.rangeStartUtc)} – ${formatUtcMinute(usage.rangeEndUtc)} UTC`}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Calls" value={usage.totalCalls ?? 0} />
        {/* FlightAware bills per page: a four-page search is four units. */}
        <Stat label="Pages billed" value={usage.totalPages ?? 0} />
        <Stat label="Failed calls" value={usage.totalFailedCalls ?? 0} />
      </dl>

      {operations.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operation</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Pages</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operations.map(op => (
              <TableRow key={op.operation}>
                <TableCell className="font-mono text-xs">{op.operation}</TableCell>
                <TableCell className="text-right">{op.calls ?? 0}</TableCell>
                <TableCell className="text-right">{op.pages ?? 0}</TableCell>
                <TableCell className="text-right">{usd.format(op.costUsd ?? 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-sm text-gray-500">{`Next AeroAPI slot: ${untilNextSlot(usage.nextSlotUtc)}`}</p>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  )
}
