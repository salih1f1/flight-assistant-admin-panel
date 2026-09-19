import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { FlightDetailPage } from './FlightDetailPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const FLIGHT_ID = 42

// Shaped like AdminFlightStatusEventDto.
const DELAYED = { id: 903, statusCode: 'DLY', statusName: 'Delayed', providerRawStatus: 'Delayed' as string | null, effectiveAtUtc: '2026-09-20T09:40:00Z', recordedAtUtc: '2026-09-20T09:41:10Z', source: 'AeroAPI' }
const SCHEDULED = { id: 902, statusCode: 'SCH', statusName: 'Scheduled', providerRawStatus: null as string | null, effectiveAtUtc: '2026-09-19T12:00:00Z', recordedAtUtc: '2026-09-19T12:00:05Z', source: 'AeroAPI' }

// Shaped like AdminFlightDetailDto: current status plus the status history, newest first.
const makeDetail = () => ({
  id: FLIGHT_ID,
  airlineId: 7,
  flightNumber: 'BA117',
  departureAirportId: 11,
  arrivalAirportId: 12,
  serviceDate: '2026-09-20',
  scheduledDepartureUtc: '2026-09-20T10:00:00Z',
  scheduledArrivalUtc: '2026-09-20T17:30:00Z',
  estimatedDepartureUtc: '2026-09-20T10:25:00Z' as string | null,
  estimatedArrivalUtc: null as string | null,
  actualDepartureUtc: null as string | null,
  actualArrivalUtc: null as string | null,
  equipmentAircraftIcao: 'B77W' as string | null,
  currentStatus: DELAYED as typeof DELAYED | null,
  statusHistory: [DELAYED, SCHEDULED],
  statusHistoryTruncated: false,
  // The sync plan (#81), as the admin flight DTOs carry it since backend #443.
  lastSyncedUtc: '2026-09-20T09:41:00Z' as string | null,
  nextSyncDueUtc: '2026-09-20T09:51:00Z' as string | null,
  syncMode: 'Live' as string | null,
  scheduleMissingSinceUtc: null as string | null,
  cancelledAtUtc: null as string | null,
})

// Shaped like AirlineAdminDto and AirportAdminDto, as GET /admin/airlines/{id} and /admin/airports/{id} return them.
const BRITISH_AIRWAYS = { id: 7, iata: 'BA', icao: 'BAW', name: 'British Airways', countryCode: 'GB', allianceCode: 'ONEWORLD' }
const HEATHROW = { id: 11, iata: 'LHR', icao: 'EGLL', name: 'London Heathrow', city: 'London', countryCode: 'GB', latitude: 51.47, longitude: -0.4543, elevationFt: 83 }
const JFK = { id: 12, iata: 'JFK', icao: 'KJFK', name: 'New York JFK', city: 'New York', countryCode: 'US', latitude: 40.6413, longitude: -73.7781, elevationFt: 13 }

let detail: ReturnType<typeof makeDetail>
let sent: SentRequest[]
/** Set by the one test that needs POST /admin/flights/{id}/sync to fail. */
let syncFails: boolean

function renderAt(id: string) {
  const router = createMemoryRouter(
    [{ path: '/flights/:id', element: <FlightDetailPage /> }],
    { initialEntries: [`/flights/${id}`] },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const region = (name: string) => screen.getByRole('region', { name })
const fact = (container: HTMLElement, label: string) => within(container).getByText(label, { selector: 'dt' }).nextElementSibling

describe('FlightDetailPage', () => {
  beforeEach(() => {
    detail = makeDetail()
    syncFails = false
    ;({ sent } = installFakeApi(req => {
      if (req.method === 'POST' && req.url === `/admin/flights/${FLIGHT_ID}/sync`) {
        if (syncFails) throw httpError(503, 'Flight status can\'t be refreshed right now.')
        // Shaped like AdminFlightSyncResultDto.
        return { outcome: 'NoDataYet', lastSyncedUtc: '2026-09-20T09:41:00Z', nextSyncDueUtc: '2026-09-20T09:51:00Z', syncMode: 'Live', scheduleMissingSinceUtc: null }
      }
      if (req.method === 'GET' && req.url === '/admin/airlines/7') return BRITISH_AIRWAYS
      if (req.method === 'GET' && req.url === '/admin/airports/11') return HEATHROW
      if (req.method === 'GET' && req.url === '/admin/airports/12') return JFK
      const match = req.url.match(/^\/admin\/flights\/(\d+)\/detail$/)
      // Results.NotFound(): an empty 404, not ProblemDetails.
      if (req.method === 'GET' && match) {
        if (Number(match[1]) !== FLIGHT_ID) throw httpError(404)
        return detail
      }
      throw httpError(404)
    }))
  })

  it("loads the flight's detail and names it by number and date", async () => {
    renderAt(String(FLIGHT_ID))

    expect(await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: `/admin/flights/${FLIGHT_ID}/detail` }))
    expect(screen.getByRole('link', { name: 'Back to flights' })).toHaveAttribute('href', '/flights')
  })

  it('names the airline and airports, linking to them, rather than showing their ids', async () => {
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    const flight = region('Flight')
    expect(await within(flight).findByRole('link', { name: 'British Airways (BA)' })).toHaveAttribute('href', '/data/airlines/7')
    await waitFor(() => expect(fact(flight, 'Route')).toHaveTextContent('London Heathrow (LHR) → New York JFK (JFK)'))
    expect(within(flight).getByRole('link', { name: 'London Heathrow (LHR)' })).toHaveAttribute('href', '/data/airports/11')
    expect(within(flight).getByRole('link', { name: 'New York JFK (JFK)' })).toHaveAttribute('href', '/data/airports/12')
  })

  it("keeps the id and says it wasn't found when an airline or airport no longer exists", async () => {
    detail = { ...makeDetail(), airlineId: 999, arrivalAirportId: 998 }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    const flight = region('Flight')
    await waitFor(() => expect(fact(flight, 'Airline')).toHaveTextContent('#999, not found'))
    await waitFor(() => expect(fact(flight, 'Route')).toHaveTextContent('London Heathrow (LHR) → #998, not found'))
  })

  it('shows the aircraft and the scheduled, estimated and actual times in UTC', async () => {
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    const flight = region('Flight')
    expect(fact(flight, 'Aircraft')).toHaveTextContent('B77W')
    expect(fact(flight, 'Scheduled departure')).toHaveTextContent('2026-09-20 10:00 UTC')
    expect(fact(flight, 'Estimated departure')).toHaveTextContent('2026-09-20 10:25 UTC')
    expect(fact(flight, 'Actual departure')).toHaveTextContent('—')
    expect(fact(flight, 'Scheduled arrival')).toHaveTextContent('2026-09-20 17:30 UTC')
  })

  it('shows the current status, since when, and where it came from', async () => {
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(region('Current status')).toHaveTextContent('Delayed (DLY) since 2026-09-20 09:40 UTC, from AeroAPI')
  })

  it('says when no status has been recorded yet', async () => {
    detail = { ...makeDetail(), currentStatus: null, statusHistory: [] }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(region('Current status')).toHaveTextContent('No status recorded yet.')
    expect(region('Status history')).toHaveTextContent('No status events.')
  })

  it('lists the status history newest first', async () => {
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    const rows = within(region('Status history')).getAllByRole('row').slice(1)
    expect(rows.map(r => within(r).getAllByRole('cell').map(c => c.textContent))).toEqual([
      ['2026-09-20 09:40 UTC', 'Delayed (DLY)', 'Delayed', 'AeroAPI', '2026-09-20 09:41 UTC'],
      ['2026-09-19 12:00 UTC', 'Scheduled (SCH)', '—', 'AeroAPI', '2026-09-19 12:00 UTC'],
    ])
    expect(region('Status history')).not.toHaveTextContent('most recent')
  })

  it('says when the history was cut off, and links to all of it in the Data page', async () => {
    detail.statusHistoryTruncated = true
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    const history = region('Status history')
    expect(history).toHaveTextContent('Showing the 50 most recent status events.')
    expect(within(history).getByRole('link', { name: 'See all in the Data page' }))
      .toHaveAttribute('href', `/data/flight-status-events?filter=FlightId%3A${FLIGHT_ID}&sort=-EffectiveAtUtc`)
  })

  it("says the flight doesn't exist when the API can't find it", async () => {
    renderAt('99')

    expect(await screen.findByRole('alert')).toHaveTextContent('No flight with id 99.')
  })

  // The route is {id:int}: anything else matches no route, and an unmatched /admin route
  // fails the CORS preflight in the browser instead of returning 404.
  it.each(['abc', '99999999999'])("says '%s' isn't a flight id without asking the API", async id => {
    renderAt(id)

    expect(await screen.findByRole('alert')).toHaveTextContent(`'${id}' isn't a flight id.`)
    await waitFor(() => expect(sent).toHaveLength(0))
  })

  // ── Sync section (#81, spec §3.2) ──

  const syncSection = () => region('Sync')

  it('shows the sync mode, last sync and next sync', async () => {
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    const sync = syncSection()
    expect(within(sync).getByText('Live')).toBeInTheDocument()
    expect(fact(sync, 'Last sync')).toHaveTextContent('2026-09-20 09:41 UTC')
    expect(fact(sync, 'Next sync')).toHaveTextContent('2026-09-20 09:51 UTC')
  })

  it('says a flight nobody tracks is not synced, rather than showing a blank mode', async () => {
    detail = { ...detail, syncMode: null, nextSyncDueUtc: null }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(syncSection()).toHaveTextContent('Not synced (no traveler tracks this flight)')
  })

  // A next sync well in the past means the background loop isn't running — the one thing this
  // section exists to make visible, since nothing else in the panel would show it.
  it('warns when the next sync is overdue', async () => {
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'))
    detail = { ...detail, nextSyncDueUtc: '2026-09-20T09:51:00Z' }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(syncSection()).toHaveTextContent('Next sync overdue')
  })

  it('does not call a next sync barely past overdue', async () => {
    // Four minutes late: the loop runs every minute, so a small lag is normal, not a fault.
    vi.setSystemTime(new Date('2026-09-20T09:55:00Z'))
    detail = { ...detail, nextSyncDueUtc: '2026-09-20T09:51:00Z' }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(syncSection()).not.toHaveTextContent('overdue')
  })

  // Tracking a flight plans it and makes it due at once (backend TrackFlightCommandHandler), so
  // until the loop's next pass the page holds a blank last sync and a next sync just gone by —
  // which reads as "nothing was ever attempted" when the opposite is true.
  it('says the first sync is queued rather than showing two blanks', async () => {
    vi.setSystemTime(new Date('2026-09-20T09:51:30Z'))
    detail = { ...detail, lastSyncedUtc: null, nextSyncDueUtc: '2026-09-20T09:51:00Z' }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(syncSection()).toHaveTextContent('First sync queued')
  })

  it('leaves the queued line off a flight that has synced before', async () => {
    vi.setSystemTime(new Date('2026-09-20T09:51:30Z'))
    detail = { ...detail, lastSyncedUtc: '2026-09-20T09:41:00Z', nextSyncDueUtc: '2026-09-20T09:51:00Z' }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(syncSection()).not.toHaveTextContent('queued')
  })

  // Both lines explain the same silence, and they explain it differently. Only one can be shown.
  it('drops the queued line for the overdue warning once the sync is late', async () => {
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'))
    detail = { ...detail, lastSyncedUtc: null, nextSyncDueUtc: '2026-09-20T09:51:00Z' }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(syncSection()).toHaveTextContent('Next sync overdue')
    expect(syncSection()).not.toHaveTextContent('queued')
  })

  it('warns when the flight has gone missing from the schedule', async () => {
    detail = { ...detail, scheduleMissingSinceUtc: '2026-09-18T06:00:00Z' }
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    expect(syncSection()).toHaveTextContent('Not in schedule since 2026-09-18 06:00 UTC')
  })

  it('syncs the flight and says what the sync did', async () => {
    const user = userEvent.setup()
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    await user.click(within(syncSection()).getByRole('button', { name: 'Sync now' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'AeroAPI has no live data for this flight yet. Next sync 2026-09-20 09:51 UTC.')
    expect(sent).toContainEqual(expect.objectContaining({ method: 'POST', url: `/admin/flights/${FLIGHT_ID}/sync` }))
  })

  it('shows a failed sync as an error, not as an outcome', async () => {
    syncFails = true
    const user = userEvent.setup()
    renderAt(String(FLIGHT_ID))
    await screen.findByRole('heading', { name: 'BA117 · 2026-09-20' })

    await user.click(within(syncSection()).getByRole('button', { name: 'Sync now' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sync')
  })
})
