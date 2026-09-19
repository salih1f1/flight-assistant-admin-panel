import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { TrackFlightPage } from './TrackFlightPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TRAVELER_ID = '3f2b8c1e-9a4d-4e6b-8f10-2c7d5e9a1b01'
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

// Shaped like AdminTravelerDto, Email masked by the API.
const ANN = { id: TRAVELER_ID, email: '<redacted>', displayName: 'Ann Example', createdUtc: '2026-01-05T09:30:00Z' }

// Shaped like FlightSearchResultDto: exactly the body POST /admin/travelers/{id}/flights takes.
const BA117 = { flightNumber: 'BA117', serviceDate: '2026-09-20', departureAirportIata: 'LHR', arrivalAirportIata: 'JFK', scheduledDepartureUtc: '2026-09-20T10:00:00Z', scheduledArrivalUtc: '2026-09-20T17:30:00Z' }
const AA101 = { flightNumber: 'AA101', serviceDate: '2026-09-20', departureAirportIata: 'LHR', arrivalAirportIata: 'JFK', scheduledDepartureUtc: '2026-09-20T12:15:00Z', scheduledArrivalUtc: '2026-09-20T19:40:00Z' }

let sent: SentRequest[]
let search: (req: SentRequest) => unknown
let track: (req: SentRequest) => unknown

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/flights/track', element: <TrackFlightPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const searches = () => sent.filter(r => r.method === 'GET' && r.url === '/admin/flights/search')
const tracks = () => sent.filter(r => r.method === 'POST')
const resultRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const rowFor = (flightNumber: string) => resultRows().find(row => within(row).queryByText(flightNumber))!

async function searchByFlightNumber(user: ReturnType<typeof userEvent.setup>, flightNumber = 'ba117') {
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-20' } })
  await user.type(screen.getByLabelText('Flight number'), flightNumber)
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('table')
}

describe('TrackFlightPage', () => {
  beforeEach(() => {
    search = () => [BA117, AA101]
    track = () => ({ flightId: 42 })
    ;({ sent } = installFakeApi(req => {
      if (req.method === 'GET' && req.url === `/admin/travelers/${TRAVELER_ID}`) return ANN
      if (req.method === 'GET' && req.url === '/admin/flights/search') return search(req)
      if (req.method === 'POST' && req.url === `/admin/travelers/${TRAVELER_ID}/flights`) return track(req)
      // Results.NotFound(): an empty 404, not ProblemDetails.
      throw httpError(404)
    }))
  })

  it('fills in the traveler from the link and names them', async () => {
    renderAt(`/flights/track?traveler=${TRAVELER_ID}`)

    expect(screen.getByRole('heading', { name: 'Track a flight' })).toBeInTheDocument()
    expect(screen.getByLabelText('Traveler id')).toHaveValue(TRAVELER_ID)
    expect(await screen.findByRole('link', { name: 'Ann Example' })).toHaveAttribute('href', `/travelers/${TRAVELER_ID}`)
  })

  it('keeps the traveler id in the address as it is typed', async () => {
    const user = userEvent.setup()
    const router = renderAt('/flights/track')

    await user.type(screen.getByLabelText('Traveler id'), TRAVELER_ID)

    expect(await screen.findByRole('link', { name: 'Ann Example' })).toBeInTheDocument()
    expect(router.state.location.search).toBe(`?traveler=${TRAVELER_ID}`)
  })

  it("says when the id isn't a traveler id, without asking the API", async () => {
    const user = userEvent.setup()
    renderAt('/flights/track')

    await user.type(screen.getByLabelText('Traveler id'), 'ann')

    expect(screen.getByText("'ann' isn't a traveler id.")).toBeInTheDocument()
    expect(sent.filter(r => r.url.startsWith('/admin/travelers'))).toEqual([])
  })

  it('says when no traveler has the id', async () => {
    renderAt(`/flights/track?traveler=${UNKNOWN_ID}`)

    expect(await screen.findByText('No traveler with this id.')).toBeInTheDocument()
  })

  it('searches by flight number and date, with codeshares when ticked', async () => {
    const user = userEvent.setup()
    renderAt(`/flights/track?traveler=${TRAVELER_ID}`)

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-20' } })
    await user.type(screen.getByLabelText('Flight number'), ' ba117 ')
    await user.click(screen.getByLabelText('Include codeshares'))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('table')

    expect(searches().map(r => r.params)).toEqual([{ date: '2026-09-20', flightNumber: 'ba117', includeCodeshares: true }])
    expect(resultRows().map(row => within(row).getAllByRole('cell').slice(0, 5).map(c => c.textContent))).toEqual([
      ['BA117', '2026-09-20', 'LHR → JFK', '2026-09-20 10:00 UTC', '2026-09-20 17:30 UTC'],
      ['AA101', '2026-09-20', 'LHR → JFK', '2026-09-20 12:15 UTC', '2026-09-20 19:40 UTC'],
    ])
  })

  it('searches by route', async () => {
    const user = userEvent.setup()
    renderAt('/flights/track')

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-20' } })
    await user.type(screen.getByLabelText('From'), 'lhr')
    await user.type(screen.getByLabelText('To'), 'jfk')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('table')

    expect(searches().map(r => r.params)).toEqual([{ date: '2026-09-20', from: 'lhr', to: 'jfk', includeCodeshares: false }])
  })

  it('asks for a date, and a flight number or a full route, before searching', async () => {
    const user = userEvent.setup()
    renderAt('/flights/track')

    await user.type(screen.getByLabelText('Flight number'), 'BA117')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText('Pick a date.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Flight number'))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-20' } })
    await user.type(screen.getByLabelText('From'), 'LHR')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText('Enter a flight number, or both From and To.')).toBeInTheDocument()

    expect(searches()).toEqual([])
  })

  it('says when nothing matches', async () => {
    const user = userEvent.setup()
    search = () => []
    renderAt('/flights/track')

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-20' } })
    await user.type(screen.getByLabelText('Flight number'), 'BA999')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('No flights found.')).toBeInTheDocument()
  })

  it('shows why a search failed', async () => {
    const user = userEvent.setup()
    search = () => { throw httpError(503, { title: 'Flight data provider is throttling requests.', detail: 'Retry after 30 seconds.' }) }
    renderAt('/flights/track')

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-20' } })
    await user.type(screen.getByLabelText('Flight number'), 'BA117')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Search failed: Flight data provider is throttling requests.')
    expect(alert).toHaveTextContent('Retry after 30 seconds.')
  })

  it('tracks a result for the traveler and links to the flight and the traveler', async () => {
    const user = userEvent.setup()
    renderAt(`/flights/track?traveler=${TRAVELER_ID}`)
    await screen.findByRole('link', { name: 'Ann Example' })
    await searchByFlightNumber(user)

    await user.click(within(rowFor('BA117')).getByRole('button', { name: 'Track' }))

    const status = await screen.findByRole('status')
    expect(tracks()).toEqual([expect.objectContaining({ url: `/admin/travelers/${TRAVELER_ID}/flights`, data: BA117 })])
    expect(status).toHaveTextContent('Tracked BA117 on 2026-09-20 for Ann Example.')
    expect(within(status).getByRole('link', { name: 'Open flight' })).toHaveAttribute('href', '/flights/42')
    expect(within(status).getByRole('link', { name: 'Open traveler' })).toHaveAttribute('href', `/travelers/${TRAVELER_ID}`)
    expect(within(rowFor('BA117')).getByRole('button', { name: 'Tracked' })).toBeDisabled()
    expect(within(rowFor('AA101')).getByRole('button', { name: 'Track' })).toBeEnabled()
  })

  it("can't track until the traveler is found", async () => {
    const user = userEvent.setup()
    renderAt(`/flights/track?traveler=${UNKNOWN_ID}`)
    await screen.findByText('No traveler with this id.')
    await searchByFlightNumber(user)

    for (const row of resultRows()) expect(within(row).getByRole('button', { name: 'Track' })).toBeDisabled()
    expect(screen.getByText('Enter a traveler id above to track a flight.')).toBeInTheDocument()
  })

  it('shows why tracking failed', async () => {
    const user = userEvent.setup()
    track = () => { throw httpError(400, { title: 'Validation failed', errors: { ServiceDate: ['ServiceDate cannot be in the past.'] } }) }
    renderAt(`/flights/track?traveler=${TRAVELER_ID}`)
    await screen.findByRole('link', { name: 'Ann Example' })
    await searchByFlightNumber(user)

    await user.click(within(rowFor('BA117')).getByRole('button', { name: 'Track' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not track BA117: Validation failed')
    expect(alert).toHaveTextContent('ServiceDate cannot be in the past.')
    expect(within(rowFor('BA117')).getByRole('button', { name: 'Track' })).toBeEnabled()
  })
})
