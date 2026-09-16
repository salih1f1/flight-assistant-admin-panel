import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminGetHealth } from '@/api/generated/admin'
import type {
  AdminHealthDto, AdminHealthFlightSyncDto, AdminHealthMigrationsDto, AdminHealthSystemDto, AdminHealthVerificationDto,
} from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'

// HealthStatus names as the API sends them.
const statusColor: Record<string, string> = {
  Healthy: 'text-green-600',
  Degraded: 'text-amber-600',
  Unhealthy: 'text-red-600',
}

function Status({ status }: { status: string | null | undefined }) {
  const name = status ?? 'Unknown'
  return <span className={cn('font-medium', statusColor[name] ?? 'text-gray-500')}>{name}</span>
}

/**
 * Operator health from GET /admin/health. The endpoint always answers 200 and puts
 * the overall status in the body, so an unhealthy API still renders its report here;
 * only a failure to produce the report at all shows as an error.
 *
 * Refetching is cheap: none of the checks spend AeroAPI quota (the aeroapi check is
 * a HEAD to the base URL on its own client, outside the throttle).
 */
export function SystemHealthSection() {
  const { data, isLoading, error } = useAdminGetHealth()

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">System health</h2>
      <Card>
        <CardContent className="space-y-6 pt-6">
          {error ? (
            <HealthError error={error} />
          ) : isLoading || !data ? (
            <p className="text-sm text-gray-400">Loading health…</p>
          ) : (
            <HealthReport health={data} />
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function HealthError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load system health: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function HealthReport({ health }: { health: AdminHealthDto }) {
  const checks = health.checks ?? []

  return (
    <>
      <p className={cn('text-xl font-medium', statusColor[health.status ?? ''] ?? 'text-gray-500')}>
        {`Overall: ${health.status ?? 'Unknown'}`}
      </p>

      {checks.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map(check => (
              <TableRow key={check.name}>
                <TableCell className="font-mono text-xs">{check.name}</TableCell>
                <TableCell><Status status={check.status} /></TableCell>
                <TableCell className="text-right">{`${check.durationMs ?? 0} ms`}</TableCell>
                <TableCell className="text-sm">
                  {check.description}
                  {/* Exception detail; the API only sends it outside Production. */}
                  {check.error && <p className="text-xs text-red-600">{check.error}</p>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-gray-500">No checks reported.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Migrations migrations={health.migrations} />
        <FlightSync sync={health.flightSync} />
        <Verification verification={health.verification} />
      </div>

      <SystemFacts system={health.system} />
    </>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border border-gray-200 p-4 text-sm">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {children}
    </div>
  )
}

function Migrations({ migrations }: { migrations: AdminHealthMigrationsDto | undefined }) {
  if (!migrations?.available) {
    // "Can't tell" is a different claim from "none pending", so it never reads as one.
    return (
      <Panel title="Migrations">
        <p className="text-amber-600">Couldn't read migration state</p>
        {migrations?.error && <p className="text-xs text-red-600">{migrations.error}</p>}
      </Panel>
    )
  }

  const pending = migrations.pending ?? []
  return (
    <Panel title="Migrations">
      {pending.length > 0 ? (
        <>
          <p className="text-amber-600">{`${pending.length} pending`}</p>
          <ul className="list-inside list-disc font-mono text-xs">
            {pending.map(name => <li key={name}>{name}</li>)}
          </ul>
        </>
      ) : (
        <p className="text-green-600">None pending</p>
      )}
      <p className="text-xs text-gray-500">
        {migrations.lastAppliedMigration
          ? `${migrations.appliedCount ?? 0} applied, last ${migrations.lastAppliedMigration}`
          : `${migrations.appliedCount ?? 0} applied`}
      </p>
    </Panel>
  )
}

function FlightSync({ sync }: { sync: AdminHealthFlightSyncDto | undefined }) {
  if (sync && sync.enabled === false) {
    return (
      <Panel title="Flight status sync">
        <p className="text-gray-500">Disabled (FlightSync:Enabled is false)</p>
      </Panel>
    )
  }

  const lastRunAt = sync?.lastRunCompletedUtc ?? sync?.lastRunStartedUtc
  const finished = sync?.lastOutcome === 'Success' || sync?.lastOutcome === 'Failed'

  return (
    <Panel title="Flight status sync">
      {sync?.lastOutcome === 'Running' && sync.lastRunStartedUtc ? (
        <p>{`Running since ${formatUtcMinute(sync.lastRunStartedUtc)} UTC`}</p>
      ) : finished && lastRunAt ? (
        <p className={sync?.lastOutcome === 'Failed' ? 'text-red-600' : 'text-green-600'}>
          {`Last run ${sync?.lastOutcome === 'Failed' ? 'failed' : 'succeeded'} at ${formatUtcMinute(lastRunAt)} UTC`}
        </p>
      ) : (
        <p className="text-gray-500">Not run since the API started</p>
      )}
      {finished && (
        <p className="text-xs text-gray-500">{`${sync?.flightsProcessed ?? 0} flights processed, ${sync?.flightsFailed ?? 0} failed`}</p>
      )}
      {sync?.lastError && <p className="text-xs text-red-600">{sync.lastError}</p>}
      {sync?.nextRunDueUtc && <p className="text-xs text-gray-500">{`Next run ${formatUtcMinute(sync.nextRunDueUtc)} UTC`}</p>}
    </Panel>
  )
}

/** "1 thing" / "2 things": simple pluralization for the two abnormal-only counts below. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function Verification({ verification }: { verification: AdminHealthVerificationDto | undefined }) {
  if (verification && verification.enabled === false) {
    return (
      <Panel title="Verification">
        <p className="text-gray-500">Disabled (Verification:Enabled is false)</p>
      </Panel>
    )
  }

  const lastRunAt = verification?.lastRunCompletedUtc ?? verification?.lastRunStartedUtc
  const finished = verification?.lastOutcome === 'Success' || verification?.lastOutcome === 'Failed'
  const stuckAbandoned = verification?.stuckAbandoned ?? 0
  const failuresUnrecorded = verification?.failuresUnrecorded ?? 0

  return (
    <Panel title="Verification">
      {verification?.lastOutcome === 'Running' && verification.lastRunStartedUtc ? (
        <p>{`Running since ${formatUtcMinute(verification.lastRunStartedUtc)} UTC`}</p>
      ) : finished && lastRunAt ? (
        <p className={verification?.lastOutcome === 'Failed' ? 'text-red-600' : 'text-green-600'}>
          {`Last run ${verification?.lastOutcome === 'Failed' ? 'failed' : 'succeeded'} at ${formatUtcMinute(lastRunAt)} UTC`}
        </p>
      ) : (
        <p className="text-gray-500">Not run since the API started</p>
      )}
      {finished && (
        <p className="text-xs text-gray-500">{`${verification?.requestsProcessed ?? 0} requests processed, ${verification?.requestsFailed ?? 0} failed`}</p>
      )}
      {/* "Cannot tell" is a different claim from "none pending" (see Migrations above), so a null
          count never renders as 0 — and, matching Migrations' own "can't tell" state, it's amber
          rather than the neutral gray a known count gets. */}
      <p className={cn('text-xs', verification?.pendingCount == null ? 'text-amber-600' : 'text-gray-500')}>
        {verification?.pendingCount == null ? "Can't tell how many are pending" : `${verification.pendingCount} pending`}
      </p>
      {stuckAbandoned > 0 && <p className="text-xs text-amber-600">{plural(stuckAbandoned, 'stuck request')}</p>}
      {failuresUnrecorded > 0 && <p className="text-xs text-amber-600">{plural(failuresUnrecorded, 'unrecorded failure')}</p>}
      {verification?.lastError && <p className="text-xs text-red-600">{verification.lastError}</p>}
      {verification?.nextRunDueUtc && <p className="text-xs text-gray-500">{`Next run ${formatUtcMinute(verification.nextRunDueUtc)} UTC`}</p>}
    </Panel>
  )
}

/** A .NET TimeSpan as System.Text.Json writes it ("3.04:12:09.1234567", "00:07:30") to "3d 4h 12m". */
function formatUptime(timeSpan: string | undefined): string {
  const match = timeSpan?.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/)
  if (!match) return timeSpan ?? '—'
  const [days, hours, minutes] = [Number(match[1] ?? 0), Number(match[2]), Number(match[3])]
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function SystemFacts({ system }: { system: AdminHealthSystemDto | undefined }) {
  // A local build has no build SHA; the API sends null rather than a placeholder.
  const version = system?.buildSha ? `${system.version} (${system.buildSha})` : system?.version ?? '—'
  const configured = (value: boolean | undefined) => (value ? 'Configured' : 'Not configured')

  return (
    <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
      <Fact label="Environment" value={system?.environment ?? '—'} />
      <Fact label="Version" value={version} />
      <Fact label="Runtime" value={system?.frameworkDescription ?? '—'} />
      <Fact label="Uptime" value={formatUptime(system?.uptime)} />
      <Fact label="Redis" value={configured(system?.redisConfigured)} />
      <Fact label="App Insights" value={configured(system?.appInsightsConfigured)} />
    </dl>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
