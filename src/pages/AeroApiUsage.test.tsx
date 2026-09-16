import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Dashboard } from './Dashboard'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const NOW = new Date('2026-09-13T20:14:00Z')

// Shaped like AeroApiUsageDto: month to date, the end floored onto the API's 10-minute cache grid.
const makeUsage = () => ({
  rangeStartUtc: '2026-09-01T00:00:00+00:00',
  rangeEndUtc: '2026-09-13T20:10:00+00:00',
  totalCalls: 12,
  totalPages: 30,
  totalCostUsd: 3.75,
  totalDiscountCostUsd: 0,
  totalSuccessfulCalls: 11,
  totalFailedCalls: 1,
  monthlyBudgetUsd: 5,
  byOperation: [
    { operation: 'GET /flights/{ident}', calls: 4, pages: 4, costUsd: 0.2, successfulCalls: 4, failedCalls: 0 },
    { operation: 'GET /schedules/{date_start}/{date_end}', calls: 8, pages: 26, costUsd: 3.55, successfulCalls: 7, failedCalls: 1 },
  ],
  nextSlotUtc: null as string | null,
})

let usage: ReturnType<typeof makeUsage>
let sent: SentRequest[]

function installApi(usageAnswer: () => unknown) {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/usage/aeroapi') return usageAnswer()
    // Dashboard also renders the needs-attention card; its response isn't paged like the rest.
    if (req.method === 'GET' && req.url === '/admin/verification-needs-attention') {
      return [{ entityType: 'Airport', count: 0 }, { entityType: 'Airline', count: 0 }, { entityType: 'Country', count: 0 }]
    }
    if (req.method === 'GET' && req.url.startsWith('/admin/')) return pagedResult([], req.params)
    throw httpError(404)
  }))
}

const usageSection = async () => (await screen.findByRole('heading', { name: 'AeroAPI usage' })).closest('section')!
const stat = (section: HTMLElement, label: string) => within(section).getByText(label, { selector: 'dt' }).nextElementSibling

describe('Dashboard AeroAPI usage', () => {
  beforeEach(() => {
    // Only Date is faked, so React Query and Testing Library keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    usage = makeUsage()
    installApi(() => usage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("asks for the API's default range, so the server's cache is used", async () => {
    renderWithProviders(<Dashboard />)
    await usageSection()

    expect(sent).toContainEqual({ method: 'GET', url: '/admin/usage/aeroapi', params: undefined, data: undefined })
  })

  it('shows spend against the monthly budget', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText('$3.75 of $5.00')).toBeInTheDocument()
    expect(within(section).getByText('75% of monthly budget')).toBeInTheDocument()
    expect(within(section).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
    expect(within(section).queryByText(/budget reached|near budget/i)).not.toBeInTheDocument()
  })

  it('warns when spend is near the budget', async () => {
    usage.totalCostUsd = 4.1
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText('Near budget')).toBeInTheDocument()
    expect(within(section).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '82')
  })

  it('warns when spend is over the budget, keeping the bar full', async () => {
    usage.totalCostUsd = 6.5
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText('Budget reached')).toBeInTheDocument()
    expect(within(section).getByText('130% of monthly budget')).toBeInTheDocument()
    expect(within(section).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('shows calls, billed pages and failed calls', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()
    await within(section).findByText('$3.75 of $5.00')

    expect(stat(section, 'Calls')).toHaveTextContent('12')
    expect(stat(section, 'Pages billed')).toHaveTextContent('30')
    expect(stat(section, 'Failed calls')).toHaveTextContent('1')
  })

  it('breaks spend down by operation, most expensive first', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()
    await within(section).findByText('$3.75 of $5.00')

    const rows = within(section).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('GET /schedules/{date_start}/{date_end}')
    expect(rows[0]).toHaveTextContent('$3.55')
    expect(rows[1]).toHaveTextContent('GET /flights/{ident}')
    expect(rows[1]).toHaveTextContent('$0.20')
  })

  it('says which period the numbers cover, in UTC', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText('2026-09-01 00:00 – 2026-09-13 20:10 UTC')).toBeInTheDocument()
  })

  it('says the throttle is free when there is no pending slot', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText('Next AeroAPI slot: available now')).toBeInTheDocument()
  })

  it('says how long until the next throttle slot', async () => {
    usage.nextSlotUtc = '2026-09-13T20:14:07+00:00'
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText('Next AeroAPI slot: in 7s')).toBeInTheDocument()
  })

  it("shows the API's reason when the report can't be loaded", async () => {
    installApi(() => {
      throw httpError(503, { title: 'AeroAPI is rate limiting requests.', status: 503, detail: 'AeroAPI returned HTTP 429: slow down' })
    })
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent('Could not load AeroAPI usage: AeroAPI is rate limiting requests.')
    expect(alert).toHaveTextContent('AeroAPI returned HTTP 429: slow down')
  })
})
