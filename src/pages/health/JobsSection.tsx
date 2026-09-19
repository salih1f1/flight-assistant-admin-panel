import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getAdminGetJobsQueryKey, useAdminGetAppServiceStatus, useAdminGetJobs, useAdminToggleJob } from '@/api/generated/admin'
import type { AdminJobDto, AppServiceStatusDto } from '@/api/generated/model'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'

/**
 * The config key each job's deployment ceiling lives under. Named to the operator when a toggle is
 * barred, because "you cannot change this" without saying what would is a dead end — the fix is a
 * deploy, and this is the setting to change.
 */
const CONFIG_KEY: Record<string, string> = {
  'flight-sync': 'FlightSync:Enabled',
  verification: 'Verification:Enabled',
}

/**
 * Starting and stopping the two scheduled jobs (#169).
 *
 * Both spend AeroAPI budget, and before this the only way to stop one was a config change and a
 * deploy. The switch is a runtime override *inside* the config ceiling: config saying a job is off
 * still wins, and the API refuses a toggle against it with a 409 — so a barred toggle is rendered
 * disabled and explained rather than hidden, which would leave an operator hunting for a control
 * that is present but off-limits.
 */
export function JobsSection() {
  const { data, isLoading, error } = useAdminGetJobs()
  // Deliberately unguarded by the jobs query's own state: this is a second, independent fact, and
  // a failure to read it must never stop the jobs table rendering. react-query gives us undefined
  // on error, which AlwaysOnNote reads as "unknown" — the same as a refusal.
  const { data: appService } = useAdminGetAppServiceStatus()

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Background jobs</h2>
        <p className="text-sm text-gray-500">
          Stop or start a scheduled job without a deploy. Manual runs are unaffected.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {error ? (
            <JobsError error={error} />
          ) : isLoading || !data ? (
            <p className="text-sm text-gray-400">Loading jobs…</p>
          ) : (
            <>
            <AlwaysOnNote appService={appService} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead><span className="sr-only">Switch</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map(job => <JobRow key={job.job} job={job} />)}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * Says that "Running" above is conditional, when it is (#188).
 *
 * With Always On off, App Service unloads the app after roughly twenty minutes idle and
 * IHostedService stops with it — so these jobs run while someone is using the panel and pause
 * shortly after they close it. Measured on the dev resource as six consecutive hours of zero
 * requests overnight, with the section reading "Running" throughout.
 *
 * It sits here rather than on a row elsewhere on the page because that is where the false
 * impression is made. A fact stating `alwaysOn: false` a scroll away is true and useless: nobody
 * connects it to the green "Running" beside it.
 *
 * Amber, never red. Leaving Always On off is a defensible choice — it is cheaper, and with the
 * jobs idle a forgotten test flight cannot poll overnight. The same rule NotConfigured follows on
 * the data-source rows, and an operator stop follows on these very rows.
 */
function AlwaysOnNote({ appService }: { appService: AppServiceStatusDto | undefined }) {
  // Only a successful read that came back false earns the note. `null`, `undefined`, a refusal, an
  // outage and a developer machine all mean we do not know, and a warning drawn from a value we
  // never read would have no evidence behind it — the inverse of reporting $0.00 for a refused
  // cost query: inventing a fault rather than hiding one. Silence is the honest answer.
  if (appService?.state !== 'Ok' || appService.alwaysOn !== false) return null

  return (
    <p className="mb-4 text-sm text-amber-600">
      The app is unloaded when idle, so these jobs pause and resume with traffic rather than running
      continuously. Turn on Always On in App Service to run them around the clock.
    </p>
  )
}

function JobsError({ error }: { error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Could not load the background jobs: {title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

function JobRow({ job }: { job: AdminJobDto }) {
  const queryClient = useQueryClient()
  const [askingReason, setAskingReason] = useState(false)
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const toggle = useAdminToggleJob({
    mutation: {
      onSuccess: () => {
        setAskingReason(false)
        setReason('')
        setFailure(null)
        // Refetch rather than trusting the response: the row also carries heartbeat state the
        // toggle does not change, and a stale "last run" beside a freshly changed state reads
        // like the toggle half-worked.
        void queryClient.invalidateQueries({ queryKey: getAdminGetJobsQueryKey() })
      },
      // A refusal is not a state change. The row keeps showing what the API still believes, and
      // the reason it gave is rendered verbatim — a 409 here means the config ceiling barred it,
      // and the message names the setting to change.
      onError: (e: unknown) => setFailure(apiErrorMessage(e).title),
    },
  })

  const send = (enabled: boolean) =>
    toggle.mutate({ job: job.job ?? '', data: { enabled, reason: reason.trim() || null } })

  const off = job.effectiveEnabled === false
  const configBarred = job.canToggle === false

  return (
    <TableRow>
      <TableCell className="font-medium">{job.displayName}</TableCell>

      <TableCell className="align-top">
        <span className={cn('font-medium', off ? 'text-amber-600' : 'text-green-600')}>
          {off ? 'Switched off' : 'Running'}
        </span>

        {/* Amber, not red, throughout: a job someone deliberately stopped is a chosen state, and
            must not read like a fault. Same rule the data-source rows follow for NotConfigured. */}
        {configBarred && (
          <p className="text-xs text-gray-500">
            {`Disabled by configuration (${CONFIG_KEY[job.job ?? ''] ?? 'configuration'}). Changing it needs a deploy.`}
          </p>
        )}

        {off && !configBarred && (
          <>
            {job.changedBy && (
              <p className="text-xs text-gray-500">
                {`Switched off by ${job.changedBy}${job.changedUtc ? ` at ${formatUtcMinute(job.changedUtc)} UTC` : ''}`}
              </p>
            )}
            {job.reason && <p className="text-xs text-gray-500">{job.reason}</p>}
            {/* Says what the toggle does NOT do. Without this the switch reads as sealing the
                feature, which is the reading that makes people hesitate to use it. */}
            <p className="text-xs text-gray-400">Manual runs still work while this is off.</p>
          </>
        )}

        {failure && <p className="text-xs text-red-600">{failure}</p>}
      </TableCell>

      {/* Deliberately no staleness or "overdue" treatment: the API freezes nextRunDueUtc while a
          job is switched off, so anything computed from this would mark a deliberately stopped job
          as late. It is a plain fact, not a judgement. */}
      <TableCell className="align-top text-sm text-gray-500">
        {job.lastRunUtc ? `${formatUtcMinute(job.lastRunUtc)} UTC` : '—'}
      </TableCell>

      <TableCell className="align-top text-right">
        {askingReason ? (
          <div className="flex flex-col items-end gap-2">
            <Input
              aria-label="Reason (optional)"
              placeholder="Why? (optional)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setAskingReason(false); setReason('') }}>
                Cancel
              </Button>
              <Button size="sm" disabled={toggle.isPending} onClick={() => send(false)}>
                Confirm
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={configBarred || toggle.isPending}
            // Switching ON sends immediately; switching OFF asks why first. Asymmetric on purpose:
            // stopping a job is the act someone will need explained later, and restarting one is
            // the recovery — making a person justify a recovery is friction at the worst moment.
            onClick={() => (off ? send(true) : setAskingReason(true))}
          >
            {off ? 'Switch on' : 'Switch off'}
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
