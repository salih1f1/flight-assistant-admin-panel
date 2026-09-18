import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { TravelerDetailPage } from './TravelerDetailPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TRAVELER_ID = '3f2b8c1e-9a4d-4e6b-8f10-2c7d5e9a1b01'
const TOKEN_ID = '7a1c0d2e-5b3f-4a8c-9e61-0f2d4c6b8a02'
const MEMBERSHIP_ID = 'c4e9a7b2-1d3f-4b5a-8c6e-9f0a2b4d6e03'

// Shaped like AdminTravelerDetailDto: Email, device Token and AccountNumber masked by the API.
const makeDetail = () => ({
  id: TRAVELER_ID,
  email: '<redacted>',
  displayName: 'Ann Example' as string | null,
  createdUtc: '2026-01-05T09:30:00Z',
  deviceTokens: [{ id: TOKEN_ID, platform: 'iOS', token: '<redacted>', lastSeenUtc: '2026-09-10T08:00:00Z' }],
  trackedFlights: [
    { trackingId: '11111111-2222-4333-8444-555555555555', flightId: 42, flightNumber: 'BA117', airlineId: 7, departureAirportId: 11, arrivalAirportId: 12, serviceDate: '2026-09-20', notify: true },
  ],
  trackedFlightsTruncated: false,
  loyaltyMemberships: [
    { id: MEMBERSHIP_ID, programId: 3, accountNumber: '<redacted>', tierId: 2 as number | null, tierExpiryDate: '2027-03-31' as string | null },
  ],
})

// What POST /admin/data/{table}/{id}/reveal returns for each masked value.
const REVEALED: Record<string, string> = {
  [`travelers|${TRAVELER_ID}|Email`]: 'ann@example.com',
  [`device-tokens|${TOKEN_ID}|Token`]: 'apns-token-abc',
  [`traveler-loyalty-memberships|${MEMBERSHIP_ID}|AccountNumber`]: 'BA-12345678',
}

// The names behind the ids above, shaped like AirlineAdminDto, AirportAdminDto and LoyaltyProgramDto
// (a program carries its tiers, which is where a membership's tier name comes from).
const BRITISH_AIRWAYS = { id: 7, iata: 'BA', icao: 'BAW', name: 'British Airways', countryCode: 'GB', allianceCode: 'ONEWORLD' }
const HEATHROW = { id: 11, iata: 'LHR', icao: 'EGLL', name: 'London Heathrow', city: 'London', countryCode: 'GB', latitude: null, longitude: null, elevationFt: null }
const JFK = { id: 12, iata: 'JFK', icao: 'KJFK', name: 'New York JFK', city: 'New York', countryCode: 'US', latitude: null, longitude: null, elevationFt: null }
const EXECUTIVE_CLUB = {
  id: 3, code: 'EXEC_CLUB', name: 'Executive Club', kind: 'AIRLINE', airlineId: 7, allianceCode: 'ONEWORLD',
  tiers: [{ id: 1, code: 'SILVER', name: 'Silver', rank: 2, allianceCode: null, allianceTierCode: null }, { id: 2, code: 'GOLD', name: 'Gold', rank: 3, allianceCode: null, allianceTierCode: null }],
}

let detail: ReturnType<typeof makeDetail>
let sent: SentRequest[]

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/airlines/7') return BRITISH_AIRWAYS
    if (req.method === 'GET' && req.url === '/admin/airports/11') return HEATHROW
    if (req.method === 'GET' && req.url === '/admin/airports/12') return JFK
    if (req.method === 'GET' && req.url === '/admin/loyalty/programs') return pagedResult([EXECUTIVE_CLUB], req.params)
    const detailUrl = req.url.match(/^\/admin\/travelers\/([^/]+)\/detail$/)
    if (req.method === 'GET' && detailUrl) {
      // Results.NotFound(): an empty 404, not ProblemDetails.
      if (detailUrl[1] !== TRAVELER_ID) throw httpError(404)
      return detail
    }
    const reveal = req.url.match(/^\/admin\/data\/([a-z-]+)\/([^/]+)\/reveal$/)
    if (req.method === 'POST' && reveal) {
      const column = (req.data as { column: string }).column
      return { table: reveal[1], id: reveal[2], column, value: REVEALED[`${reveal[1]}|${reveal[2]}|${column}`] }
    }
    throw httpError(404)
  }))
}

function renderAt(id: string) {
  const router = createMemoryRouter(
    [{ path: '/travelers/:id', element: <TravelerDetailPage /> }],
    { initialEntries: [`/travelers/${id}`] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const region = (name: string) => screen.getByRole('region', { name })

async function reveal(user: ReturnType<typeof userEvent.setup>, container: HTMLElement, column: string) {
  await user.click(within(container).getByRole('button', { name: `Reveal ${column}` }))
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reveal' }))
}

describe('TravelerDetailPage', () => {
  beforeEach(() => {
    detail = makeDetail()
    install()
  })

  it('links to tracking a flight for this traveler', async () => {
    renderAt(TRAVELER_ID)

    expect(await screen.findByRole('link', { name: 'Track a flight' })).toHaveAttribute('href', `/flights/track?traveler=${TRAVELER_ID}`)
  })

  it("loads the traveler's detail and shows the profile", async () => {
    renderAt(TRAVELER_ID)

    expect(await screen.findByRole('heading', { name: 'Ann Example' })).toBeInTheDocument()
    const profile = region('Profile')
    expect(profile).toHaveTextContent(TRAVELER_ID)
    expect(profile).toHaveTextContent('2026-01-05 09:30 UTC')
    expect(within(profile).getByText('Masked')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: `/admin/travelers/${TRAVELER_ID}/detail` }))
    expect(screen.getByRole('link', { name: 'Back to travelers' })).toHaveAttribute('href', '/travelers')
  })

  it('reveals the email through the audited reveal, on the travelers table', async () => {
    const user = userEvent.setup()
    renderAt(TRAVELER_ID)
    await screen.findByRole('heading', { name: 'Ann Example' })

    await reveal(user, region('Profile'), 'Email')

    expect(await within(region('Profile')).findByText('ann@example.com')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'POST', url: `/admin/data/travelers/${TRAVELER_ID}/reveal`, data: { column: 'Email' } }))
  })

  it('lists device tokens and reveals a token on the device-tokens table', async () => {
    const user = userEvent.setup()
    renderAt(TRAVELER_ID)
    await screen.findByRole('heading', { name: 'Ann Example' })

    const tokens = region('Device tokens')
    expect(tokens).toHaveTextContent('iOS')
    expect(tokens).toHaveTextContent('2026-09-10 08:00 UTC')

    await reveal(user, tokens, 'Token')

    expect(await within(region('Device tokens')).findByText('apns-token-abc')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'POST', url: `/admin/data/device-tokens/${TOKEN_ID}/reveal`, data: { column: 'Token' } }))
  })

  it('lists loyalty memberships and reveals an account number on the memberships table', async () => {
    const user = userEvent.setup()
    renderAt(TRAVELER_ID)
    await screen.findByRole('heading', { name: 'Ann Example' })

    const memberships = region('Loyalty memberships')
    const row = within(memberships).getAllByRole('row')[1]
    // The program and tier by name, not their ids.
    await waitFor(() => expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['Executive Club (EXEC_CLUB)', 'Masked', 'Gold', '2027-03-31']))
    expect(within(row).getByRole('link', { name: 'Executive Club (EXEC_CLUB)' })).toHaveAttribute('href', '/data/loyalty-programs/3')

    await reveal(user, memberships, 'AccountNumber')

    expect(await within(region('Loyalty memberships')).findByText('BA-12345678')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'POST', url: `/admin/data/traveler-loyalty-memberships/${MEMBERSHIP_ID}/reveal`, data: { column: 'AccountNumber' } }))
  })

  it('lists tracked flights', async () => {
    renderAt(TRAVELER_ID)
    await screen.findByRole('heading', { name: 'Ann Example' })

    const flights = region('Tracked flights')
    const row = within(flights).getAllByRole('row')[1]
    // The airline and airports by name, not their ids.
    await waitFor(() => expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['BA117', '2026-09-20', 'British Airways (BA)', 'London Heathrow (LHR) → New York JFK (JFK)', 'On']))
    expect(within(row).getByRole('link', { name: 'BA117' })).toHaveAttribute('href', '/flights/42')
    expect(flights).not.toHaveTextContent('most recent')
  })

  it("keeps the id and says it wasn't found when a program or tier no longer exists", async () => {
    detail = { ...makeDetail(), loyaltyMemberships: [{ ...makeDetail().loyaltyMemberships[0], programId: 9, tierId: 5 }] }
    renderAt(TRAVELER_ID)
    await screen.findByRole('heading', { name: 'Ann Example' })

    const row = within(region('Loyalty memberships')).getAllByRole('row')[1]
    await waitFor(() => expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['#9, not found', 'Masked', '#5, not found', '2027-03-31']))
  })

  it('says when tracked flights were cut off, and links to all of them in the Data page', async () => {
    detail.trackedFlightsTruncated = true
    renderAt(TRAVELER_ID)
    await screen.findByRole('heading', { name: 'Ann Example' })

    const flights = region('Tracked flights')
    expect(flights).toHaveTextContent('Showing the 50 most recent tracked flights.')
    expect(within(flights).getByRole('link', { name: 'See all in the Data page' }))
      .toHaveAttribute('href', `/data/traveler-flights?filter=TravelerId%3A${TRAVELER_ID}`)
  })

  it('says when a section is empty', async () => {
    detail = { ...makeDetail(), displayName: null, deviceTokens: [], trackedFlights: [], loyaltyMemberships: [] }
    renderAt(TRAVELER_ID)

    expect(await screen.findByRole('heading', { name: 'Traveler' })).toBeInTheDocument()
    expect(region('Device tokens')).toHaveTextContent('No device tokens.')
    expect(region('Tracked flights')).toHaveTextContent('No tracked flights.')
    expect(region('Loyalty memberships')).toHaveTextContent('No loyalty memberships.')
  })

  it("says the traveler doesn't exist when the API can't find them", async () => {
    const missing = '9e8d7c6b-5a49-4382-a716-0f1e2d3c4b5a'
    renderAt(missing)

    expect(await screen.findByRole('alert')).toHaveTextContent(`No traveler with id ${missing}.`)
  })

  it("says an address isn't a traveler id without asking the API, since its route only matches a GUID", async () => {
    renderAt('not-a-guid')

    expect(await screen.findByRole('alert')).toHaveTextContent("'not-a-guid' isn't a traveler id.")
    await waitFor(() => expect(sent).toHaveLength(0))
  })
})
