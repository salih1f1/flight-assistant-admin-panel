import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { SystemHealthPage } from './SystemHealthPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like AdminHealthDto as AdminHealthReportBuilder sends it outside Production:
// statuses are HealthStatus / FlightSyncOutcome names, uptime is a .NET TimeSpan string.
const makeHealth = () => ({
  status: 'Degraded',
  totalDurationMs: 412,
  checks: [
    // As the real checks answer: database has no description when healthy, aeroapi degrades
    // when the host is unreachable, apns needs no credentials in Development.
    { name: 'database', status: 'Healthy', description: null as string | null, durationMs: 18, tags: [], error: null as string | null },
    { name: 'aeroapi', status: 'Degraded', description: 'Host unreachable' as string | null, durationMs: 380, tags: ['external'], error: 'HttpRequestException: Name or service not known' as string | null },
    { name: 'apns', status: 'Healthy', description: 'APNs credentials not required in Development.' as string | null, durationMs: 1, tags: ['external'], error: null as string | null },
  ],
  system: {
    environment: 'Development',
    version: '1.4.0',
    buildSha: 'abc1234' as string | null,
    frameworkDescription: '.NET 10.0.0',
    startedUtc: '2026-09-10T16:02:00Z',
    uptime: '3.04:12:09.1234567',
    redisConfigured: false,
    appInsightsConfigured: true,
  },
  migrations: {
    available: true,
    appliedCount: 41,
    lastAppliedMigration: '20260901120000_AddAdminAuditLog' as string | null,
    pending: ['20260912090000_AddSeedVersions', '20260913080000_AddDeviceTokenIndex'],
    error: null as string | null,
  },
  flightSync: {
    enabled: true,
    lastRunStartedUtc: '2026-09-13T20:05:00Z' as string | null,
    lastRunCompletedUtc: '2026-09-13T20:05:42Z' as string | null,
    lastOutcome: 'Failed',
    flightsProcessed: 14,
    flightsFailed: 3,
    nextRunDueUtc: '2026-09-13T20:20:00Z' as string | null,
    lastError: 'DomainException: The flight status request was rejected.' as string | null,
    lastRunDurationSeconds: 42.5 as number | null,
  },
  // Different numbers from flightSync throughout, so a panel wired to the wrong field is caught.
  verification: {
    enabled: true,
    lastRunStartedUtc: '2026-09-14T03:10:00Z' as string | null,
    lastRunCompletedUtc: '2026-09-14T03:10:22Z' as string | null,
    lastOutcome: 'Success',
    requestsProcessed: 8,
    requestsFailed: 1,
    stuckAbandoned: 0,
    failuresUnrecorded: 0,
    nextRunDueUtc: '2026-09-14T03:15:00Z' as string | null,
    lastError: null as string | null,
    pendingCount: 5 as number | null,
    staleAfterDays: 180,
    requestsPaused: 0,
    recentFailures: [] as { failedSource: string | null; entityType: string; count: number }[] | null,
  },
})

let health: ReturnType<typeof makeHealth>
let sent: SentRequest[]
/** The oldest Pending row, as GET /admin/data/verification-requests sends it. */
let oldestPending: Record<string, unknown>[]

function installApi(healthAnswer: () => unknown) {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/health') return healthAnswer()
    if (req.method === 'GET' && req.url === '/admin/data/verification-requests') return pagedResult(oldestPending, req.params)
    if (req.method === 'GET' && req.url === '/admin/usage/aeroapi') throw httpError(503)
    // The page also lists the data sources; DataSourcesSection has its own tests for that.
    if (req.method === 'GET' && req.url === '/admin/health/sources') return []
    // Likewise the background jobs (#169). Both answer with a plain array, so neither can fall
    // through to the paged catch-all below.
    if (req.method === 'GET' && req.url === '/admin/jobs') return []
    // And the App Service the jobs run on (#188), which answers a single object. Named explicitly
    // rather than left to the catch-all below: that would hand the Jobs section a paged envelope
    // with no `state`, which happens to render nothing today, so a regression making the note
    // appear on a missing state would pass here unnoticed. Ok + alwaysOn true is the quiet case.
    if (req.method === 'GET' && req.url === '/admin/health/app-service') return { state: 'Ok', alwaysOn: true }
    if (req.method === 'GET' && req.url.startsWith('/admin/')) return pagedResult([], req.params)
    throw httpError(404)
  }))
}

const healthSection = async () => (await screen.findByRole('heading', { name: 'System health' })).closest('section')!
const panel = (section: HTMLElement, title: string) => within(section).getByRole('heading', { name: title }).closest('div')!
const fact = (section: HTMLElement, label: string) => within(section).getByText(label, { selector: 'dt' }).nextElementSibling

// Far enough past the minute boundary that the wait still floors to 3h 12m however long the
// render takes, which a flat 3h 12m offset would not survive.
const WAITED_3H_12M = () => new Date(Date.now() - (3 * 60 + 12) * 60_000 - 30_000).toISOString()

describe('System health page', () => {
  beforeEach(() => {
    health = makeHealth()
    oldestPending = [{ Id: 41, EntityType: 'Airport', EntityKey: 'IST', Status: 'Pending', RequestedUtc: WAITED_3H_12M() }]
    installApi(() => health)
  })

  it('reads the report from /admin/health', async () => {
    renderWithProviders(<SystemHealthPage />)
    await healthSection()

    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: '/admin/health' }))
  })

  it('shows the overall status from the report body', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()

    expect(await within(section).findByText('Overall: Degraded')).toBeInTheDocument()
  })

  it('lists every check with its status, duration, description and error', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const rows = within(section).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('database')
    expect(rows[0]).toHaveTextContent('Healthy')
    expect(rows[0]).toHaveTextContent('18 ms')
    expect(rows[1]).toHaveTextContent('aeroapi')
    expect(rows[1]).toHaveTextContent('Degraded')
    expect(rows[1]).toHaveTextContent('380 ms')
    expect(rows[1]).toHaveTextContent('Host unreachable')
    expect(rows[1]).toHaveTextContent('HttpRequestException: Name or service not known')
    expect(rows[2]).toHaveTextContent('apns')
    expect(rows[2]).toHaveTextContent('Healthy')
    expect(rows[2]).toHaveTextContent('APNs credentials not required in Development.')
  })

  it('lists pending migrations', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const migrations = panel(section, 'Migrations')
    expect(migrations).toHaveTextContent('2 pending')
    expect(migrations).toHaveTextContent('20260912090000_AddSeedVersions')
    expect(migrations).toHaveTextContent('20260913080000_AddDeviceTokenIndex')
    expect(migrations).toHaveTextContent('41 applied, last 20260901120000_AddAdminAuditLog')
  })

  it('says when no migrations are pending', async () => {
    health.migrations.pending = []
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Migrations')).toHaveTextContent('None pending')
  })

  it("says migration state is unknown, rather than none pending, when it can't be read", async () => {
    health.migrations = { available: false, appliedCount: 0, lastAppliedMigration: null, pending: [], error: 'NpgsqlException: connection refused' }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const migrations = panel(section, 'Migrations')
    expect(migrations).toHaveTextContent("Couldn't read migration state")
    expect(migrations).toHaveTextContent('NpgsqlException: connection refused')
    expect(migrations).not.toHaveTextContent('None pending')
  })

  it("shows the flight sync's last run, counts, error and next run", async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const sync = panel(section, 'Flight status sync')
    expect(sync).toHaveTextContent('Last run failed at 2026-09-13 20:05 UTC')
    expect(sync).toHaveTextContent('14 flights processed, 3 failed')
    expect(sync).toHaveTextContent('DomainException: The flight status request was rejected.')
    expect(sync).toHaveTextContent('Next run 2026-09-13 20:20 UTC')
  })

  it('says when the flight sync has not run since the API started', async () => {
    health.flightSync = { ...health.flightSync, lastOutcome: 'NeverRun', lastRunStartedUtc: null, lastRunCompletedUtc: null, flightsProcessed: 0, flightsFailed: 0, lastError: null }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const sync = panel(section, 'Flight status sync')
    expect(sync).toHaveTextContent('Not run since the API started')
    expect(sync).not.toHaveTextContent('flights processed')
  })

  it('says how long the last flight-sync run took', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Flight status sync')).toHaveTextContent('took 42.5s')
  })

  // FlightSync:LoopInterval defaults to a minute, so a run at or past that is exactly the case an
  // operator is looking for — it must not read as a wall of seconds.
  it('reads a long run in minutes', async () => {
    health.flightSync = { ...health.flightSync, lastRunDurationSeconds: 125 }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Flight status sync')).toHaveTextContent('took 2m 5s')
  })

  // Same distinction the verification panel already makes for its null counts: not measured is a
  // different claim from measured-as-zero, and an instant run is what 0 would say.
  it("says the run time isn't measured yet, rather than 0, when it's null", async () => {
    health.flightSync = { ...health.flightSync, lastRunDurationSeconds: null }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const sync = panel(section, 'Flight status sync')
    expect(sync).not.toHaveTextContent('took 0')
    expect(sync).not.toHaveTextContent('0s')
  })

  it('leaves the run time out until a run has finished', async () => {
    health.flightSync = { ...health.flightSync, lastOutcome: 'Running', lastRunCompletedUtc: null }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Flight status sync')).not.toHaveTextContent('took')
  })

  it('says when the flight sync is disabled', async () => {
    health.flightSync = { ...health.flightSync, enabled: false }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Flight status sync')).toHaveTextContent('Disabled (FlightSync:Enabled is false)')
  })

  it("shows the verification job's last run, counts, pending count and next run", async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Last run succeeded at 2026-09-14 03:10 UTC')
    expect(verification).toHaveTextContent('8 requests processed, 1 failed')
    expect(verification).toHaveTextContent('5 pending')
    expect(verification).toHaveTextContent('Next run 2026-09-14 03:15 UTC')
  })

  it('says when the verification job has not run since the API started', async () => {
    health.verification = { ...health.verification, lastOutcome: 'NeverRun', lastRunStartedUtc: null, lastRunCompletedUtc: null, requestsProcessed: 0, requestsFailed: 0, lastError: null }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Not run since the API started')
    expect(verification).not.toHaveTextContent('requests processed')
  })

  it('says how long a verification stays good, so a verified-but-old row can be read as one', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Verification')).toHaveTextContent('Verified data goes stale after 180 days')
  })

  /** The window describes the data, not the cycle: the flight-tracking trigger reads
   *  Verification:StaleAfterDays whether or not the job runs, so turning the job off must not make
   *  the panel claim verified data never ages. */
  it('still reports the stale window when the job is disabled', async () => {
    health.verification = { ...health.verification, enabled: false }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Disabled (Verification:Enabled is false)')
    expect(verification).toHaveTextContent('Verified data goes stale after 180 days')
  })

  it('says when the verification job is disabled', async () => {
    health.verification = { ...health.verification, enabled: false }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Disabled (Verification:Enabled is false)')
    expect(verification).not.toHaveTextContent('pending')
  })

  it('links the pending count to the queue, filtered to what is waiting', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(within(panel(section, 'Verification')).getByRole('link', { name: '5 pending' }))
      .toHaveAttribute('href', '/data/verification-requests?filter=Status%3APending')
  })

  it('says how long the oldest waiting request has waited', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(await within(panel(section, 'Verification')).findByText('Oldest waiting 3h 12m')).toBeInTheDocument()
  })

  /** One row, oldest first: the count itself comes from the health report, so the queue read exists
   *  only to date the oldest request — pulling a page of rows to find it would be a dashboard
   *  downloading the whole queue. */
  it('asks the queue for the oldest pending request only', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')
    await within(panel(section, 'Verification')).findByText('Oldest waiting 3h 12m')

    expect(sent.filter(r => r.url === '/admin/data/verification-requests')).toEqual([{
      method: 'GET',
      url: '/admin/data/verification-requests',
      params: { Page: 1, PageSize: 1, sort: 'RequestedUtc', filter: ['Status:Pending'] },
      data: undefined,
      responseType: undefined,
    }])
  })

  it('leaves a zero count unlinked and does not read the queue at all', async () => {
    health.verification = { ...health.verification, pendingCount: 0 }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(within(verification).getByText('0 pending')).toBeInTheDocument()
    expect(within(verification).queryByRole('link')).not.toBeInTheDocument()
    expect(within(verification).queryByText('Oldest waiting', { exact: false })).not.toBeInTheDocument()
    expect(sent.filter(r => r.url === '/admin/data/verification-requests')).toEqual([])
  })

  /** A count that couldn't be read is not a count of zero, but it is no reason to date a queue the
   *  same failing database would not answer for either. */
  it('reads no queue when the pending count itself could not be read', async () => {
    health.verification = { ...health.verification, pendingCount: null }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')
    await within(panel(section, 'Verification')).findByText("Can't tell how many are pending")

    expect(sent.filter(r => r.url === '/admin/data/verification-requests')).toEqual([])
  })

  it('says nothing about a wait when the queue read comes back empty', async () => {
    oldestPending = []
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(within(panel(section, 'Verification')).queryByText('Oldest waiting', { exact: false })).not.toBeInTheDocument()
  })

  it("says the pending count can't be told, rather than 0, when it's null", async () => {
    health.verification = { ...health.verification, pendingCount: null }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent("Can't tell how many are pending")
    expect(verification).not.toHaveTextContent('0 pending')
  })

  it('hides the stuck and unrecorded-failure counts when they are zero', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).not.toHaveTextContent('stuck')
    expect(verification).not.toHaveTextContent('unrecorded')
  })

  it('shows the stuck and unrecorded-failure counts when they are non-zero', async () => {
    health.verification = { ...health.verification, stuckAbandoned: 2, failuresUnrecorded: 1 }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('2 stuck requests')
    expect(verification).toHaveTextContent('1 unrecorded failure')
  })

  // A paused cycle (backend #401) worked its batch but held AeroAPI work back because the
  // month's budget is gone. It is neither Success nor Failed, and the panel used to fall
  // through to "Not run since the API started" — the one reading an operator must not get,
  // since it describes an idle job rather than a job out of money.
  it('shows a budget-paused cycle as paused, not as one that never ran', async () => {
    health.verification = { ...health.verification, lastOutcome: 'Paused', requestsPaused: 4 }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Last run paused at 2026-09-14 03:10 UTC — out of AeroAPI budget')
    expect(verification).not.toHaveTextContent('Not run since the API started')
  })

  it('keeps reporting what a paused cycle did get through', async () => {
    health.verification = { ...health.verification, lastOutcome: 'Paused', requestsPaused: 4 }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    // The counts describe the cycle whatever its outcome; gating them on Success/Failed hid
    // the work a paused cycle actually did.
    expect(panel(section, 'Verification')).toHaveTextContent('8 requests processed, 1 failed')
  })

  it('shows how many requests the pause held back', async () => {
    health.verification = { ...health.verification, lastOutcome: 'Paused', requestsPaused: 4 }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Verification')).toHaveTextContent('4 paused requests')
  })

  it('hides the paused count when nothing was held back', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Verification')).not.toHaveTextContent('paused request')
  })

  it('groups the last 24 hours of failures by source and entity type', async () => {
    health.verification = {
      ...health.verification,
      recentFailures: [
        { failedSource: 'AeroAPI', entityType: 'Airport', count: 3 },
        { failedSource: 'OurAirports', entityType: 'Airport', count: 1 },
      ],
    }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Failed in the last 24 hours')
    expect(verification).toHaveTextContent('AeroAPI · Airport: 3')
    expect(verification).toHaveTextContent('OurAirports · Airport: 1')
  })

  // A null failedSource is a real group the backend chose not to drop (deleted entity,
  // unexpected exception, abandoned claim), so it has to be named rather than skipped.
  it('names a failure group that is attributable to no one source', async () => {
    health.verification = {
      ...health.verification,
      recentFailures: [{ failedSource: null, entityType: 'Country', count: 2 }],
    }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Verification')).toHaveTextContent('Unattributed · Country: 2')
  })

  it('stays quiet when nothing failed in the last 24 hours', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Verification')).not.toHaveTextContent('Failed in the last 24 hours')
  })

  // Same distinction pendingCount already makes: an unreadable list is "cannot tell", which is
  // a different claim from the empty list that means nothing failed.
  it("says what failed recently can't be told, rather than nothing, when it's null", async () => {
    health.verification = { ...health.verification, recentFailures: null }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent("Can't tell what failed recently")
    expect(verification).not.toHaveTextContent('Failed in the last 24 hours')
  })

  it('shows the environment, version, build, uptime and what is configured', async () => {
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(fact(section, 'Environment')).toHaveTextContent('Development')
    expect(fact(section, 'Version')).toHaveTextContent('1.4.0 (abc1234)')
    expect(fact(section, 'Uptime')).toHaveTextContent('3d 4h 12m')
    expect(fact(section, 'Redis')).toHaveTextContent('Not configured')
    expect(fact(section, 'App Insights')).toHaveTextContent('Configured')
  })

  it('shows only the version for a local build, which has no build SHA', async () => {
    health.system = { ...health.system, buildSha: null, uptime: '00:07:30' }
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(fact(section, 'Version')).toHaveTextContent(/^1\.4\.0$/)
    expect(fact(section, 'Uptime')).toHaveTextContent(/^7m$/)
  })

  it("shows the API's reason when the report can't be loaded", async () => {
    installApi(() => {
      throw httpError(500, { title: 'An unexpected error occurred.', status: 500 })
    })
    renderWithProviders(<SystemHealthPage />)
    const section = await healthSection()

    expect(await within(section).findByRole('alert')).toHaveTextContent('Could not load system health: An unexpected error occurred.')
  })
})
