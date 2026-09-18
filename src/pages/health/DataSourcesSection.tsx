import { Fragment } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminGetDataSources } from '@/api/generated/admin'
import type { AdminDataSourceDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { Status } from './HealthPrimitives'

/**
 * How each catalog kind reads as a heading. A kind the API adds later falls back to its own name
 * rather than being dropped — an unlisted source must never become an invisible one, which is the
 * failure this whole feature exists to prevent.
 */
const KIND_LABELS: Record<string, string> = {
  Database: 'Database',
  FlightData: 'Flight data',
  ReferenceData: 'Reference data',
  Notifications: 'Notifications',
  Telemetry: 'Telemetry',
  Infrastructure: 'Infrastructure',
}

/**
 * Every outside dependency from GET /admin/health/sources, grouped by kind (#113).
 *
 * The status is rendered, never re-derived: the API draws the Degraded/Unhealthy line in one place
 * (DataSourceStatusEvaluator) so the two cannot disagree about what "healthy" means. This endpoint
 * runs no checks — it reads a small table — so it is cheap to refetch, unlike the live checks above.
 */
export function DataSourcesSection() {
  const { data, isLoading, error } = useAdminGetDataSources()

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Data sources</h2>
        <p className="text-sm text-gray-500">
          What each status is based on, when it was last seen working, and where to check it yourself.
        </p>
      </div>

      {error ? (
        <LoadError error={error} />
      ) : isLoading || !data ? (
        <p className="text-sm text-gray-400">Loading data sources…</p>
      ) : (
        <SourcesTable sources={data} />
      )}
    </section>
  )
}

function LoadError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load data sources: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function SourcesTable({ sources }: { sources: AdminDataSourceDto[] }) {
  if (sources.length === 0) return <p className="text-sm text-gray-500">No data sources reported.</p>

  // Grouped in the order the API sends them — the catalog's own order — rather than sorted here,
  // so the page's shape is the backend's decision and not a second one to keep in step.
  const kinds: string[] = []
  for (const source of sources) {
    const kind = source.kind ?? 'Other'
    if (!kinds.includes(kind)) kinds.push(kind)
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last OK</TableHead>
          <TableHead>Last checked</TableHead>
          <TableHead>What is checked</TableHead>
        </TableRow>
      </TableHeader>
      {kinds.map(kind => (
        // One rowgroup per kind, labelled: a screen reader reaches the heading the same way a
        // sighted reader sees it, rather than meeting a flat list of nine unrelated rows.
        <TableBody key={kind} aria-label={KIND_LABELS[kind] ?? kind}>
          <TableRow className="bg-gray-50 hover:bg-gray-50">
            <TableCell colSpan={5} className="py-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              {KIND_LABELS[kind] ?? kind}
            </TableCell>
          </TableRow>
          {sources.filter(source => (source.kind ?? 'Other') === kind).map(source => (
            <SourceRow key={source.key} source={source} />
          ))}
        </TableBody>
      ))}
    </Table>
  )
}

function SourceRow({ source }: { source: AdminDataSourceDto }) {
  const name = source.displayName ?? source.key ?? '—'

  return (
    <TableRow>
      <TableCell className="font-medium">
        {source.externalUrl ? (
          <a
            href={source.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-gray-300 hover:decoration-gray-900"
          >
            {name}
          </a>
        ) : (
          name
        )}
        {/* Only where it changes what a status means: an optional source's trouble is not an outage. */}
        {source.criticality === 'Optional' && <p className="text-xs text-gray-500">Optional</p>}
      </TableCell>

      <TableCell>
        <Status status={source.status} />
        {/* Never a bare "Unknown": an operator reading a gray row deserves to know it means nothing
            has called this source yet, not that a check came back inconclusive. */}
        {source.status === 'Unknown' && (
          <p className="text-xs text-gray-500">Not observed since deploy</p>
        )}
        {source.lastError && <p className="text-xs text-red-600">{source.lastError}</p>}
        {(source.consecutiveFailures ?? 0) > 1 && (
          <p className="text-xs text-amber-600">{`${source.consecutiveFailures} failures in a row`}</p>
        )}
      </TableCell>

      <TableCell className="text-sm"><Moment utc={source.lastOkUtc} /></TableCell>
      <TableCell className="text-sm">
        <Moment utc={source.lastOutcomeUtc} />
        {source.lastProbeUtc && (
          <p className="text-xs text-gray-500">
            {`Checked by hand ${formatUtcMinute(source.lastProbeUtc)} UTC${source.lastProbeBy ? ` by ${source.lastProbeBy}` : ''}`}
          </p>
        )}
      </TableCell>

      <TableCell className="text-sm text-gray-700">{source.whatIsChecked}</TableCell>
    </TableRow>
  )
}

/** A UTC minute, or an em dash — never "now" or a guess — for a moment that has not happened yet. */
function Moment({ utc }: { utc: string | null | undefined }) {
  if (!utc) return <span className="text-gray-400">—</span>
  return <Fragment>{`${formatUtcMinute(utc)} UTC`}</Fragment>
}
