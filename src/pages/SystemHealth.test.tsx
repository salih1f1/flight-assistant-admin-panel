import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Dashboard } from './Dashboard'

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
  },
})

let health: ReturnType<typeof makeHealth>
let sent: SentRequest[]

function installApi(healthAnswer: () => unknown) {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/health') return healthAnswer()
    if (req.method === 'GET' && req.url === '/admin/usage/aeroapi') throw httpError(503)
    // Dashboard also renders the needs-attention card; its response isn't paged like the rest.
    if (req.method === 'GET' && req.url === '/admin/verification-needs-attention') {
      return [{ entityType: 'Airport', count: 0 }, { entityType: 'Airline', count: 0 }, { entityType: 'Country', count: 0 }]
    }
    if (req.method === 'GET' && req.url.startsWith('/admin/')) return pagedResult([], req.params)
    throw httpError(404)
  }))
}

const healthSection = async () => (await screen.findByRole('heading', { name: 'System health' })).closest('section')!
const panel = (section: HTMLElement, title: string) => within(section).getByRole('heading', { name: title }).closest('div')!
const fact = (section: HTMLElement, label: string) => within(section).getByText(label, { selector: 'dt' }).nextElementSibling

describe('Dashboard system health', () => {
  beforeEach(() => {
    health = makeHealth()
    installApi(() => health)
  })

  it('reads the report from /admin/health', async () => {
    renderWithProviders(<Dashboard />)
    await healthSection()

    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: '/admin/health' }))
  })

  it('shows the overall status from the report body', async () => {
    renderWithProviders(<Dashboard />)
    const section = await healthSection()

    expect(await within(section).findByText('Overall: Degraded')).toBeInTheDocument()
  })

  it('lists every check with its status, duration, description and error', async () => {
    renderWithProviders(<Dashboard />)
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
    renderWithProviders(<Dashboard />)
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
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Migrations')).toHaveTextContent('None pending')
  })

  it("says migration state is unknown, rather than none pending, when it can't be read", async () => {
    health.migrations = { available: false, appliedCount: 0, lastAppliedMigration: null, pending: [], error: 'NpgsqlException: connection refused' }
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const migrations = panel(section, 'Migrations')
    expect(migrations).toHaveTextContent("Couldn't read migration state")
    expect(migrations).toHaveTextContent('NpgsqlException: connection refused')
    expect(migrations).not.toHaveTextContent('None pending')
  })

  it("shows the flight sync's last run, counts, error and next run", async () => {
    renderWithProviders(<Dashboard />)
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
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const sync = panel(section, 'Flight status sync')
    expect(sync).toHaveTextContent('Not run since the API started')
    expect(sync).not.toHaveTextContent('flights processed')
  })

  it('says when the flight sync is disabled', async () => {
    health.flightSync = { ...health.flightSync, enabled: false }
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(panel(section, 'Flight status sync')).toHaveTextContent('Disabled (FlightSync:Enabled is false)')
  })

  it("shows the verification job's last run, counts, pending count and next run", async () => {
    renderWithProviders(<Dashboard />)
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
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Not run since the API started')
    expect(verification).not.toHaveTextContent('requests processed')
  })

  it('says when the verification job is disabled', async () => {
    health.verification = { ...health.verification, enabled: false }
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('Disabled (Verification:Enabled is false)')
    expect(verification).not.toHaveTextContent('pending')
  })

  it("says the pending count can't be told, rather than 0, when it's null", async () => {
    health.verification = { ...health.verification, pendingCount: null }
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent("Can't tell how many are pending")
    expect(verification).not.toHaveTextContent('0 pending')
  })

  it('hides the stuck and unrecorded-failure counts when they are zero', async () => {
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).not.toHaveTextContent('stuck')
    expect(verification).not.toHaveTextContent('unrecorded')
  })

  it('shows the stuck and unrecorded-failure counts when they are non-zero', async () => {
    health.verification = { ...health.verification, stuckAbandoned: 2, failuresUnrecorded: 1 }
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    const verification = panel(section, 'Verification')
    expect(verification).toHaveTextContent('2 stuck requests')
    expect(verification).toHaveTextContent('1 unrecorded failure')
  })

  it('shows the environment, version, build, uptime and what is configured', async () => {
    renderWithProviders(<Dashboard />)
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
    renderWithProviders(<Dashboard />)
    const section = await healthSection()
    await within(section).findByText('Overall: Degraded')

    expect(fact(section, 'Version')).toHaveTextContent(/^1\.4\.0$/)
    expect(fact(section, 'Uptime')).toHaveTextContent(/^7m$/)
  })

  it("shows the API's reason when the report can't be loaded", async () => {
    installApi(() => {
      throw httpError(500, { title: 'An unexpected error occurred.', status: 500 })
    })
    renderWithProviders(<Dashboard />)
    const section = await healthSection()

    expect(await within(section).findByRole('alert')).toHaveTextContent('Could not load system health: An unexpected error occurred.')
  })
})
