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

// FlightAware's own usage page, for reconciling these numbers against the source.
const AEROAPI_PORTAL_URL = 'https://www.flightaware.com/aeroapi/portal/'

/**
 * How long a call made right now would wait in our outbound queue, or null when nothing is queued.
 *
 * Null rather than "available now" (#116): an idle throttle is the normal state, so that line spent
 * most of its life telling the reader nothing. It earns its place only when there IS a wait, which
 * is exactly when it explains a slow search.
 *
 * A slot already in the past is also null. This report is served from a 10-minute server-side
 * cache, so a due slot is stale data — rendering it would claim a wait that has already elapsed.
 */
function untilNextSlot(nextSlotUtc: string | null | undefined): string | null {
  if (!nextSlotUtc) return null
  const seconds = Math.ceil((new Date(nextSlotUtc).getTime() - Date.now()) / 1000)
  if (seconds <= 0) return null
  return seconds < 60 ? `~${seconds}s` : `~${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * Average spend per day so far, and whole days left in the period — or null before a full day has
 * elapsed, where dividing by a fraction reports a wild daily rate from a few minutes of data.
 *
 * Deliberately not a projected month-end total (#116). Spend is driven by the verification and
 * sync jobs, which run in bursts, so extrapolating linearly would put a confident wrong number on
 * a budget gauge — the kind of number people act on.
 */
function spendPace(usage: AeroApiUsageDto): { perDay: number; daysLeft: number } | null {
  const { rangeStartUtc, rangeEndUtc, totalCostUsd } = usage
  if (!rangeStartUtc || !rangeEndUtc) return null

  const start = new Date(rangeStartUtc)
  const end = new Date(rangeEndUtc)
  const daysElapsed = (end.getTime() - start.getTime()) / 86_400_000
  if (!(daysElapsed >= 1)) return null

  // The period is the calendar month the range starts in, which is what the budget is set against.
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()

  return {
    perDay: (totalCostUsd ?? 0) / daysElapsed,
    // Floor what REMAINS, not what has elapsed. Part-way through the 13th, 12.8 days are gone and
    // 17.2 remain; flooring the elapsed figure instead would promise 18 whole days that are not
    // there. A budget figure should round against the reader, not for them.
    daysLeft: Math.max(0, Math.floor(daysInMonth - daysElapsed)),
  }
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">AeroAPI usage</h2>
        <a
          href={AEROAPI_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 underline decoration-gray-300 hover:decoration-gray-900"
        >
          Check on FlightAware ↗
        </a>
      </div>
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
  const pace = spendPace(usage)
  const discount = usage.totalDiscountCostUsd ?? 0
  const waiting = untilNextSlot(usage.nextSlotUtc)

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
        {pace && (
          <p className="text-sm text-gray-500">
            {`${usd.format(pace.perDay)} a day so far · ${pace.daysLeft} days left in the month`}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Calls" value={usage.totalCalls ?? 0} />
        {/* FlightAware bills per page: a four-page search is four units. */}
        <Stat label="Pages billed" value={usage.totalPages ?? 0} />
        <Stat label="Failed calls" value={usage.totalFailedCalls ?? 0} />
        {/* Only when there is one: a permanent "$0.00 discount" tile is noise. */}
        {discount > 0 && <Stat label="Discount" value={usd.format(discount)} />}
      </dl>

      {operations.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operation</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Pages</TableHead>
              {/* Already in the response and previously dropped (#116): the totals could say
                  "9 failed calls" with nothing saying which operation they came from. */}
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operations.map(op => (
              <TableRow key={op.operation}>
                <TableCell className="font-mono text-xs">{op.operation}</TableCell>
                <TableCell className="text-right">{op.calls ?? 0}</TableCell>
                <TableCell className="text-right">{op.pages ?? 0}</TableCell>
                {/* Amber only when something actually failed — a column of coloured zeroes would
                    make a healthy table look alarming. FlightAware bills failed calls too, so a
                    failure here is spend with nothing to show for it. */}
                <TableCell className={cn('text-right', (op.failedCalls ?? 0) > 0 ? 'text-amber-600' : 'text-gray-400')}>
                  {op.failedCalls ?? 0}
                </TableCell>
                <TableCell className="text-right">{usd.format(op.costUsd ?? 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {waiting && (
        <p className="text-sm text-gray-500">
          {`Outbound throttle: the next call waits ${waiting}. `}
          <span className="text-gray-400">
            Our own queue, not a FlightAware limit — the personal tier allows about 5 calls a minute,
            so calls are spaced out here before they are sent.
          </span>
        </p>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  )
}
