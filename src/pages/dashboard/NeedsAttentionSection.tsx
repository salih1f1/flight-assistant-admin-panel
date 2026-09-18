import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useAdminGetVerificationNeedsAttention } from '@/api/generated/admin'
import type { VerificationNeedsAttentionDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { cn } from '@/lib/utils'
import { VERIFICATION_ENTITY_TYPES } from '@/pages/data/verificationChecks'
import { needsAttentionSummary } from './needsAttentionSummary'

// entityType -> grid slug, derived from VERIFICATION_ENTITY_TYPES (slug -> entityType) so the two
// directions can't drift into two different literal maps.
const SLUG_BY_ENTITY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(VERIFICATION_ENTITY_TYPES).map(([slug, entityType]) => [entityType, slug]),
)

const gridLink = (slug: string) => `/data/${slug}?${new URLSearchParams({ filter: 'VerificationIssue:*' })}`
// The slugs are already the plural table names (airports, airlines, countries), so capitalizing is
// the whole label; no separate display-name map to keep in sync with SLUG_BY_ENTITY_TYPE.
const label = (slug: string) => slug[0].toUpperCase() + slug.slice(1)

/**
 * Rows needing an operator's attention, from GET /admin/verification-needs-attention: always
 * Airport, Airline and Country, zero-filled. Sits above the system health section.
 *
 * The card carries its own state, so a dashboard can be scanned rather than read: flagged rows turn
 * it amber and put the total beside the heading, while a report with nothing in it collapses to one
 * quiet line. Amber, not red, is the panel's colour for "a human should look at this"
 * (verificationState.ts); red here stays what it is elsewhere — something broke — and is left to
 * the error state below.
 */
export function NeedsAttentionSection() {
  const { data, isLoading, error } = useAdminGetVerificationNeedsAttention()
  // Undefined whenever there is nothing to raise: no data yet, a failed read, or all-zero counts.
  const summary = data && !error ? needsAttentionSummary(data) : undefined

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-gray-900">Needs attention</h2>
        {summary && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-medium text-amber-800">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            {summary}
          </span>
        )}
      </div>
      <Card className={cn(summary && 'border-amber-300 bg-amber-50')}>
        <CardContent className="pt-6">
          {error ? (
            <NeedsAttentionError error={error} />
          ) : isLoading || !data ? (
            <p className="text-sm text-gray-400">Loading needs attention…</p>
          ) : summary ? (
            <NeedsAttentionCounts counts={data} />
          ) : (
            <NothingToDo />
          )}
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * The all-clear. One line rather than three zeroed-out counts: a zero is read digit by digit, and
 * three of them take up as much of the dashboard — and as much of an operator's attention — as the
 * state that actually wants some.
 */
function NothingToDo() {
  return (
    <p className="flex items-center gap-2 text-sm text-gray-600">
      <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-green-600" />
      Nothing needs attention
    </p>
  )
}

function NeedsAttentionError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`Could not load needs-attention counts: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function NeedsAttentionCounts({ counts }: { counts: VerificationNeedsAttentionDto[] }) {
  return (
    <dl className="grid grid-cols-3 gap-4">
      {counts.map(entry => <NeedsAttentionStat key={entry.entityType ?? ''} entry={entry} />)}
    </dl>
  )
}

/**
 * One entity type's count. Only the flagged ones are coloured: the grid is shown at all only when
 * something needs attention, so a zero among them is a type with nothing to do, and muting it is
 * what leaves the eye on the counts that lead somewhere.
 */
function NeedsAttentionStat({ entry: { entityType, count } }: { entry: VerificationNeedsAttentionDto }) {
  const slug = entityType ? SLUG_BY_ENTITY_TYPE[entityType] : undefined
  const n = count ?? 0
  const flagged = n > 0

  return (
    <div>
      <dt className={cn('text-sm', flagged ? 'text-amber-800' : 'text-gray-500')}>{slug ? label(slug) : (entityType ?? 'Unknown')}</dt>
      <dd className={cn('text-2xl font-semibold', flagged ? 'text-amber-900' : 'text-gray-400')}>
        {flagged && slug ? (
          <Link to={gridLink(slug)} className="underline decoration-amber-400 hover:decoration-amber-900">{n}</Link>
        ) : n}
      </dd>
    </div>
  )
}
