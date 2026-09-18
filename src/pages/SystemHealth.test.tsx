import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { AdminDataSourceDto } from '@/api/generated/model'
import { Dashboard } from './Dashboard'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const source = (status: string, key = `source-${status}`): AdminDataSourceDto => ({
  key,
  displayName: key,
  kind: 'Infrastructure',
  criticality: 'Required',
  status,
  whatIsChecked: 'Something.',
  externalUrl: null,
  lastOutcome: status === 'Unknown' ? null : 'Ok',
  lastOutcomeUtc: null,
  lastOkUtc: null,
  lastError: null,
  consecutiveFailures: 0,
  canProbe: false,
  probeCostNote: null,
  lastProbeUtc: null,
  lastProbeBy: null,
})

let sent: SentRequest[]

/**
 * The dashboard's health section reads two endpoints now: the overall status from the report, and
 * the source counts from the inventory. It renders neither in full — the /health page does that.
 */
function renderDashboard({ status, sources }: { status: string; sources: AdminDataSourceDto[] }) {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/health') return { status, checks: [], system: {}, migrations: {}, flightSync: {}, verification: {} }
    if (req.method === 'GET' && req.url === '/admin/health/sources') return sources
    if (req.method === 'GET' && req.url === '/admin/usage/aeroapi') throw httpError(503)
    if (req.method === 'GET' && req.url === '/admin/verification-needs-attention') {
      return [{ entityType: 'Airport', count: 0 }, { entityType: 'Airline', count: 0 }, { entityType: 'Country', count: 0 }]
    }
    if (req.method === 'GET' && req.url.startsWith('/admin/')) return pagedResult([], req.params)
    throw httpError(404)
  }))
  renderWithProviders(<Dashboard />)
}

const healthSection = async () => (await screen.findByRole('heading', { name: 'System health' })).closest('section')!

describe('Dashboard system health summary', () => {
  beforeEach(() => { sent = [] })

  it('summarises health and links to the page', async () => {
    renderDashboard({ status: 'Healthy', sources: Array.from({ length: 9 }, (_, i) => source('Ok', `s${i}`)) })
    const section = within(await healthSection())

    expect(await section.findByText(/9 sources/i)).toBeInTheDocument()
    expect(section.getByRole('link', { name: /system health/i })).toHaveAttribute('href', '/health')
  })

  it('names the trouble when something is not ok', async () => {
    renderDashboard({
      status: 'Degraded',
      sources: [source('Ok', 's1'), source('Degraded', 's2'), source('Unhealthy', 's3')],
    })
    const section = within(await healthSection())

    expect(await section.findByText(/2 need attention/i)).toBeInTheDocument()
  })

  /** Unknown is "nobody has looked", which is exactly what an operator should go and look at. */
  it('counts an unobserved source as needing attention, never as healthy', async () => {
    renderDashboard({ status: 'Healthy', sources: [source('Ok', 's1'), source('Unknown', 's2')] })
    const section = within(await healthSection())

    expect(await section.findByText(/1 needs attention/i)).toBeInTheDocument()
  })

  /** NotConfigured is a deliberate choice in this environment, not something to chase. */
  it('does not count a deliberately unconfigured source as trouble', async () => {
    renderDashboard({ status: 'Healthy', sources: [source('Ok', 's1'), source('NotConfigured', 's2')] })
    const section = within(await healthSection())

    expect(await section.findByText(/2 sources/i)).toBeInTheDocument()
    expect(section.queryByText(/need(s)? attention/i)).not.toBeInTheDocument()
  })

  it('leaves the detail to the page rather than repeating the report', async () => {
    renderDashboard({ status: 'Healthy', sources: [source('Ok', 's1')] })
    const section = within(await healthSection())

    await section.findByText(/1 source/i)
    expect(section.queryByRole('heading', { name: 'Migrations' })).not.toBeInTheDocument()
    expect(section.queryByText(/Overall:/)).not.toBeInTheDocument()
  })

  it("still reads the report, so the overall status is the API's", async () => {
    renderDashboard({ status: 'Unhealthy', sources: [source('Ok', 's1')] })
    const section = within(await healthSection())

    expect(await section.findByText('Unhealthy')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: '/admin/health' }))
  })
})
