import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { FlightsPage } from './FlightsPage'

// List, paging and delete are covered in pagedListPages.test; this covers sync.
vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like AdminFlightDto.
const makeFlights = () =>
  Array.from({ length: 3 }, (_, i) => ({
    id: i + 1, airlineId: 1, flightNumber: `FA00${i + 1}`, departureAirportId: 1, arrivalAirportId: 2,
    serviceDate: '2026-09-13', scheduledDepartureUtc: '2026-09-13T10:00:00Z', scheduledArrivalUtc: '2026-09-13T12:00:00Z',
    estimatedDepartureUtc: null as string | null, estimatedArrivalUtc: null, actualDepartureUtc: null as string | null, actualArrivalUtc: null,
    equipmentAircraftIcao: null, externalId: null,
  }))

let flights: ReturnType<typeof makeFlights>
let sent: SentRequest[]

describe('FlightsPage', () => {
  beforeEach(() => {
    flights = makeFlights()
    ;({ sent } = installFakeApi(req => {
      if (req.method === 'GET' && req.url === '/admin/flights') return pagedResult(flights, req.params)
      // Syncing pulls the latest status from the provider; here the flight has departed.
      const sync = req.url.match(/^\/admin\/flights\/(\d+)\/sync$/)
      if (req.method === 'POST' && sync) {
        flights = flights.map(f => (f.id === Number(sync[1]) ? { ...f, actualDepartureUtc: '2026-09-13T10:05:00Z' } : f))
        return undefined
      }
      throw httpError(404)
    }))
  })

  it('syncing a flight sends POST .../sync and shows its new status without a reload', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FlightsPage />)
    const tableRow = (await screen.findByText('FA002')).closest('tr')!
    expect(within(tableRow).getByText('Scheduled')).toBeInTheDocument()

    // Row actions: sync, then delete.
    await user.click(within(tableRow).getAllByRole('button')[0])

    await waitFor(() => expect(within(screen.getByText('FA002').closest('tr')!).getByText('Departed')).toBeInTheDocument())
    expect(sent).toContainEqual(expect.objectContaining({ method: 'POST', url: '/admin/flights/2/sync' }))
    expect(within(screen.getByText('FA001').closest('tr')!).getByText('Scheduled')).toBeInTheDocument()
  })

  it("shows the API's reason when a sync fails", async () => {
    // As the API answers when AeroAPI rejects the lookup (GlobalExceptionHandler, outside Production).
    const problem = {
      title: 'The flight status request was rejected.',
      status: 400,
      detail: 'AeroAPI returned HTTP 400: invalid ident',
      instance: '/admin/flights/2/sync',
    }
    installFakeApi(req => {
      if (req.method === 'GET' && req.url === '/admin/flights') return pagedResult(flights, req.params)
      throw httpError(400, problem)
    })
    const user = userEvent.setup()
    renderWithProviders(<FlightsPage />)
    const tableRow = (await screen.findByText('FA002')).closest('tr')!

    await user.click(within(tableRow).getAllByRole('button')[0])

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not sync FA002: The flight status request was rejected.')
    expect(alert).toHaveTextContent('AeroAPI returned HTTP 400: invalid ident')
  })

  it('falls back to the error message when the failure has no problem details', async () => {
    installFakeApi(req => {
      if (req.method === 'GET' && req.url === '/admin/flights') return pagedResult(flights, req.params)
      throw httpError(502)
    })
    const user = userEvent.setup()
    renderWithProviders(<FlightsPage />)
    const tableRow = (await screen.findByText('FA001')).closest('tr')!

    await user.click(within(tableRow).getAllByRole('button')[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sync FA001: Request failed with status code 502')
  })
})
