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
    // The health section's inventory answers with a plain array, not a paged result, so it cannot
    // fall through to the catch-all below.
    if (req.method === 'GET' && req.url === '/admin/health/sources') return []
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

  // The line is live throttle state, so it only earns its place when something is actually
  // queued. "available now" was a line of text carrying no information.
  it('says nothing about the throttle when no call is queued', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()
    await within(section).findByText(/of \$5\.00/)

    expect(within(section).queryByText(/outbound throttle/i)).not.toBeInTheDocument()
  })

  it('says how long the next call waits, and that the wait is ours not FlightAware reporting it', async () => {
    usage.nextSlotUtc = '2026-09-13T20:14:07+00:00'
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText(/next call waits ~7s/i)).toBeInTheDocument()
    // Without this the number is meaningless: it is our own queue, not a FlightAware figure.
    expect(within(section).getByText(/5 calls a minute/i)).toBeInTheDocument()
  })

  // A 10-minute server cache backs this report, so a slot that has already come due is stale
  // data. Rendering it would claim a wait that has already elapsed.
  it('drops a throttle slot that has already passed', async () => {
    usage.nextSlotUtc = '2026-09-13T20:13:00+00:00'
    renderWithProviders(<Dashboard />)
    const section = await usageSection()
    await within(section).findByText(/of \$5\.00/)

    expect(within(section).queryByText(/outbound throttle/i)).not.toBeInTheDocument()
  })

  it('links to FlightAware so the numbers can be reconciled', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    const link = await within(section).findByRole('link', { name: /flightaware/i })
    expect(link).toHaveAttribute('href', 'https://www.flightaware.com/aeroapi/portal/')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('says which operation the failed calls came from', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    const row = (await within(section).findByText('GET /schedules/{date_start}/{date_end}')).closest('tr')!
    expect(within(row).getByText('1')).toHaveClass('text-amber-600')
  })

  it('does not colour an operation that has never failed', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    const row = (await within(section).findByText('GET /flights/{ident}')).closest('tr')!
    expect(within(row).getByText('0')).not.toHaveClass('text-amber-600')
  })

  it('hides the discount tile when nothing was discounted', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()
    await within(section).findByText(/of \$5\.00/)

    expect(within(section).queryByText(/discount/i)).not.toBeInTheDocument()
  })

  it('shows the discount when there is one', async () => {
    usage.totalDiscountCostUsd = 1.25
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    expect(await within(section).findByText(/discount/i)).toBeInTheDocument()
    expect(within(section).getByText('$1.25')).toBeInTheDocument()
  })

  it('says the average daily spend and how much of the period is left', async () => {
    renderWithProviders(<Dashboard />)
    const section = await usageSection()

    // $3.75 over 12.84 days elapsed is $0.29/day; September has 30, so 17 remain.
    expect(await within(section).findByText(/\$0\.29 a day/)).toBeInTheDocument()
    expect(within(section).getByText(/17 days left/i)).toBeInTheDocument()
  })

  // A range shorter than a day must not divide spend by a fraction and report a wild daily rate.
  it('does not report a daily average before a full day has elapsed', async () => {
    usage.rangeStartUtc = '2026-09-13T18:00:00+00:00'
    usage.rangeEndUtc = '2026-09-13T20:10:00+00:00'
    renderWithProviders(<Dashboard />)
    const section = await usageSection()
    await within(section).findByText(/of \$5\.00/)

    expect(within(section).queryByText(/a day/i)).not.toBeInTheDocument()
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
