import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAdminGetAeroApiUsage, useAdminListVerificationSources, useAdminQueueVerificationRequests } from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { costLine, formatUsd } from './verificationCost'

// Matches the dashboard's AeroApiUsageSection: the API caches the upstream usage report for 10
// minutes, so refetching sooner shows nothing new. Passing the same (empty) params as that section
// means this query and the dashboard's share one cache entry.
const SERVER_CACHE_MS = 10 * 60 * 1000

/**
 * The "Against sources" side of the Verify dialog: lists the outside sources that can check
 * `entityType`, lets the admin pick which ones, and queues POST /admin/verification-requests for
 * `keys` against the checked sources. Self-contained — VerifyDialog only supplies what to check and
 * against what type; the rest (loading, checked sources, the in-flight queue request) is local here.
 *
 * Nothing is invalidated on success: the rows behind the dialog change only once the queued job
 * actually runs, not immediately, so there is nothing yet worth refetching for.
 */
export function SourceVerifyPanel({ entityType, keys }: { entityType: 'Airport' | 'Airline' | 'Country'; keys: string[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const sources = useAdminListVerificationSources({ entityType })
  const usage = useAdminGetAeroApiUsage(undefined, { query: { staleTime: SERVER_CACHE_MS } })
  const queue = useAdminQueueVerificationRequests()

  const toggleSource = (name: string) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })

  if (sources.isLoading) return <p className="text-sm text-gray-400">Loading sources…</p>

  if (sources.error) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <p>{`Could not load sources: ${apiErrorMessage(sources.error).title}`}</p>
      </div>
    )
  }

  const list = sources.data ?? []
  if (list.length === 0) {
    return <p className="text-sm text-gray-500">No outside source can check these rows yet.</p>
  }

  // The API's own listed order, not the order the admin happened to check them in — that's what
  // goes on the wire.
  const checkedSources = list.filter(source => source.name && checked.has(source.name))
  const perRowUsd = checkedSources.reduce((sum, source) => sum + (source.costPerRowUsd ?? 0), 0)
  // Left out while loading or on failure — the cost line still works without it, and a flaky AeroAPI
  // usage report must never block queueing a check.
  const month = usage.data ? { spentUsd: usage.data.totalCostUsd ?? 0, budgetUsd: usage.data.monthlyBudgetUsd ?? 0 } : undefined

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {list.map(source => (
          <li key={source.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={source.name ?? ''}
              checked={!!source.name && checked.has(source.name)}
              disabled={queue.isSuccess}
              onChange={() => source.name && toggleSource(source.name)}
            />
            <span>{source.name}</span>
            <span className="text-xs text-gray-500">{`${formatUsd(source.costPerRowUsd ?? 0)} per row`}</span>
          </li>
        ))}
      </ul>

      {checkedSources.length > 0 && (
        <p className="text-sm text-gray-700">{costLine(keys.length, perRowUsd, month)}</p>
      )}

      {queue.isSuccess ? (
        <p className="text-sm text-gray-700">{`Queued ${queue.data.queued ?? 0} · skipped ${queue.data.skipped ?? 0}`}</p>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={checkedSources.length === 0 || queue.isPending}
          onClick={() => queue.mutate({ data: { entityType, keys, sources: checkedSources.map(source => source.name!) } })}
        >
          Start
        </Button>
      )}

      {queue.error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{`Couldn't queue checks: ${apiErrorMessage(queue.error).title}`}</p>
          {apiErrorMessage(queue.error).detail && <p className="mt-1 text-xs text-red-600">{apiErrorMessage(queue.error).detail}</p>}
        </div>
      )}
    </div>
  )
}
