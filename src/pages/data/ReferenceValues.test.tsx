import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'
import { RecordPage } from './RecordPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'traveler-flights', displayName: 'Traveler Flights', rowCount: 2 },
  { slug: 'flights', displayName: 'Flights', rowCount: 1 },
]

type Row = Record<string, unknown>

const ANN = '689c6286-951d-40bc-a9e0-bb88f84c7289'
const BEN = 'b6296562-04fc-43de-b77a-077cde30527e'

/**
 * Two rows on one traveler (so the traveler lookup is asked for once), one of them on a flight
 * that no longer exists, and a CreatedUtc carrying the microseconds the API really sends.
 */
const ROWS: Record<string, Row[]> = {
  'traveler-flights': [
    { Id: ANN, TravelerId: ANN, FlightId: 16, Notify: true, CreatedUtc: '2026-09-18T21:44:30.987798Z' },
    { Id: BEN, TravelerId: ANN, FlightId: 99, Notify: false, CreatedUtc: '2026-09-18T21:45:00Z' },
  ],
  // A …At column holding something that isn't an instant. Date.parse would take '2026' and hand
  // back midnight on New Year's Day, so the column is matched on the ISO shape, not on whether
  // Date.parse can make something of it — this row is what says so.
  flights: [{ Id: 16, FlightNumber: 'BA117', AirlineId: 7, DepartureAirportId: 11, RetiredAt: '2026' }],
}

const TRAVELERS: Record<string, unknown> = {
  [ANN]: { id: ANN, email: '<redacted>', displayName: 'Ann Example', createdUtc: '2026-01-02T03:04:05Z' },
}

const FLIGHTS: Record<number, unknown> = {
  16: { id: 16, flightNumber: 'BA117', serviceDate: '2026-09-20', airlineId: 7, departureAirportId: 11, arrivalAirportId: 12 },
}

let sent: SentRequest[]

function api(req: SentRequest) {
  if (req.method !== 'GET') throw httpError(405)
  if (req.url === '/admin/data/tables') return TABLES

  const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
  if (table && ROWS[table]) {
    let rows = ROWS[table]
    for (const filter of (req.params?.filter ?? []) as string[]) {
      const [column, ...rest] = filter.split(':')
      const value = rest.join(':')
      rows = rows.filter(r => (typeof r[column] === 'string'
        ? (r[column] as string).toLowerCase().includes(value.toLowerCase())
        : String(r[column]) === value))
    }
    return pagedResult(rows, req.params)
  }

  const travelerId = req.url.match(/^\/admin\/travelers\/([0-9a-f-]+)$/)?.[1]
  if (travelerId) {
    const traveler = TRAVELERS[travelerId]
    if (!traveler) throw httpError(404)
    return traveler
  }

  const flightId = Number(req.url.match(/^\/admin\/flights\/(\d+)$/)?.[1])
  if (flightId) {
    const flight = FLIGHTS[flightId]
    if (!flight) throw httpError(404)
    return flight
  }

  if (req.url === '/admin/airlines/7') return { id: 7, iata: 'BA', icao: 'BAW', name: 'British Airways' }
  if (req.url === '/admin/airports/11') return { id: 11, iata: 'LHR', icao: 'EGLL', name: 'London Heathrow' }

  throw httpError(404)
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/data/:table', element: <DataBrowserPage /> },
      { path: '/data/:table/:id', element: <RecordPage /> },
    ],
    { initialEntries: [entry] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!
const gets = (url: string) => sent.filter(r => r.method === 'GET' && r.url === url)

beforeEach(() => {
  ({ sent } = installFakeApi(api))
})

describe('references in the raw grid', () => {
  it('names the traveler a row belongs to, and links to them', async () => {
    renderAt('/data/traveler-flights')

    const link = await screen.findAllByRole('link', { name: 'Ann Example' })
    expect(link[0]).toHaveAttribute('href', `/travelers/${ANN}`)
  })

  it('names the flight a row tracks, and links to it', async () => {
    renderAt('/data/traveler-flights')

    const link = await screen.findByRole('link', { name: 'BA117 · 2026-09-20' })
    expect(link).toHaveAttribute('href', '/flights/16')
  })

  it('says so when the referenced record is gone, rather than showing a bare id', async () => {
    renderAt('/data/traveler-flights')

    expect(await screen.findByText('#99, not found')).toBeInTheDocument()
  })

  it('asks for a referenced record once, however many rows point at it', async () => {
    renderAt('/data/traveler-flights')
    await screen.findAllByRole('link', { name: 'Ann Example' })

    expect(gets(`/admin/travelers/${ANN}`)).toHaveLength(1)
  })

  it('shows a timestamp to the minute in UTC, keeping the exact value in the title', async () => {
    renderAt('/data/traveler-flights')

    const shown = await screen.findByText('2026-09-18 21:44 UTC')
    expect(shown).toHaveAttribute('title', '2026-09-18T21:44:30.987798Z')
  })

  it("leaves the row's own key alone, since that is the value an admin copies", async () => {
    renderAt('/data/traveler-flights')
    const row = await rowOf(ANN)

    expect(within(row).getByText(ANN)).toBeInTheDocument()
  })

  // With all columns shown: RetiredAt is outside the flights list (LIST_COLUMNS), and the claim
  // here is about any timestamp column, not about which of them a flight's list happens to show.
  it('leaves a timestamp column alone when its value is not an instant', async () => {
    renderAt('/data/flights?columns=all')
    await screen.findByRole('link', { name: 'British Airways (BA)' })

    expect(screen.getByText('2026')).toBeInTheDocument()
    expect(screen.queryByText('2026-01-01 00:00 UTC')).not.toBeInTheDocument()
  })

  it('resolves the references of other tables too, not just traveler flights', async () => {
    renderAt('/data/flights')

    expect(await screen.findByRole('link', { name: 'British Airways (BA)' })).toBeInTheDocument()
    // An airport is its code in a grid cell and its full name on the record page, which is the one
    // column that reads differently in the two views — see columnValue's COMPACT_REFERENCES.
    expect(await screen.findByRole('link', { name: 'LHR' })).toBeInTheDocument()
  })
})

describe('references on the record page', () => {
  it('names the traveler and the flight the record refers to', async () => {
    renderAt(`/data/traveler-flights/${ANN}`)

    expect(await screen.findByRole('link', { name: 'Ann Example' })).toHaveAttribute('href', `/travelers/${ANN}`)
    expect(await screen.findByRole('link', { name: 'BA117 · 2026-09-20' })).toHaveAttribute('href', '/flights/16')
  })

  it('formats the timestamps the record carries', async () => {
    renderAt(`/data/traveler-flights/${ANN}`)

    expect(await screen.findByText('2026-09-18 21:44 UTC')).toBeInTheDocument()
  })

  it('heads a record with no name of its own by a short id, not the whole guid', async () => {
    renderAt(`/data/traveler-flights/${ANN}`)

    expect(await screen.findByRole('heading', { name: 'Traveler Flights #689c6286' })).toBeInTheDocument()
  })

  it('keeps the whole id on the page, under the heading and in the field', async () => {
    renderAt(`/data/traveler-flights/${ANN}`)
    await screen.findByRole('heading', { name: 'Traveler Flights #689c6286' })

    expect(screen.getAllByText(ANN, { exact: false }).length).toBeGreaterThan(0)
  })
})
