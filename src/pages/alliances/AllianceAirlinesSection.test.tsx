import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, rawRows, type SentRequest } from '@/test/fakeApi'
import { RecordPage } from '@/pages/data/RecordPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'alliances', displayName: 'Alliances', rowCount: 2 },
  { slug: 'countries', displayName: 'Countries', rowCount: 1 },
]

const ROWS: Record<string, object[]> = {
  alliances: [
    { id: 2, code: 'SA', name: 'Star Alliance', isVerified: true },
    { id: 4, code: 'ST', name: 'SkyTeam', isVerified: false },
  ],
  countries: [{ code: 'US', name: 'United States' }],
}

const starAlliance = {
  id: 2,
  code: 'SA',
  name: 'Star Alliance',
  airlines: [
    { id: 11, iata: 'LH', icao: 'DLH', name: 'Lufthansa', countryCode: 'DE', loyaltyProgramName: 'Miles & More' },
    // An airline that runs no program of its own: on the list, with an empty cell.
    { id: 12, iata: 'TK', icao: 'THY', name: 'Turkish Airlines', countryCode: 'TR', loyaltyProgramName: null },
  ],
}

const skyTeam = { id: 4, code: 'ST', name: 'SkyTeam', airlines: [] }

function api(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
  if (req.method === 'GET' && req.url === '/admin/verification-requests') return []
  if (req.method === 'GET' && req.url === '/admin/alliances/2/detail') return starAlliance
  if (req.method === 'GET' && req.url === '/admin/alliances/4/detail') return skyTeam
  if (req.method === 'GET' && req.url === '/admin/alliances/9/detail') throw httpError(500)
  const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
  if (req.method === 'GET' && table && ROWS[table]) return pagedResult(rawRows(ROWS[table]), req.params)
  throw httpError(404)
}

function renderRecord(table: string, id: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/data/:table/:id', element: <RecordPage /> }], {
    initialEntries: [`/data/${table}/${id}`],
  })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}

beforeEach(() => {
  installFakeApi(api)
})

/**
 * The members are what an alliance is: they belong on the alliance's own page, below its fields,
 * the way a loyalty program's tiers sit on the program (#170) — not behind a link to a page of
 * their own, which is where they used to live (#174).
 */
describe("an alliance's airlines, on the alliance's record page", () => {
  it('lists every member airline in the order the API returned them', async () => {
    renderRecord('alliances', '2')

    await screen.findByRole('table', { name: 'Airlines' })
    const names = screen.getAllByTestId('alliance-airline-name').map(n => n.textContent)
    expect(names).toEqual(['Lufthansa', 'Turkish Airlines'])
  })

  it("shows each airline's codes, country and loyalty program", async () => {
    renderRecord('alliances', '2')

    const row = (await screen.findByText('Lufthansa')).closest('tr')!
    expect(row).toHaveTextContent('LH')
    expect(row).toHaveTextContent('DLH')
    expect(row).toHaveTextContent('DE')
    expect(row).toHaveTextContent('Miles & More')
  })

  /**
   * Most airlines run no program of their own. The row is still the alliance's member, so it
   * stays on the list with an empty cell rather than being dropped or blamed for an error.
   */
  it('keeps an airline with no loyalty program, with an empty cell', async () => {
    renderRecord('alliances', '2')

    const row = (await screen.findByText('Turkish Airlines')).closest('tr')!
    expect(row).toHaveTextContent('TK')
    expect(row).toHaveTextContent('—')
  })

  it('links each airline to its own record', async () => {
    renderRecord('alliances', '2')

    const link = await screen.findByRole('link', { name: 'Lufthansa' })
    expect(link).toHaveAttribute('href', '/data/airlines/11')
  })

  it('says how many airlines are in the alliance', async () => {
    renderRecord('alliances', '2')

    expect(await screen.findByText(/2 airlines/i)).toBeInTheDocument()
  })

  /** An alliance nobody belongs to is a 200 with an empty list, not an error or an empty table. */
  it('an alliance with no airlines says so instead of showing an empty table', async () => {
    renderRecord('alliances', '4')

    expect(await screen.findByText(/no airlines/i)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Airlines' })).not.toBeInTheDocument()
  })

  /**
   * The airlines come from a second call. A failure there must not take the record's own fields
   * or its verify panel down with it — those loaded from a different request and are still good.
   */
  it('reports a failed airlines load without hiding the record itself', async () => {
    installFakeApi(req => {
      if (req.method === 'GET' && req.url === '/admin/alliances/2/detail') throw httpError(500)
      return api(req)
    })
    renderRecord('alliances', '2')

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Star Alliance' })).toBeInTheDocument()
  })

  it("leaves every other table's record page alone", async () => {
    renderRecord('countries', 'US')

    expect(await screen.findByRole('heading', { name: 'United States' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Airlines' })).not.toBeInTheDocument()
  })

  /** The link to the old page goes with the page: the list is on this screen now. */
  it('no longer links away to a separate airlines page', async () => {
    renderRecord('alliances', '2')

    await screen.findByRole('table', { name: 'Airlines' })
    expect(screen.queryByRole('link', { name: /airlines in this alliance/i })).not.toBeInTheDocument()
  })
})
