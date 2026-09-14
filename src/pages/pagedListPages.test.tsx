import type { ComponentType } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AirportsPage } from './airports/AirportsPage'
import { LoungesPage } from './lounges/LoungesPage'
import { LoyaltyProgramsPage } from './loyalty/LoyaltyProgramsPage'
import { FlightsPage } from './flights/FlightsPage'
import { TravelersPage } from './travelers/TravelersPage'

// The same wiring runs on every paged list page: generated client -> page ->
// DataTable, faked at the apiClient boundary. AirlinesPage has its own, fuller test.
vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TOTAL = 120 // 3 pages at the panel's page size of 50
const pad = (n: number) => String(n).padStart(3, '0')

// Rows follow the API's DTOs in openapi/openapi.json, since the DTOs are what the
// endpoint really sends.
const cases: {
  page: string
  Component: ComponentType
  url: string
  /** The raw table its Raw data tab links to. */
  table: string
  row: (n: number) => Record<string, unknown> & { id: number | string }
  text: (n: number) => string
}[] = [
  {
    page: 'AirportsPage',
    Component: AirportsPage,
    url: '/admin/airports',
    table: 'airports',
    row: n => ({ id: n, iata: 'XXX', icao: null, name: `Airport ${pad(n)}`, city: 'City', countryCode: 'XX', latitude: null, longitude: null, elevationFt: null }),
    text: n => `Airport ${pad(n)}`,
  },
  {
    page: 'LoungesPage',
    Component: LoungesPage,
    url: '/admin/lounges',
    table: 'lounges',
    row: n => ({ id: n, airportId: 1, name: `Lounge ${pad(n)}`, terminal: null, locationHint: null, hours: null, isAirside: true, isDomesticOnly: false, isInternationalOnly: false, amenities: null }),
    text: n => `Lounge ${pad(n)}`,
  },
  {
    page: 'LoyaltyProgramsPage',
    Component: LoyaltyProgramsPage,
    url: '/admin/loyalty/programs',
    table: 'loyalty-programs',
    row: n => ({ id: n, code: `P${pad(n)}`, name: `Program ${pad(n)}`, kind: 'Airline', airlineId: null, allianceCode: null, tiers: [] }),
    text: n => `Program ${pad(n)}`,
  },
  {
    page: 'FlightsPage',
    Component: FlightsPage,
    url: '/admin/flights',
    table: 'flights',
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
    table: 'travelers',
    row: n => ({ id: `00000000-0000-0000-0000-000000000${pad(n)}`, email: `traveler${pad(n)}@example.com`, displayName: null, createdUtc: '2026-01-01T00:00:00Z' }),
    text: n => `traveler${pad(n)}@example.com`,
  },
]

describe.each(cases)('$page', ({ Component, url, table, row, text }) => {
  let rows: ReturnType<typeof row>[]
  let sent: SentRequest[]

  beforeEach(() => {
    rows = Array.from({ length: TOTAL }, (_, i) => row(i + 1))
    ;({ sent } = installFakeApi(req => {
      if (req.method === 'GET' && req.url === url) return pagedResult(rows, req.params)
      if (req.method === 'DELETE' && req.url.startsWith(`${url}/`)) {
        const id = req.url.slice(url.length + 1)
        rows = rows.filter(r => String(r.id) !== id)
        return undefined
      }
      throw httpError(404)
    }))
  })

  it('lists the rows on the first page the API returns', async () => {
    renderWithProviders(<Component />)

    expect(await screen.findByText(text(1))).toBeInTheDocument()
    expect(screen.getByText(text(50))).toBeInTheDocument()
    expect(screen.queryByText(text(51))).not.toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('links to its raw table from the Manage | Raw data tabs', async () => {
    renderWithProviders(<Component />)
    await screen.findByText(text(1))

    const views = screen.getByRole('navigation', { name: 'Views' })
    expect(within(views).getByRole('link', { name: 'Raw data' })).toHaveAttribute('href', `/data/${table}`)
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
    expect(sent[sent.length - 1]).toEqual(
      expect.objectContaining({ method: 'GET', url, params: { Page: 2, PageSize: 50 } }),
    )
  })

  it('shows why the list failed to load instead of "No results."', async () => {
    installFakeApi(() => {
      throw httpError(500)
    })
    renderWithProviders(<Component />)

    expect(await screen.findByText('Could not load: Request failed with status code 500')).toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('deleting a row sends DELETE and drops it from the list without a reload', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Component />)
    const tableRow = (await screen.findByText(text(1))).closest('tr')!

    // Every list's row actions end with the delete button.
    const rowButtons = within(tableRow).getAllByRole('button')
    await user.click(rowButtons[rowButtons.length - 1])
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText(text(1))).not.toBeInTheDocument())
    expect(screen.getByText(`Page 1 of 3 · ${TOTAL - 1} total`)).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'DELETE', url: `${url}/${row(1).id}` }))
  })
})
