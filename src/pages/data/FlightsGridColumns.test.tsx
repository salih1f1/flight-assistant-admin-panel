import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

/**
 * Picks a filter column by the name the API knows it as, which is what these tests hold: the
 * picker shows a friendlier label, so the raw name is typed into its search and matched there.
 */
async function chooseFilterColumn(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Filter column' }))
  await user.type(screen.getByRole('textbox', { name: 'Search columns' }), name)
  const shown = within(screen.getByRole('listbox')).getAllByRole('option')
  if (shown.length !== 1) throw new Error(`"${name}" matched ${shown.length} columns, not one`)
  await user.click(shown[0])
}

/** What the filter picker is offering right now, read from its open panel. */
async function filterColumnOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Filter column' }))
  const shown = within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)
  await user.keyboard('{Escape}')
  return shown
}


vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** Shaped like BrowsableColumnDto, as GET /admin/data/tables publishes them. */
const column = (name: string, kind: string, values: string[] | null = null) => ({ name, kind, values })

const FLIGHT_COLUMNS = [
  column('Id', 'Number'),
  column('AirlineId', 'Number'),
  column('FlightNumber', 'Text'),
  column('DepartureAirportId', 'Number'),
  column('ArrivalAirportId', 'Number'),
  column('ServiceDateUtc', 'Date'),
  column('ScheduledDepartureUtc', 'Date'),
  column('ScheduledArrivalUtc', 'Date'),
  column('EstimatedDepartureUtc', 'Date'),
  column('EquipmentAircraftIcao', 'Text'),
  column('SyncMode', 'Enum', ['Fast', 'Live', 'Schedule', 'Stopped']),
  column('LastSyncedUtc', 'Date'),
  column('CreatedUtc', 'Date'),
]

const PROVIDER_COLUMNS = [column('Id', 'Number'), column('Code', 'Text'), column('Name', 'Text')]

const FLIGHT = {
  Id: 16, AirlineId: 242, FlightNumber: 'LS988', DepartureAirportId: 2276, ArrivalAirportId: 4593,
  ServiceDateUtc: '2026-09-30', ScheduledDepartureUtc: '2026-09-30T10:10:00Z',
  ScheduledArrivalUtc: '2026-09-30T13:15:00Z', EstimatedDepartureUtc: null,
  EquipmentAircraftIcao: 'B738', SyncMode: 'Schedule', LastSyncedUtc: '2026-09-29T22:00:00Z',
  CreatedUtc: '2026-09-01T00:00:00Z',
}

const PROVIDER = { Id: 3, Code: 'PP', Name: 'Priority Pass' }

const JET2 = { id: 242, iata: 'LS', icao: 'EXS', name: 'Jet2', countryCode: 'GB' }
const GATWICK = { id: 2276, iata: 'LGW', icao: 'EGKK', name: 'London Gatwick', city: 'London', countryCode: 'GB' }
const SCHIPHOL = { id: 4593, iata: 'AMS', icao: 'EHAM', name: 'Amsterdam Schiphol', city: 'Amsterdam', countryCode: 'NL' }

let sent: SentRequest[]

function install() {
  sent = installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(404)
    if (req.url === '/admin/data/tables') {
      return [
        { slug: 'flights', displayName: 'Flights', rowCount: 1, columns: FLIGHT_COLUMNS },
        { slug: 'lounge-providers', displayName: 'Lounge Providers', rowCount: 1, columns: PROVIDER_COLUMNS },
      ]
    }
    if (req.url === '/admin/data/flights') return pagedResult([FLIGHT], req.params)
    if (req.url === '/admin/data/lounge-providers') return pagedResult([PROVIDER], req.params)
    if (req.url === '/admin/airlines/242') return JET2
    if (req.url === '/admin/airports/2276') return GATWICK
    if (req.url === '/admin/airports/4593') return SCHIPHOL
    throw httpError(404)
  }).sent
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

describe('The flights grid, as a list', () => {
  beforeEach(install)

  /**
   * SyncMode is on this list deliberately: syncRowTone says the row tint is never the only signal
   * because that column is rendered as text beside it, and the colour legend above the grid reads
   * against it. The rest of the flight — its times, equipment and sync bookkeeping — is on the
   * record and detail pages, and behind the grid's own hidden-columns button.
   */
  it('shows the route and nothing else', async () => {
    renderAt('/data/flights')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Airline', 'FlightNumber', 'From', 'To', 'ServiceDateUtc', 'SyncMode'])
  })

  // Lounges used to be this control, until they got a list of their own; lounge providers are a
  // table that still has none, so the fallback rule is what shapes their grid: everything the API
  // sends except the bookkeeping columns, Id among them since #153.
  it('leaves a table with no list of its own showing everything but its bookkeeping', async () => {
    renderAt('/data/lounge-providers')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Code', 'Name'])
  })

  it('offers only the columns worth filtering a flight by', async () => {
    const user = userEvent.setup()
    renderAt('/data/flights')
    await screen.findByRole('table')

    expect(await filterColumnOptions(user)).toEqual(['Airline', 'FlightNumber', 'From', 'To', 'ServiceDateUtc', 'SyncMode'])
  })

  /** The toggle means "show me everything" in both places, so it is also how you reach the rest. */
  it('offers every column to filter on once all columns are shown', async () => {
    const user = userEvent.setup()
    renderAt('/data/flights?columns=all')
    await screen.findByRole('table')

    expect(await filterColumnOptions(user)).toEqual(FLIGHT_COLUMNS.map(c => c.name === 'AirlineId' ? 'Airline'
      : c.name === 'DepartureAirportId' ? 'From' : c.name === 'ArrivalAirportId' ? 'To' : c.name))
  })

  /** A shared link may filter on a column the list leaves out; the form must not silently show another. */
  /**
   * The chip names the column a shared link filters on, and the picker keeps offering it even
   * though the table's own list leaves it out — otherwise removing the chip would be a dead end,
   * with no way to filter on that column again.
   */
  it('keeps showing a column a shared link filters on, off the list or not', async () => {
    const user = userEvent.setup()
    renderAt('/data/flights?filter=LastSyncedUtc:2026-09-29')
    await screen.findByRole('table')

    expect(screen.getByText('LastSyncedUtc: 2026-09-29')).toBeInTheDocument()
    expect(await filterColumnOptions(user)).toContain('LastSyncedUtc')
  })

  it('still filters on the column name the API knows, whatever the picker calls it', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/flights')
    await screen.findByRole('table')

    await chooseFilterColumn(user, 'DepartureAirportId')
    await user.type(screen.getByLabelText('Filter value'), '2276')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))

    expect(new URLSearchParams(router.state.location.search).get('filter')).toBe('DepartureAirportId:2276')
  })

  /** There is no by-code endpoint, so the box takes an id — it should at least say which one. */
  it('names the airport an id stands for before the filter is applied', async () => {
    const user = userEvent.setup()
    renderAt('/data/flights')
    await screen.findByRole('table')

    await chooseFilterColumn(user, 'DepartureAirportId')
    await user.type(screen.getByLabelText('Filter value'), '2276')

    expect(await screen.findByRole('link', { name: 'London Gatwick (LGW)' })).toBeInTheDocument()
  })

  /** Every keystroke on the way to "2276" is an id of its own — 2, 22, 227 — and each would be a
   *  lookup for a record nobody asked about if the preview read the box as it was typed. */
  it('asks for nothing while an id is still being typed', async () => {
    const user = userEvent.setup()
    renderAt('/data/flights')
    await screen.findByRole('table')

    await chooseFilterColumn(user, 'DepartureAirportId')
    await user.type(screen.getByLabelText('Filter value'), '2276')
    await screen.findByRole('link', { name: 'London Gatwick (LGW)' })

    // The ids asked about, not the number of requests: this client has no staleTime, so a second
    // mount of an already-cached lookup refetches it. What matters is that 2, 22 and 227 — the ids
    // on the way to 2276 — were never records anyone asked for.
    const asked = [...new Set(sent.filter(r => /^\/admin\/airports\/\d+$/.test(r.url)).map(r => r.url))].sort()
    expect(asked).toEqual(['/admin/airports/2276', '/admin/airports/4593'])
  })
})
