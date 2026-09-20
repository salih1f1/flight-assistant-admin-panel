import type { AdminProviderHeadroomDto } from '@/api/generated/model'
import { Card, CardContent } from '@/components/ui/card'
import { Status } from '@/pages/health/HealthPrimitives'
import { formatUtcMinute } from '@/lib/formatUtc'

/**
 * How much room is left on each provider (backend #531).
 *
 * The number a steering decision turns on. Both figures come from the provider itself — AeroAPI's
 * own usage report, AeroDataBox's own rate-limit headers — never from anything counted locally,
 * because one bills per page including failed calls and the other is quota-based, so a local tally
 * would be wrong in both directions.
 *
 * **A missing figure reads as unknown, never as zero.** AeroDataBox reports nothing until this
 * instance has actually called it, so rendering 0 would show an exhausted plan on every fresh
 * deploy — a fault invented out of an absence. The backend is careful to send null rather than 0
 * for exactly this reason and the panel must not undo it. Same rule the data-source rows follow for
 * NotConfigured, and the reason `Status` treats a missing status as Unknown rather than healthy.
 */
export function HeadroomSection({ headroom }: { headroom: AdminProviderHeadroomDto[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Headroom</h2>
        <p className="text-sm text-gray-500">
          What each provider reports about itself. Nothing here is counted locally.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {headroom.map(row => <HeadroomCard key={row.provider} row={row} />)}
      </div>
    </section>
  )
}

function HeadroomCard({ row }: { row: AdminProviderHeadroomDto }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6 text-sm">
        <h3 className="font-medium text-gray-900">{row.provider}</h3>

        {/* A metered provider carries a budget state and a spend; a free, quota-based one carries
            neither, and an absent state is not a healthy one — Status renders it as Unknown. Only
            shown when the API sent something, so a free provider does not sprout an empty row. */}
        {row.budgetState != null && (
          <p className="text-gray-500">
            Budget: <Status status={row.budgetState} />
          </p>
        )}

        {(row.spentUsd != null || row.budgetUsd != null) && (
          <p className="text-gray-500">
            {`Spent ${money(row.spentUsd)} of ${money(row.budgetUsd)} this month`}
          </p>
        )}

        {row.quotaLimit != null && (
          <p className="text-gray-500">
            {`Quota ${count(row.quotaRemaining)} of ${count(row.quotaLimit)} left`}
          </p>
        )}

        {/* Said plainly rather than left blank. A quota this process has never observed is the
            normal state right after a deploy, and a blank cell invites the reader to supply the
            wrong explanation. */}
        {row.quotaLimit == null && row.quotaRemaining == null && row.budgetState == null && (
          <p className="text-gray-400">Quota unknown — this instance has not called it yet.</p>
        )}

        {row.observedUtc != null && (
          <p className="text-xs text-gray-400">{`Observed ${formatUtcMinute(row.observedUtc)} UTC`}</p>
        )}
      </CardContent>
    </Card>
  )
}

/** A missing amount is unknown, never 0.00 — see the section's own remarks. */
const money = (value: number | null | undefined) =>
  value == null ? 'unknown' : `$${value.toFixed(2)}`

/** A missing count is unknown, never 0 — the figure that would read as an exhausted plan. */
const count = (value: number | null | undefined) =>
  value == null ? 'unknown' : value.toLocaleString('en-US')
