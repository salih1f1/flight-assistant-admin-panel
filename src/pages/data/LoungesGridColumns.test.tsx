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

/** Every column GET /admin/data/lounges sends, in the order it sends them. */
const LOUNGE_COLUMNS = [
  'Id', 'AirportId', 'Name', 'Terminal', 'LocationHint', 'Hours',
  'IsAirside', 'IsDomesticOnly', 'IsInternationalOnly', 'Amenities',
  'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue',
]

/** The columns lounges started without before they had a list: bookkeeping, and IsVerified. */
const BOOKKEEPING = ['IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue']

const lounge = (id: number, name: string) => ({
  Id: id,
  AirportId: 2276,
  Name: name,
  Terminal: 'South',
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

// Two lounges at the same airport, as a terminal really has.
const LOUNGES = [lounge(1, 'No1 Lounge'), lounge(2, 'Clubrooms')]

const GATWICK = { id: 2276, iata: 'LGW', icao: 'EGKK', name: 'London Gatwick', city: 'London', countryCode: 'GB' }

function install() {
  installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(404)
    if (req.url === '/admin/data/tables') return [{ slug: 'lounges', displayName: 'Lounges', rowCount: LOUNGES.length }]
    if (req.url === '/admin/data/lounges') return pagedResult(LOUNGES, req.params)
    if (req.url === '/admin/airports/2276') return GATWICK
    throw httpError(404)
  })
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

beforeEach(install)

describe('The lounges grid, as a list', () => {
  /**
   * Which airport, which lounge, which terminal: the three things that tell one lounge at an
   * airport from another. The location hint, the hours, the three flags and the amenities are
   * what you read once you have found it, not what you find it by.
   */
  it('shows which airport, which lounge and which terminal, and nothing else', async () => {
    renderAt('/data/lounges')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Airport', 'Name', 'Terminal'])
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
})

describe('Verifying a lounge', () => {
  /*
   * The Verify dialog's field list comes from the columns the grid would show without the "show
   * all" toggle, and only airports, airlines and countries have a CHECKED_COLUMNS entry to
   * override it. So the moment a verifiable table joins LIST_COLUMNS — which lounges just did —
   * deriving that list from the grid's would quietly narrow "verify this lounge" from confirming
   * a record to confirming three fields. Lounges are the first table where the two differ, which
   * makes this the test that holds them apart.
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
