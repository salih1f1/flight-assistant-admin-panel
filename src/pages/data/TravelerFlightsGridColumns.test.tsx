import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** Every column GET /admin/data/traveler-flights sends, in the order it sends them. */
const TRAVELER_FLIGHT_COLUMNS = ['Id', 'TravelerId', 'FlightId', 'Notify', 'CreatedUtc']

const ANN = '689c6286-951d-40bc-a9e0-bb88f84c7289'
const BEN = 'b6296562-04fc-43de-b77a-077cde30527e'

const ROWS = [
  { Id: ANN, TravelerId: BEN, FlightId: 16, Notify: true, CreatedUtc: '2026-09-18T21:44:30.987798Z' },
  { Id: BEN, TravelerId: BEN, FlightId: 16, Notify: false, CreatedUtc: '2026-09-18T21:45:00Z' },
]

let sent: SentRequest[]

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(404)
    if (req.url === '/admin/data/tables') return [{ slug: 'traveler-flights', displayName: 'Traveler Flights', rowCount: ROWS.length }]
    if (req.url === '/admin/data/traveler-flights') return pagedResult(ROWS, req.params)
    if (req.url === `/admin/travelers/${BEN}`) return { id: BEN, email: '<redacted>', displayName: 'Alex Morgan', createdUtc: '2026-01-02T03:04:05Z' }
    if (req.url === '/admin/flights/16') return { id: 16, flightNumber: 'LS988', serviceDate: '2026-09-30', airlineId: 7, departureAirportId: 11, arrivalAirportId: 12 }
    throw httpError(404)
  }))
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

beforeEach(install)

describe('The traveler flights grid, as a list', () => {
  /**
   * Which traveler, which flight, whether they are notified and when it was tracked. The row's own
   * Id is a 36-character guid that identifies the join rather than either side of it — it is what
   * made this table read as a wall of guids, and it stays a toggle away.
   */
  it('shows the traveler, the flight and the tracking, and not the join\'s own guid', async () => {
    renderAt('/data/traveler-flights')
    await screen.findByRole('table')

    // CreatedUtc is bookkeeping, hidden for every table since #152.
    expect(dataHeaders()).toEqual(['Traveler', 'Flight', 'Notify'])
  })

  it('names the columns after what the cell holds, not after the id the API stores', async () => {
    renderAt('/data/traveler-flights')
    await screen.findAllByRole('link', { name: 'Alex Morgan' })

    const headers = dataHeaders()
    expect(headers).toContain('Traveler')
    expect(headers).toContain('Flight')
    expect(headers).not.toContain('TravelerId')
    expect(headers).not.toContain('FlightId')
  })

  it('brings every column back behind the toggle, in the order the API sends them', async () => {
    const user = userEvent.setup()
    renderAt('/data/traveler-flights')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Show 2 hidden columns' }))

    expect(dataHeaders()).toEqual(['Id', 'Traveler', 'Flight', 'Notify', 'CreatedUtc'])
  })

  it('hides it again, so the trimmed grid is a toggle away and not a one-way door', async () => {
    const user = userEvent.setup()
    renderAt('/data/traveler-flights')
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Show 2 hidden columns' }))

    await user.click(screen.getByRole('button', { name: 'Hide 2 columns' }))

    expect(dataHeaders()).toEqual(['Traveler', 'Flight', 'Notify'])
  })

  /**
   * The header is also the sort control, and the API sorts on the column it stores. A renamed
   * header must not start sending its label — "Traveler ↑" orders by TravelerId, as it always did.
   */
  it('still sorts on the column the API stores, under the new name', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/traveler-flights')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Traveler' }))

    expect(new URLSearchParams(router.state.location.search).get('sort')).toBe('TravelerId')
    expect(sent[sent.length - 1]?.params?.sort).toBe('TravelerId')
  })

  it('leaves a timestamp column named after what it holds', async () => {
    const user = userEvent.setup()
    renderAt('/data/traveler-flights')
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Show 2 hidden columns' }))

    // COLUMN_LABELS renames columns whose cells hold a record; a timestamp already says what it is,
    // so it keeps the API's own name wherever it is shown.
    expect(dataHeaders()).toContain('CreatedUtc')
  })

  /**
   * ExportCsvButton and FilterForm are siblings that each remount on a table change, and both were
   * keyed `table` — one key for two children, which React warns about once anything else in that
   * row renders conditionally (the hidden-columns button, here). A warning fails nothing on its
   * own, so without this the fix would have had no guard at all.
   */
  it('renders the toolbar without two children sharing one key', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(String(args[0])) })
    try {
      renderAt('/data/traveler-flights')
      await screen.findByRole('table')
    } finally {
      spy.mockRestore()
    }

    expect(errors.filter(message => message.includes('same key'))).toEqual([])
  })

  it('sends the API every column it has, whatever the grid is showing', async () => {
    renderAt('/data/traveler-flights')
    await screen.findByRole('table')

    // The trimming is a view: the request carries no column list, so the record page and the
    // toggle still have every column to show.
    expect(sent.some(r => r.url === '/admin/data/traveler-flights' && !('columns' in (r.params ?? {})))).toBe(true)
    expect(TRAVELER_FLIGHT_COLUMNS).toHaveLength(5)
  })
})
