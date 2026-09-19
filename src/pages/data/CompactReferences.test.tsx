import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'
import { RecordPage } from './RecordPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'flights', displayName: 'Flights', rowCount: 1 },
  { slug: 'lounges', displayName: 'Lounges', rowCount: 1 },
]

const FLIGHT = {
  Id: 16, AirlineId: 242, FlightNumber: 'LS988', DepartureAirportId: 2276, ArrivalAirportId: 4593,
  ServiceDateUtc: '2026-09-30', ScheduledDepartureUtc: '2026-09-30T10:10:00Z', SyncMode: 'Schedule',
}

const LOUNGE = { Id: 3, AirportId: 2276, Name: 'No1 Lounge', Terminal: 'South' }

// Shaped like AirlineAdminDto and AirportAdminDto, as GET /admin/airlines/{id} and /admin/airports/{id} return them.
const JET2 = { id: 242, iata: 'LS', icao: 'EXS', name: 'Jet2', countryCode: 'GB' }
const GATWICK = { id: 2276, iata: 'LGW', icao: 'EGKK', name: 'London Gatwick', city: 'London', countryCode: 'GB' }
const SCHIPHOL = { id: 4593, iata: 'AMS', icao: 'EHAM', name: 'Amsterdam Schiphol', city: 'Amsterdam', countryCode: 'NL' }

const ROWS: Record<string, Record<string, unknown>[]> = { flights: [FLIGHT], lounges: [LOUNGE] }

function install() {
  installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(405)
    if (req.url === '/admin/data/tables') return TABLES
    const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
    if (table && ROWS[table]) {
      const filters = (req.params?.filter ?? []) as string[]
      const rows = filters.reduce((kept, filter) => {
        const [column, ...rest] = filter.split(':')
        return kept.filter(r => String(r[column]) === rest.join(':'))
      }, ROWS[table])
      return pagedResult(rows, req.params)
    }
    if (req.url === '/admin/airlines/242') return JET2
    if (req.url === '/admin/airports/2276') return GATWICK
    if (req.url === '/admin/airports/4593') return SCHIPHOL
    throw httpError(404)
  })
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/data/:table', element: <DataBrowserPage /> },
      { path: '/data/:table/:id', element: <RecordPage /> },
    ],
    { initialEntries: [entry] },
  )
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

/**
 * The grid reads a raw row through the same columnValue as the record page, but asks for it
 * compactly: an airport is the three letters a route is made of, not the name the field has room
 * for. Everything else about references is covered in ReferenceValues.test.tsx.
 */
describe('A reference in a grid cell', () => {
  beforeEach(install)

  it('shows an airport as its IATA code, with the full name on hover', async () => {
    renderAt('/data/flights')

    const departure = await screen.findByRole('link', { name: 'LGW' })
    expect(departure).toHaveAttribute('href', '/data/airports/2276')
    expect(departure).toHaveAttribute('title', 'London Gatwick')
    expect(await screen.findByRole('link', { name: 'AMS' })).toHaveAttribute('href', '/data/airports/4593')
  })

  it("does the same for a lounge's airport, since the column is what decides", async () => {
    renderAt('/data/lounges')

    expect(await screen.findByRole('link', { name: 'LGW' })).toHaveAttribute('href', '/data/airports/2276')
  })

  /** The record page has room for the name, and is where the code alone would say least. */
  it('spells the same airport out in full on the record page', async () => {
    renderAt('/data/lounges/3')

    expect(await screen.findByRole('link', { name: 'London Gatwick (LGW)' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'LGW' })).not.toBeInTheDocument()
  })

  it('leaves an airline by name, which has no shorter form worth showing', async () => {
    renderAt('/data/flights')

    expect(await screen.findByRole('link', { name: 'Jet2 (LS)' })).toHaveAttribute('href', '/data/airlines/242')
  })

  it('heads the column by what it holds, not by the id it stores', async () => {
    renderAt('/data/flights?columns=all')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Id', 'Airline', 'FlightNumber', 'From', 'To', 'ServiceDateUtc', 'ScheduledDepartureUtc', 'SyncMode'])
  })

  it('still sorts that column by the name the API knows it as', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/flights?columns=all')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Airline' }))

    expect(new URLSearchParams(router.state.location.search).get('sort')).toBe('AirlineId')
  })
})
