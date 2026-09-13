import type { ComponentType } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { fakePagedGet } from '@/test/fakePagedGet'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AirportsPage } from './airports/AirportsPage'
import { LoungesPage } from './lounges/LoungesPage'
import { LoyaltyProgramsPage } from './loyalty/LoyaltyProgramsPage'
import { FlightsPage } from './flights/FlightsPage'
import { TravelersPage } from './travelers/TravelersPage'

// The same wiring runs on every paged list page: api module -> hook -> page ->
// DataTable. Mocked at the HTTP boundary so all of it runs. AirlinesPage has its
// own, fuller test, including the last-page boundary.
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }))

const TOTAL = 120 // 3 pages at the panel's page size of 50
const pad = (n: number) => String(n).padStart(3, '0')

// Rows follow the API's DTOs in spec/openapi.json, not the panel's hand-written
// types, since the DTOs are what the endpoint really sends.
const cases: {
  page: string
  Component: ComponentType
  url: string
  row: (n: number) => Record<string, unknown>
  text: (n: number) => string
}[] = [
  {
    page: 'AirportsPage',
    Component: AirportsPage,
    url: '/admin/airports',
    row: n => ({ id: n, iata: 'XXX', icao: null, name: `Airport ${pad(n)}`, city: 'City', countryCode: 'XX', latitude: null, longitude: null, elevationFt: null }),
    text: n => `Airport ${pad(n)}`,
  },
  {
    page: 'LoungesPage',
    Component: LoungesPage,
    url: '/admin/lounges',
    row: n => ({ id: n, airportId: 1, name: `Lounge ${pad(n)}`, terminal: null, locationHint: null, hours: null, isAirside: true, isDomesticOnly: false, isInternationalOnly: false, amenities: null }),
    text: n => `Lounge ${pad(n)}`,
  },
  {
    page: 'LoyaltyProgramsPage',
    Component: LoyaltyProgramsPage,
    url: '/admin/loyalty/programs',
    row: n => ({ id: n, code: `P${pad(n)}`, name: `Program ${pad(n)}`, kind: 'Airline', airlineId: null, allianceCode: null, tiers: [] }),
    text: n => `Program ${pad(n)}`,
  },
  {
    page: 'FlightsPage',
    Component: FlightsPage,
    url: '/admin/flights',
    row: n => ({
      id: n, airlineId: 1, flightNumber: `FA${pad(n)}`, departureAirportId: 1, arrivalAirportId: 2,
      serviceDate: '2026-09-13', scheduledDepartureUtc: '2026-09-13T10:00:00Z', scheduledArrivalUtc: '2026-09-13T12:00:00Z',
      estimatedDepartureUtc: null, estimatedArrivalUtc: null, actualDepartureUtc: null, actualArrivalUtc: null,
      equipmentAircraftIcao: null, externalId: null,
    }),
    text: n => `FA${pad(n)}`,
  },
  {
    page: 'TravelersPage',
    Component: TravelersPage,
    url: '/admin/travelers',
    row: n => ({ id: `00000000-0000-0000-0000-000000000${pad(n)}`, email: `traveler${pad(n)}@example.com`, displayName: null, createdUtc: '2026-01-01T00:00:00Z' }),
    text: n => `traveler${pad(n)}@example.com`,
  },
]

describe.each(cases)('$page', ({ Component, url, row, text }) => {
  const rows = Array.from({ length: TOTAL }, (_, i) => row(i + 1))

  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(fakePagedGet({ [url]: rows }))
  })

  it('lists the rows on the first page the API returns', async () => {
    renderWithProviders(<Component />)

    expect(await screen.findByText(text(1))).toBeInTheDocument()
    expect(screen.getByText(text(50))).toBeInTheDocument()
    expect(screen.queryByText(text(51))).not.toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('shows the position and total from the API', async () => {
    renderWithProviders(<Component />)

    expect(await screen.findByText(`Page 1 of 3 · ${TOTAL} total`)).toBeInTheDocument()
  })

  it('Next requests page 2 from the API and replaces the rows', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Component />)
    await screen.findByText(text(1))

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(text(51))).toBeInTheDocument()
    expect(screen.queryByText(text(1))).not.toBeInTheDocument()
    expect(apiClient.get).toHaveBeenLastCalledWith(url, { params: { Page: 2, PageSize: 50 } })
  })
})
