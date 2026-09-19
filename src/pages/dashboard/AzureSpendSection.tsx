import { Card, CardContent } from '@/components/ui/card'
import { useAdminGetAzureBudget } from '@/api/generated/admin'
import type { AzureBudgetDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'

// The API caches for an hour, because Azure's own data only moves every few hours.
const SERVER_CACHE_MS = 60 * 60 * 1000

const NEAR_BUDGET_PERCENT = 80

/**
 * Formats in the currency Azure reported. Never assumes USD: the billing currency is a property of
 * the subscription's account, and rendering EUR with a dollar sign would misstate the figure by a
 * meaningful factor.
 */
const money = (amount: number, currency: string | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)

/**
 * What each non-Ok state says, and how loudly. Gray for the two that are setup states rather than
 * faults — the same rule the data-source rows follow for NotConfigured, where a deliberate or
 * unfinished configuration must not read like a failure.
 */
const STATE_LINE: Record<string, { label: string; tone: string }> = {
  NotConfigured: { label: 'Not configured', tone: 'text-gray-500' },
  NotAuthorized: { label: 'Not authorized', tone: 'text-gray-500' },
  Unavailable: { label: 'Unavailable', tone: 'text-amber-600' },
}

/**
 * Azure subscription spend against the budget defined in Cost Management (#182).
 *
 * Sits directly below the AeroAPI gauge because both answer "what is this costing" — but the two
 * are not the same kind of number, and this section has to say so: AeroAPI's figure is near-live,
 * Azure's lags several hours. Neither Cost Management endpoint reports how stale its own answer is,
 * so the delay is stated generically rather than as a timestamp we would be inventing.
 */
export function AzureSpendSection() {
  const { data, isLoading, error } = useAdminGetAzureBudget({ query: { staleTime: SERVER_CACHE_MS } })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Azure spend</h2>
      <Card>
        <CardContent className="space-y-4 pt-6">
          {error ? (
            <BudgetError error={error} />
          ) : isLoading || !data ? (
            <p className="text-sm text-gray-400">Loading Azure spend…</p>
          ) : (
            <BudgetReport budget={data} />
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function BudgetError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load Azure spend: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function BudgetReport({ budget }: { budget: AzureBudgetDto }) {
  const state = budget.state ?? 'Unavailable'

  // Anything but Ok or NoBudget carries no figure at all, by design: the API refuses to send a
  // spend-less Ok precisely so this never has to guess. One line, no gauge.
  const line = STATE_LINE[state]
  if (line) {
    return (
      <div className="space-y-1">
        <p className={cn('text-sm font-medium', line.tone)}>{line.label}</p>
        {budget.message && <p className="text-xs text-gray-500">{budget.message}</p>}
      </div>
    )
  }

  const spend = budget.currentSpendAmount ?? 0
  const amount = budget.budgetAmount
  const currency = budget.currency

  return (
    <div className="space-y-2">
      {/* No budget defined in Azure: the spend is still worth showing, but there is nothing to
          draw a gauge against, and a bar with no limit would imply one. */}
      {amount == null ? (
        <>
          <p className="text-3xl font-bold">{money(spend, currency)}</p>
          <p className="text-sm text-gray-500">No budget is defined in Azure for this subscription.</p>
        </>
      ) : (
        <Gauge spend={spend} amount={amount} currency={currency} />
      )}

      <Period startUtc={budget.periodStartUtc} endUtc={budget.periodEndUtc} />

      {/* Azure reports cost on a delay, and neither Cost Management endpoint says how long — so
          this is the honest form of the warning. The AeroAPI gauge directly above is near-live,
          and without this line the two invite being read as the same kind of number. */}
      <p className="text-xs text-gray-400">
        Azure reports cost on a delay, usually several hours. These figures are not live.
      </p>
    </div>
  )
}

function Gauge({ spend, amount, currency }: { spend: number; amount: number; currency: string | null | undefined }) {
  const percent = amount > 0 ? Math.round((spend / amount) * 100) : 0
  const overBudget = percent >= 100
  const nearBudget = !overBudget && percent >= NEAR_BUDGET_PERCENT

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-3xl font-bold">{`${money(spend, currency)} of ${money(amount, currency)}`}</p>
        {overBudget && <span className="text-sm font-medium text-red-600">Over budget</span>}
        {nearBudget && <span className="text-sm font-medium text-amber-600">Near budget</span>}
      </div>

      {/* Same treatment as the AeroAPI gauge above, so the two read as a pair. */}
      <div
        role="progressbar"
        aria-label="Azure budget used"
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
      <p className="text-sm text-gray-500">{`${percent}% of budget`}</p>
    </>
  )
}

/**
 * The budget's real period. Never "this month": an Azure budget can be quarterly or annual, and
 * calling a quarterly one monthly would misstate both the figure and how much of it remains.
 */
function Period({ startUtc, endUtc }: { startUtc: string | null | undefined; endUtc: string | null | undefined }) {
  if (!startUtc || !endUtc) return null
  return (
    <p className="text-xs text-gray-400">{`${formatUtcMinute(startUtc)} – ${formatUtcMinute(endUtc)} UTC`}</p>
  )
}
