import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { AdminDataSourceDto } from '@/api/generated/model'
import { DataSourcesSection } from './DataSourcesSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** One row as GET /admin/health/sources sends it, with the fields a test doesn't care about filled in. */
const source = (overrides: Partial<AdminDataSourceDto> = {}): AdminDataSourceDto => ({
  key: 'aeroapi',
  displayName: 'FlightAware AeroAPI',
  kind: 'FlightData',
  criticality: 'Required',
  status: 'Ok',
  whatIsChecked: 'Reads the account-usage report.',
  externalUrl: null,
  lastOutcome: 'Ok',
  lastOutcomeUtc: '2026-09-18T12:00:00Z',
  lastOkUtc: '2026-09-18T12:00:00Z',
  lastError: null,
  consecutiveFailures: 0,
  canProbe: false,
  probeCostNote: null,
  lastProbeUtc: null,
  lastProbeBy: null,
  ...overrides,
})

let sent: SentRequest[]

function renderWith(sources: AdminDataSourceDto[]) {
  ;({ sent } = installFakeApi(async req => {
    if (req.method === 'GET' && req.url === '/admin/health/sources') return sources
    throw new Error(`unexpected ${req.method} ${req.url}`)
  }))
  return renderWithProviders(<DataSourcesSection />)
}

describe('DataSourcesSection', () => {
  beforeEach(() => { sent = [] })

  it('renders an unobserved source as unknown, not healthy', async () => {
    renderWith([source({ status: 'Unknown', lastOutcome: null, lastOutcomeUtc: null, lastOkUtc: null })])

    expect(await screen.findByText('Unknown')).toHaveClass('text-gray-500')
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
    expect(screen.queryByText('Ok')).not.toBeInTheDocument()
  })

  it('explains an unobserved source rather than alarming about it', async () => {
    renderWith([source({ status: 'Unknown', lastOutcome: null, lastOutcomeUtc: null, lastOkUtc: null })])

    expect(await screen.findByText(/not observed since deploy/i)).toBeInTheDocument()
  })

  it('shows why a source is degraded', async () => {
    renderWith([source({
      status: 'Degraded',
      lastOutcome: 'Unauthorized',
      lastError: 'aeroapi returned HTTP 401',
    })])

    expect(await screen.findByText(/HTTP 401/)).toBeInTheDocument()
  })

  it('renders an unconfigured optional source in gray, never red', async () => {
    renderWith([source({ key: 'github', displayName: 'GitHub API', status: 'NotConfigured', criticality: 'Optional' })])

    expect(await screen.findByText('NotConfigured')).toHaveClass('text-gray-500')
  })

  it('renders what each source actually checks', async () => {
    renderWith([source({ whatIsChecked: 'Signs in with the AeroAPI key and reads the account-usage report.' })])

    expect(await screen.findByText(/Signs in with the AeroAPI key/)).toBeInTheDocument()
  })

  it("links out to the source's own dashboard", async () => {
    renderWith([source({ externalUrl: 'https://www.flightaware.com/aeroapi/portal/' })])

    const link = await screen.findByRole('link', { name: /FlightAware AeroAPI/ })
    expect(link).toHaveAttribute('href', 'https://www.flightaware.com/aeroapi/portal/')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('leaves a source with no dashboard of its own unlinked', async () => {
    renderWith([source({ displayName: 'PostgreSQL', externalUrl: null })])

    expect(await screen.findByText('PostgreSQL')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /PostgreSQL/ })).not.toBeInTheDocument()
  })

  it('groups rows by kind', async () => {
    renderWith([
      source({ key: 'postgres', displayName: 'PostgreSQL', kind: 'Database' }),
      source({ key: 'aeroapi', displayName: 'FlightAware AeroAPI', kind: 'FlightData' }),
    ])

    const database = await screen.findByRole('rowgroup', { name: /Database/i })
    expect(within(database).getByText('PostgreSQL')).toBeInTheDocument()
    expect(within(database).queryByText('FlightAware AeroAPI')).not.toBeInTheDocument()
  })

  // Two columns, two different questions: a source can have failed an hour ago and still have
  // last worked yesterday, and an operator reads the gap between them.
  it('says both when a source last worked and when it was last checked', async () => {
    renderWith([source({
      status: 'Degraded',
      lastOutcome: 'Failed',
      lastOkUtc: '2026-09-17T09:30:00Z',
      lastOutcomeUtc: '2026-09-18T12:00:00Z',
    })])

    expect(await screen.findByText(/2026-09-17 09:30 UTC/)).toBeInTheDocument()
    expect(screen.getByText(/2026-09-18 12:00 UTC/)).toBeInTheDocument()
  })

  it('shows an em dash, never a guess, for a source that has never worked', async () => {
    renderWith([source({ status: 'Unknown', lastOutcome: null, lastOutcomeUtc: null, lastOkUtc: null })])

    expect(await screen.findAllByText('—')).toHaveLength(2)
  })

  it('offers no button for a source that cannot be probed', async () => {
    renderWith([source({ key: 'github-download', displayName: 'GitHub artifact download', canProbe: false })])

    await screen.findByText('GitHub artifact download')
    expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument()
  })

  it('checks a source on demand and shows what came back', async () => {
    const user = userEvent.setup()
    renderWith([source({ key: 'postgres', displayName: 'PostgreSQL', status: 'Unknown', canProbe: true })])

    await user.click(await screen.findByRole('button', { name: /check now/i }))

    await waitFor(() => expect(sent.filter(r => r.method === 'POST')).toHaveLength(1))
    expect(sent.find(r => r.method === 'POST')!.url).toBe('/admin/health/sources/postgres/probe')
  })

  it('warns before a probe that costs money, and only sends once confirmed', async () => {
    const user = userEvent.setup()
    renderWith([source({
      key: 'aerodatabox',
      displayName: 'AeroDataBox (RapidAPI)',
      canProbe: true,
      probeCostNote: 'Reachability only — every real AeroDataBox call is billed, so the key itself is not tested.',
    })])

    await user.click(await screen.findByRole('button', { name: /check now/i }))

    expect(screen.getByText(/every real AeroDataBox call is billed/i)).toBeInTheDocument()
    expect(sent.filter(r => r.method === 'POST')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /check anyway/i }))
    await waitFor(() => expect(sent.filter(r => r.method === 'POST')).toHaveLength(1))
  })

  // A 429 is our own rate limit, not the source failing. Rendering it as a fault would be a new
  // version of the bug this whole feature exists to fix.
  it('reports a rate-limited probe without claiming the source failed', async () => {
    const user = userEvent.setup()
    ;({ sent } = installFakeApi(async req => {
      if (req.method === 'GET' && req.url === '/admin/health/sources') {
        return [source({ key: 'postgres', displayName: 'PostgreSQL', status: 'Ok', canProbe: true })]
      }
      throw httpError(429)
    }))
    renderWithProviders(<DataSourcesSection />)

    await user.click(await screen.findByRole('button', { name: /check now/i }))

    expect(await screen.findByText(/checked too recently/i)).toBeInTheDocument()
    expect(screen.queryByText('Unhealthy')).not.toBeInTheDocument()
    expect(screen.getByText('Ok')).toBeInTheDocument()
  })

  it('reports any other probe failure as the probe failing, not the source', async () => {
    const user = userEvent.setup()
    ;({ sent } = installFakeApi(async req => {
      if (req.method === 'GET' && req.url === '/admin/health/sources') {
        return [source({ key: 'postgres', displayName: 'PostgreSQL', status: 'Ok', canProbe: true })]
      }
      throw httpError(500, { title: 'Something went wrong' })
    }))
    renderWithProviders(<DataSourcesSection />)

    await user.click(await screen.findByRole('button', { name: /check now/i }))

    expect(await screen.findByText(/couldn't check this source/i)).toBeInTheDocument()
  })

  it('reports a failure to load the inventory instead of showing an empty table', async () => {
    installFakeApi(async () => { throw new Error('boom') })
    renderWithProviders(<DataSourcesSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
  })
})
