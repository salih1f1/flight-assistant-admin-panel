import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'lounges', displayName: 'Lounges', rowCount: 2 },
  { slug: 'lounge-providers', displayName: 'Lounge Providers', rowCount: 1 },
]

/** Every column GET /admin/data/lounges sends, in the order it sends them. */
const LOUNGE_COLUMNS = [
  'Id', 'AirportId', 'Name', 'Terminal', 'LocationHint', 'Hours',
  'IsAirside', 'IsDomesticOnly', 'IsInternationalOnly', 'Amenities',
  'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue',
]

/** The bookkeeping columns lounges already started without, before any list of its own. */
const BOOKKEEPING = ['IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue']

const lounge = (id: number, name: string, terminal: string) => ({
  Id: id,
  AirportId: 4277,
  Name: name,
  Terminal: terminal,
  LocationHint: 'Near gate 12',
  Hours: '05:00-22:00',
  IsAirside: true,
  IsDomesticOnly: false,
  IsInternationalOnly: false,
  Amenities: 'Showers, wifi',
  IsVerified: false,
  VerifiedAt: null,
  VerifiedBy: null,
  VerificationSource: null,
  VerificationIssue: null,
})

const ROWS: Record<string, Record<string, unknown>[]> = {
  // Two lounges at the same airport, as Heathrow really has: one airport lookup for both rows.
  lounges: [
    lounge(1, 'British Airways Galleries Club', 'T3'),
    lounge(2, 'American Airlines Admirals Club', 'T3'),
  ],
  'lounge-providers': [
    { Id: 1, Code: 'PP', Name: 'Priority Pass', Kind: 'Membership', Description: 'Independent lounge network' },
  ],
}

function api(req: { method: string; url: string; params?: Record<string, unknown> }) {
  if (req.method !== 'GET') throw httpError(405)
  if (req.url === '/admin/data/tables') return TABLES
  const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
  if (table && ROWS[table]) return pagedResult(ROWS[table], req.params)
  if (req.url === '/admin/airports/4277') return { id: 4277, iata: 'LHR', icao: 'EGLL', name: 'London Heathrow' }
  throw httpError(404)
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/** The grid's data column headers, leaving out the select, verify and actions columns. */
const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

beforeEach(() => {
  installFakeApi(api)
})

describe('the lounges grid, trimmed to what a list needs', () => {
  it('shows the airport, the name and the terminal, and leaves the rest off', async () => {
    renderAt('/data/lounges')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Airport', 'Name', 'Terminal'])
  })

  it('heads the airport column Airport, not AirportId, since it holds no id', async () => {
    renderAt('/data/lounges')
    await screen.findByRole('table')

    expect(screen.queryByRole('columnheader', { name: 'AirportId' })).not.toBeInTheDocument()
  })

  it('still sorts on the column the API knows, not on the label', async () => {
    const user = userEvent.setup()
    renderAt('/data/lounges')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Airport' }))

    expect(screen.getByRole('button', { name: 'Airport ↑' })).toBeInTheDocument()
  })

  it('brings every column back behind the toggle, in the order the API sends them', async () => {
    const user = userEvent.setup()
    renderAt('/data/lounges')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Show 12 hidden columns' }))

    expect(dataHeaders()).toEqual(LOUNGE_COLUMNS.map(name => (name === 'AirportId' ? 'Airport' : name)))
  })

  it('hides them again, so the trimmed grid is a toggle away and not a one-way door', async () => {
    const user = userEvent.setup()
    renderAt('/data/lounges')
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Show 12 hidden columns' }))

    await user.click(screen.getByRole('button', { name: 'Hide 12 columns' }))

    expect(dataHeaders()).toEqual(['Airport', 'Name', 'Terminal'])
  })

  it('leaves a table with no list of its own showing every column, as before', async () => {
    renderAt('/data/lounge-providers')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Id', 'Code', 'Name', 'Kind', 'Description'])
  })
})

describe('the airport a lounge is in', () => {
  it('names it by its code, which is what fits a grid column', async () => {
    renderAt('/data/lounges')

    const links = await screen.findAllByRole('link', { name: 'LHR' })
    expect(links[0]).toHaveAttribute('href', '/data/airports/4277')
  })

  it('keeps the full name a hover away, so the code is never the only thing said', async () => {
    renderAt('/data/lounges')

    const links = await screen.findAllByRole('link', { name: 'LHR' })
    expect(links[0]).toHaveAttribute('title', 'London Heathrow (LHR)')
  })
})

describe('verifying a lounge', () => {
  /*
   * The dialog's field list is built from the columns the grid would show without the "show all"
   * toggle, and lounges have no entry in CHECKED_COLUMNS to override it. Trimming the grid must
   * not quietly narrow what an admin is confirming when they verify a lounge by hand: the record
   * is the whole record, whatever the list chooses to show.
   */
  it('asks about the columns the grid leaves off, not only the three it shows', async () => {
    const user = userEvent.setup()
    renderAt('/data/lounges')
    await screen.findByRole('table')

    await user.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Verify' }))

    const dialog = within(screen.getByRole('dialog'))
    for (const name of LOUNGE_COLUMNS.filter(column => !BOOKKEEPING.includes(column))) {
      expect(dialog.getByText(name)).toBeInTheDocument()
    }
  })
})
