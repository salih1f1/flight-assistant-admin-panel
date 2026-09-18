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

/**
 * Loyalty program kinds: a small reference table with no list of its own, so it falls back on the
 * "hide the bookkeeping columns" rule — which is exactly the case this is about (#153). Its four
 * real columns are the id and the three that say what the kind is.
 */
const KINDS = [
  { Id: 1, Code: 'FF', Name: 'Frequent Flyer', Description: 'Airline frequent flyer program', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 2, Code: 'HOTEL', Name: 'Hotel Loyalty', Description: 'Hotel loyalty program', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
]

/** A guid-keyed join table: the id is widest here and says least, and the row is its two ends. */
const TRAVELER_FLIGHTS = [
  { Id: '6f1c7c58-6a0e-4f0e-9a4b-3b0f2a1d77c1', TravelerId: 7, FlightId: 42, Notify: true },
]

function install() {
  installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(404)
    if (req.url === '/admin/data/tables') {
      return [
        { slug: 'loyalty-program-kinds', displayName: 'Loyalty Program Kinds', rowCount: KINDS.length },
        { slug: 'traveler-flights', displayName: 'Traveler Flights', rowCount: TRAVELER_FLIGHTS.length },
      ]
    }
    if (req.url === '/admin/data/loyalty-program-kinds') return pagedResult(KINDS, req.params)
    if (req.url === '/admin/data/traveler-flights') return pagedResult(TRAVELER_FLIGHTS, req.params)
    throw httpError(404)
  })
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserPage /> }, { path: '/data/:table/:id', element: <p>record page</p> }],
    { initialEntries: [entry] },
  )
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

describe('Id, on a table with no list of its own', () => {
  /**
   * A row is identified by its code and its name; the id is how the API stores it. Flights (#132)
   * and lounges (#136) each reached that conclusion for one table at a time by leaving Id out of
   * LIST_COLUMNS — this is the same rule, kept once, where the other bookkeeping columns live.
   */
  it('is not one of the columns the grid opens on', async () => {
    renderAt('/data/loyalty-program-kinds')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Code', 'Name', 'Description'])
  })

  it('is hidden on a guid-keyed table too, where it is widest and says least', async () => {
    renderAt('/data/traveler-flights')
    await screen.findByRole('table')

    // Headed by what the cells hold rather than by the columns the API stores them in (#151).
    expect(dataHeaders()).toEqual(['Traveler', 'Flight', 'Notify'])
  })

  it('comes back with the other hidden columns, in the order the API sends them', async () => {
    const user = userEvent.setup()
    renderAt('/data/loyalty-program-kinds')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Show 6 hidden columns' }))

    expect(dataHeaders()).toEqual(['Id', 'Code', 'Name', 'Description', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'])
  })

  /** Nothing reads the id off the grid: the row's link takes it from the row data. */
  it('still opens the record it identifies, from a row that no longer shows it', async () => {
    renderAt('/data/loyalty-program-kinds')
    await screen.findByRole('table')

    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/data/loyalty-program-kinds/1')
  })
})
