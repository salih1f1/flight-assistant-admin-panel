import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { Dashboard } from './Dashboard'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const zeros = (n: number) => Array.from({ length: n }, () => 0)

// Shaped like AdminStatsDto as the API serialises it (DateTimeOffset with an explicit offset). A
// different number on every card, so a card wired to the wrong entry shows the wrong number.
const stats = (period: string) => ({
  fromUtc: '2026-09-08T00:00:00+00:00',
  toUtc: '2026-09-15T00:00:00+00:00',
  period,
  bucket: 'day',
  entities: [
    { key: 'travelers', dateColumn: 'CreatedUtc', total: 4, newInPeriod: 0, verified: null, unverified: null, series: zeros(7) },
    { key: 'flights', dateColumn: 'CreatedUtc', total: 12, newInPeriod: 2, verified: null, unverified: null, series: [0, 1, 0, 0, 0, 0, 1] },
    { key: 'airlines', dateColumn: 'FirstSeenAt', total: 692, newInPeriod: 3, verified: 540, unverified: 152, series: [0, 0, 2, 0, 0, 0, 1] },
    { key: 'airports', dateColumn: 'FirstSeenAt', total: 9068, newInPeriod: 0, verified: 9000, unverified: 68, series: zeros(7) },
    { key: 'lounges', dateColumn: 'CreatedUtc', total: 203, newInPeriod: 1, verified: 0, unverified: 203, series: [0, 0, 0, 0, 1, 0, 0] },
    { key: 'loyalty-programs', dateColumn: 'CreatedUtc', total: 25, newInPeriod: 0, verified: 25, unverified: 0, series: zeros(7) },
  ],
})

let sent: SentRequest[]

/** Only /admin/stats answers; the dashboard's other sections fail on their own, which these tests ignore. */
function install(answer: (req: SentRequest) => unknown = req => stats(String(req.params?.period))) {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/stats') return answer(req)
    throw httpError(404)
  }))
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const card = (name: string) => screen.findByRole('region', { name })
const statsRequests = () => sent.filter(r => r.url === '/admin/stats')
const gridLink = (table: string, filter: string) => `/data/${table}?${new URLSearchParams({ filter })}`

describe('Dashboard stats', () => {
  beforeEach(() => install())

  it("asks for the last 7 days by default and shows each card's total", async () => {
    renderAt('/')

    for (const [name, total] of [['Travelers', '4'], ['Flights', '12'], ['Airlines', '692'], ['Airports', '9,068'], ['Lounges', '203'], ['Loyalty Programs', '25']]) {
      expect(within(await card(name)).getByText(total)).toBeInTheDocument()
    }
    expect(statsRequests()).toEqual([expect.objectContaining({ method: 'GET', params: { period: '7d' } })])
  })

  it("'+N new' opens the grid filtered to rows added since the window's start", async () => {
    renderAt('/')

    const airlines = await card('Airlines')
    expect(within(airlines).getByRole('link', { name: '+3 new' }))
      .toHaveAttribute('href', gridLink('airlines', 'FirstSeenAt:>=2026-09-08T00:00:00.000Z'))
    expect(within(await card('Lounges')).getByRole('link', { name: '+1 new' }))
      .toHaveAttribute('href', gridLink('lounges', 'CreatedUtc:>=2026-09-08T00:00:00.000Z'))
  })

  it("says 'No new' as plain text when nothing was added", async () => {
    renderAt('/')

    const airports = await card('Airports')
    expect(within(airports).getByText('No new')).toBeInTheDocument()
    expect(within(airports).queryByRole('link', { name: /new/ })).not.toBeInTheDocument()
  })

  it('verified and unverified counts open the grid filtered by IsVerified', async () => {
    renderAt('/')

    const airlines = await card('Airlines')
    expect(within(airlines).getByRole('link', { name: '540 verified' })).toHaveAttribute('href', gridLink('airlines', 'IsVerified:true'))
    expect(within(airlines).getByRole('link', { name: '152 unverified' })).toHaveAttribute('href', gridLink('airlines', 'IsVerified:false'))
  })

  it('states what share of each entity is verified, beside the count it describes', async () => {
    renderAt('/')

    for (const [name, share] of [['Airlines', '(78%)'], ['Airports', '(99%)'], ['Lounges', '(0%)'], ['Loyalty Programs', '(100%)']]) {
      expect(within(await card(name)).getByText(share, { exact: false })).toBeInTheDocument()
    }
  })

  /** The counts are links to the rows they count; the share is not a set of rows, so it sits
   *  outside the link rather than changing what the link says it opens. */
  it('leaves the share outside the link', async () => {
    renderAt('/')

    const airlines = await card('Airlines')
    expect(within(airlines).getByRole('link', { name: '540 verified' })).toBeInTheDocument()
    expect(within(airlines).queryByRole('link', { name: /%/ })).not.toBeInTheDocument()
  })

  it('states no share for a table with no rows, where there is none to state', async () => {
    install(req => ({
      ...stats(String(req.params?.period)),
      entities: [{ key: 'lounges', dateColumn: 'CreatedUtc', total: 0, newInPeriod: 0, verified: 0, unverified: 0, series: zeros(7) }],
    }))
    renderAt('/')

    const lounges = await card('Lounges')
    expect(within(lounges).getByText('0 verified')).toBeInTheDocument()
    expect(within(lounges).queryByText('%', { exact: false })).not.toBeInTheDocument()
  })

  it('travelers and flights have no verified counts', async () => {
    renderAt('/')

    for (const name of ['Travelers', 'Flights']) {
      expect(within(await card(name)).queryByText(/verified/)).not.toBeInTheDocument()
    }
  })

  it('choosing a period asks for it and keeps it in the URL', async () => {
    const user = userEvent.setup()
    const router = renderAt('/')
    await card('Airlines')

    await user.click(screen.getByRole('button', { name: '30d' }))

    await waitFor(() => expect(statsRequests()[statsRequests().length - 1]?.params).toEqual({ period: '30d' }))
    expect(new URLSearchParams(router.state.location.search).get('period')).toBe('30d')
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens with the period from a shared link', async () => {
    renderAt('/?period=90d')
    await card('Airlines')

    expect(statsRequests()).toEqual([expect.objectContaining({ params: { period: '90d' } })])
    expect(screen.getByRole('button', { name: '90d' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('names the days the window covers', async () => {
    renderAt('/')

    // toUtc is exclusive: the window's last day is the 14th.
    expect(await screen.findByText('Sep 8 – Sep 14 UTC')).toBeInTheDocument()
  })

  it('draws one column per bucket, highlighting only the current one, each with its value on hover', async () => {
    renderAt('/')

    const trend = within(await card('Airlines')).getByRole('img', { name: '3 added in the last 7 days' })
    const columns = trend.querySelectorAll('[data-bucket]')
    expect(columns).toHaveLength(7)
    expect([...columns].map(c => c.getAttribute('data-current'))).toEqual(['false', 'false', 'false', 'false', 'false', 'false', 'true'])
    expect(columns[2].querySelector('title')).toHaveTextContent('Sep 10: 2 added')
    expect(columns[6].querySelector('title')).toHaveTextContent('Sep 14: 1 added')
  })

  it("lists each bucket's count in a table for screen readers", async () => {
    renderAt('/')

    const table = within(await card('Flights')).getByRole('table', { name: 'Flights added per day' })
    const rows = within(table).getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell').map(c => c.textContent))
    expect(rows).toHaveLength(7)
    expect(rows[1]).toEqual(['Sep 9', '1'])
  })

  it('shows why the stats failed to load', async () => {
    install(() => { throw httpError(500) })
    renderAt('/')

    expect(await screen.findByText('Could not load stats: Request failed with status code 500')).toBeInTheDocument()
  })
})
