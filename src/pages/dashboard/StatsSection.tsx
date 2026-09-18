import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData } from '@tanstack/react-query'
import { Award, Building2, MapPin, Plane, Sofa, Users, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminGetStats } from '@/api/generated/admin'
import type { AdminEntityStatsDto, AdminStatsDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcDay, formatUtcMinute } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'
import { TrendColumns } from './TrendColumns'
import { verifiedPercent } from './verifiedPercent'

// GetAdminStatsQuery's periods, in the order the selector shows them.
const PERIODS = [
  { value: '24h', words: 'the last 24 hours' },
  { value: '7d', words: 'the last 7 days' },
  { value: '30d', words: 'the last 30 days' },
  { value: '90d', words: 'the last 90 days' },
]
const DEFAULT_PERIOD = '7d'

/** How each card the API returns is shown, keyed by its data browser table. */
const CARDS: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  travelers: { label: 'Travelers', icon: Users, color: 'text-blue-600' },
  flights: { label: 'Flights', icon: Plane, color: 'text-green-600' },
  airlines: { label: 'Airlines', icon: Building2, color: 'text-purple-600' },
  airports: { label: 'Airports', icon: MapPin, color: 'text-orange-600' },
  lounges: { label: 'Lounges', icon: Sofa, color: 'text-pink-600' },
  'loyalty-programs': { label: 'Loyalty Programs', icon: Award, color: 'text-yellow-600' },
}

const count = (n: number) => n.toLocaleString('en-US')
const gridLink = (table: string, filter: string) => `/data/${table}?${new URLSearchParams({ filter })}`
const linkClass = 'underline decoration-gray-300 hover:decoration-gray-900'

/**
 * The dashboard cards from GET /admin/stats: per entity, the total, what was added in the period
 * (linking to exactly those rows in the grid), verified and unverified counts (linking to each), and
 * a trend. The period is in the URL, so a view can be shared.
 */
export function StatsSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('period')
  // Anything else in the URL falls back to the default rather than asking the API for a 400.
  const period = PERIODS.some(p => p.value === requested) ? requested! : DEFAULT_PERIOD
  const { data, isLoading, error } = useAdminGetStats({ period }, { query: { placeholderData: keepPreviousData } })

  const choose = (value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('period', value)
    setSearchParams(next)
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        {data?.fromUtc && data.toUtc && <p className="text-sm text-gray-500">{windowLabel(data)}</p>}
        <div role="group" aria-label="Period" className="inline-flex overflow-hidden rounded-md border border-gray-200">
          {PERIODS.map(option => (
            <button
              key={option.value}
              type="button"
              aria-pressed={period === option.value}
              onClick={() => choose(option.value)}
              className={cn('px-3 py-1.5 text-sm', period === option.value ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
            >
              {option.value}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <StatsError error={error} />
      ) : isLoading || !data ? (
        <p className="text-sm text-gray-400">Loading stats…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data.entities ?? []).map(entity => (
            <StatCard
              key={entity.key}
              entity={entity}
              fromUtc={data.fromUtc ?? ''}
              bucket={data.bucket ?? 'day'}
              periodWords={PERIODS.find(p => p.value === data.period)?.words ?? `the last ${data.period}`}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** "Sep 8 – Sep 14 UTC" for days; to the minute for 24 hours. toUtc is exclusive. */
function windowLabel({ fromUtc, toUtc, bucket }: AdminStatsDto) {
  if (bucket === 'hour') return `${formatUtcMinute(fromUtc!)} – ${formatUtcMinute(toUtc!)} UTC`
  return `${formatUtcDay(new Date(fromUtc!))} – ${formatUtcDay(new Date(new Date(toUtc!).getTime() - 1))} UTC`
}

function StatCard({ entity, fromUtc, bucket, periodWords }: {
  entity: AdminEntityStatsDto
  fromUtc: string
  bucket: string
  periodWords: string
}) {
  const card = entity.key ? CARDS[entity.key] : undefined
  if (!card || !entity.key) return null
  const { label, icon: Icon, color } = card
  const key = entity.key
  const newRows = entity.newInPeriod ?? 0
  const share = verifiedPercent(entity.verified, entity.unverified)
  const headingId = `stat-card-${key}`

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle id={headingId} className="text-sm font-medium text-gray-500">{label}</CardTitle>
        <Icon className={`h-5 w-5 ${color}`} />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-3xl font-bold">{count(entity.total ?? 0)}</p>
        <div className="space-y-1 text-sm">
          {newRows > 0 ? (
            // The window's own start: the grid then lists exactly the rows this number counts.
            <Link to={gridLink(key, `${entity.dateColumn}:>=${new Date(fromUtc).toISOString()}`)} className={cn('font-medium text-gray-900', linkClass)}>
              {`+${count(newRows)} new`}
            </Link>
          ) : (
            <p className="text-gray-500">No new</p>
          )}
          {entity.verified != null && entity.unverified != null && (
            <p className="text-gray-500">
              <Link to={gridLink(key, 'IsVerified:true')} className={linkClass}>{`${count(entity.verified)} verified`}</Link>
              {/* Outside the link: each link names the rows it opens, and a share is not a set of
                  rows. Omitted, not zeroed, where there is no share to state — an empty table. */}
              {share !== undefined && ` (${share}%)`}
              {' · '}
              <Link to={gridLink(key, 'IsVerified:false')} className={linkClass}>{`${count(entity.unverified)} unverified`}</Link>
            </p>
          )}
        </div>
        <TrendColumns
          label={label}
          series={entity.series ?? []}
          fromUtc={fromUtc}
          bucket={bucket}
          summary={`${count(newRows)} added in ${periodWords}`}
        />
      </CardContent>
    </Card>
  )
}

function StatsError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`Could not load stats: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
