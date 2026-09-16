import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { useAdminGetVerificationNeedsAttention } from '@/api/generated/admin'
import type { VerificationNeedsAttentionDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { VERIFICATION_ENTITY_TYPES } from '@/pages/data/verificationChecks'

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
 * Airport, Airline and Country, zero-filled, so a healthy count still renders as plain text rather
 * than the row disappearing. Sits above the system health section.
 */
export function NeedsAttentionSection() {
  const { data, isLoading, error } = useAdminGetVerificationNeedsAttention()

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Needs attention</h2>
      <Card>
        <CardContent className="pt-6">
          {error ? (
            <NeedsAttentionError error={error} />
          ) : isLoading || !data ? (
            <p className="text-sm text-gray-400">Loading needs attention…</p>
          ) : (
            <NeedsAttentionCounts counts={data} />
          )}
        </CardContent>
      </Card>
    </section>
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

function NeedsAttentionStat({ entry: { entityType, count } }: { entry: VerificationNeedsAttentionDto }) {
  const slug = entityType ? SLUG_BY_ENTITY_TYPE[entityType] : undefined
  const n = count ?? 0

  return (
    <div>
      <dt className="text-sm text-gray-500">{slug ? label(slug) : (entityType ?? 'Unknown')}</dt>
      <dd className="text-2xl font-semibold">
        {n > 0 && slug ? (
          <Link to={gridLink(slug)} className="underline decoration-gray-300 hover:decoration-gray-900">{n}</Link>
        ) : n}
      </dd>
    </div>
  )
}
