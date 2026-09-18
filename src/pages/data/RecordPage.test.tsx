import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { RecordPage, RedirectToRecord } from './RecordPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'airlines', displayName: 'Airlines', rowCount: 2 },
  { slug: 'alliances', displayName: 'Alliances', rowCount: 1 },
  { slug: 'countries', displayName: 'Countries', rowCount: 2 },
  { slug: 'device-tokens', displayName: 'Device Tokens', rowCount: 1 },
  { slug: 'flight-status-events', displayName: 'Flight Status Events', rowCount: 1 },
  { slug: 'lounges', displayName: 'Lounges', rowCount: 1 },
  { slug: 'seed-versions', displayName: 'Seed Versions', rowCount: 1 },
]

type Row = Record<string, unknown>

// Shaped like GET /admin/data/airlines rows: PascalCase, every registry column.
const makeAirlines = (): Row[] => [
  {
    Id: 7, Iata: 'TK', Icao: 'THY', Name: 'Turkish Airlines', CountryCode: 'TR', AllianceCode: 'STAR',
    IsVerified: true, VerifiedAt: '2026-09-01T10:00:00Z', VerifiedBy: 'admin-oid',
  },
  {
    Id: 8, Iata: 'BA', Icao: 'BAW', Name: 'British Airways', CountryCode: 'GB', AllianceCode: 'OW',
    IsVerified: false, VerifiedAt: null, VerifiedBy: null,
  },
]

let airlines: Row[]
let countries: Row[]

// "de" is inside both codes: the API's string filter is a contains match. DE carries a
// verification issue and no source, so the record page's Verify, badge and field-value tests
// all read from one fixture row.
const makeCountries = (): Row[] => [
  { Code: 'DEX', Name: 'Not a country', IsEU: false },
  { Code: 'DE', Name: 'Germany', IsEU: true, IsVerified: false, VerificationSource: null, VerificationIssue: 'Needs manual review' },
]

let sent: SentRequest[]

const ROWS: Record<string, () => Row[]> = {
  airlines: () => airlines,
  alliances: () => [{ Id: 1, Code: 'STAR', Name: 'Star Alliance', IsVerified: true }],
  countries: () => countries,
  'device-tokens': () => [{ Id: 4, TravelerId: '00000000-0000-0000-0000-000000000001', Platform: 'ios', Token: '<redacted>', LastSeenUtc: null }],
  'flight-status-events': () => [{ Id: 5, FlightId: 42, Source: 'AeroAPI', Remarks: null, RawPayloadJson: { status: 'Delayed' } }],
  lounges: () => [{ Id: 12, AirportId: 11, Name: 'Plaza Premium', IsAirside: true }],
}

/** Filters like BrowsableDataRepository: exact on non-string columns, case-insensitive contains on strings. */
function api(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
  // DE (countries, a checkable entity type) carries a VerificationIssue, so RecordPage's panel
  // fetches this on render; no fixture row here has ever had an automated check, so it's always
  // empty — the "no check at all" case, not a scenario this file needs to vary.
  if (req.method === 'GET' && req.url === '/admin/verification-requests') return []
  const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
  if (req.method === 'GET' && table && ROWS[table]) {
    let rows = ROWS[table]()
    const filter = req.params?.filter as string | undefined
    if (filter) {
      const [column, ...rest] = filter.split(':')
      const value = rest.join(':')
      rows = rows.filter(r => typeof r[column] === 'string'
        ? (r[column] as string).toLowerCase().includes(value.toLowerCase())
        : String(r[column]) === value)
    }
    return pagedResult(rows, req.params)
  }
  const airlineId = Number(req.url.match(/^\/admin\/airlines\/(\d+)/)?.[1])
  const airline = airlines.find(a => a.Id === airlineId)
  if (req.method === 'GET' && req.url === `/admin/airlines/${airlineId}`) {
    if (!airline) throw httpError(404)
    return { id: airline.Id, iata: airline.Iata, icao: airline.Icao, name: airline.Name, countryCode: airline.CountryCode, allianceCode: airline.AllianceCode }
  }
  if (req.method === 'PUT' && req.url === `/admin/airlines/${airlineId}` && airline) {
    const body = req.data as { name: string; countryCode: string }
    airlines = airlines.map(a => (a === airline ? { ...a, Name: body.name, CountryCode: body.countryCode } : a))
    return undefined
  }
  if (req.method === 'PATCH' && req.url === `/admin/airlines/${airlineId}/verify` && airline) {
    const { isVerified } = req.data as { isVerified: boolean }
    // Matches the real verify handler (spec §2.2/§4.4): manual verify stamps VerificationSource
    // 'manual' and clears VerificationIssue; unverify clears the source too.
    airlines = airlines.map(a => (a === airline
      ? { ...a, IsVerified: isVerified, VerificationSource: isVerified ? 'manual' : null, VerificationIssue: null }
      : a))
    return undefined
  }
  if (req.method === 'GET' && req.url === '/admin/airports/11') {
    return { id: 11, iata: 'LHR', icao: 'EGLL', name: 'London Heathrow', city: 'London', countryCode: 'GB' }
  }
  const countryCode = req.url.match(/^\/admin\/countries\/([A-Za-z]+)\/verify$/)?.[1]
  const country = countries.find(c => c.Code === countryCode)
  if (req.method === 'PATCH' && countryCode) {
    if (!country) throw httpError(404)
    const { isVerified } = req.data as { isVerified: boolean }
    // Matches the real verify handler (spec §2.2/§4.4): manual verify stamps VerificationSource
    // 'manual' and clears VerificationIssue; unverify clears the source too.
    countries = countries.map(c => (c === country
      ? { ...c, IsVerified: isVerified, VerificationSource: isVerified ? 'manual' : null, VerificationIssue: null }
      : c))
    return undefined
  }
  throw httpError(404)
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/data/:table/:id', element: <RecordPage /> },
      { path: '/data/:table', element: <p>The grid</p> },
      { path: '/travelers/:id', element: <p>Traveler detail</p> },
      { path: '/flights/:id', element: <p>Flight detail</p> },
      { path: '/airlines/:id/edit', element: <RedirectToRecord table="airlines" /> },
    ],
    { initialEntries: [entry] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const search = (router: ReturnType<typeof renderAt>) => new URLSearchParams(router.state.location.search)
const dataRequests = (table: string) => sent.filter(r => r.method === 'GET' && r.url === `/admin/data/${table}`)
/** The value shown for a field: the <dd> after its <dt>. */
const field = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement
const heading = (name: string) => screen.findByRole('heading', { level: 1, name })

describe('RecordPage', () => {
  beforeEach(() => {
    airlines = makeAirlines()
    countries = makeCountries()
    ;({ sent } = installFakeApi(api))
  })

  it('shows every field of one record, loaded by its id', async () => {
    renderAt('/data/airlines/7')

    expect(await heading('Turkish Airlines')).toBeInTheDocument()
    expect(dataRequests('airlines').map(r => r.params?.filter)).toEqual(['Id:7'])
    expect(field('Iata')).toHaveTextContent('TK')
    expect(field('IsVerified')).toHaveTextContent('Yes')
    expect(field('VerifiedBy')).toHaveTextContent('admin-oid')
    expect(screen.getByRole('link', { name: /Airlines/ })).toHaveAttribute('href', '/data/airlines')
  })

  it("says so when there's no such record", async () => {
    renderAt('/data/airlines/999')

    expect(await screen.findByRole('alert')).toHaveTextContent('No Airlines record with Id 999.')
  })

  it('loads a country by its code, taking only the exact match from the contains filter', async () => {
    renderAt('/data/countries/DE')

    expect(await heading('Germany')).toBeInTheDocument()
    expect(dataRequests('countries').map(r => r.params?.filter)).toEqual(['Code:DE'])
    expect(screen.queryByText('Not a country')).not.toBeInTheDocument()
  })

  it('shows a masked value as revealable, never as the placeholder', async () => {
    renderAt('/data/device-tokens/4')

    // No Name, DisplayName or Code to title it by.
    await heading('Device Tokens #4')
    expect(field('Token')).toContainElement(screen.getByRole('button', { name: 'Reveal Token' }))
    expect(screen.queryByText('<redacted>')).not.toBeInTheDocument()
  })

  it('shows a JSON value as JSON, and an empty one as a dash', async () => {
    renderAt('/data/flight-status-events/5')

    await heading('Flight Status Events #5')
    expect(field('RawPayloadJson')).toHaveTextContent('{"status":"Delayed"}')
    expect(field('Remarks')).toHaveTextContent('—')
  })

  it('names a referenced airport, linking to its record', async () => {
    renderAt('/data/lounges/12')

    await heading('Plaza Premium')
    expect(await screen.findByRole('link', { name: 'London Heathrow (LHR)' })).toHaveAttribute('href', '/data/airports/11')
  })

  it('verifies the record and shows the new state', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines/8')
    await heading('British Airways')
    expect(field('IsVerified')).toHaveTextContent('No')

    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByRole('button', { name: 'Unverify' })).toBeInTheDocument()
    expect(field('IsVerified')).toHaveTextContent('Yes')
    expect(sent).toContainEqual(expect.objectContaining({ method: 'PATCH', url: '/admin/airlines/8/verify', data: { isVerified: true } }))
  })

  it('verifies a country record by its code, not a numeric id, updating the panel badge from refreshed data', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries/DE')
    await heading('Germany')
    expect(field('IsVerified')).toHaveTextContent('No')
    expect(screen.getByText('Needs attention')).toBeInTheDocument()

    // DE needs attention with no check on file, so the panel offers "Keep ours and verify" rather
    // than the plain Verify toggle — same verify route underneath.
    await user.click(await screen.findByRole('button', { name: 'Keep ours and verify' }))

    expect(await screen.findByRole('button', { name: 'Unverify' })).toBeInTheDocument()
    expect(field('IsVerified')).toHaveTextContent('Yes')
    // The badge reads the refetched row, not the one it first rendered with.
    expect(screen.getByText('Verified · manual')).toBeInTheDocument()
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'PATCH', url: '/admin/countries/DE/verify', data: { isVerified: true } }))
  })

  it('shows the verification status badge', async () => {
    renderAt('/data/countries/DE')
    await heading('Germany')

    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })

  it('shows VerificationSource and VerificationIssue as record fields, hidden or not in the grid', async () => {
    renderAt('/data/countries/DE')
    await heading('Germany')

    expect(field('VerificationIssue')).toHaveTextContent('Needs manual review')
    expect(field('VerificationSource')).toHaveTextContent('—')
  })

  it('Edit switches to the form in place; saving returns to Read with the saved values', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/airlines/7')
    await heading('Turkish Airlines')
    expect(screen.getByRole('button', { name: 'Read' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(search(router).get('mode')).toBe('edit')
    const name = await screen.findByLabelText(/^Name/)
    await waitFor(() => expect(name).toHaveValue('Turkish Airlines'))
    await user.clear(name)
    await user.type(name, 'Turkish Airlines Inc')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(search(router).get('mode')).toBeNull())
    expect(await heading('Turkish Airlines Inc')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'PUT', url: '/admin/airlines/7', data: expect.objectContaining({ name: 'Turkish Airlines Inc' }) }))
    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument()
  })

  it('Cancel returns to Read without saving', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/airlines/7?mode=edit')
    const name = await screen.findByLabelText(/^Name/)
    await waitFor(() => expect(name).toHaveValue('Turkish Airlines'))
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(search(router).get('mode')).toBeNull()
    expect(await heading('Turkish Airlines')).toBeInTheDocument()
    expect(sent.some(r => r.method === 'PUT')).toBe(false)
  })

  it('a read-only table has no Read | Edit toggle, even when the URL asks for Edit', async () => {
    renderAt('/data/alliances/1?mode=edit')

    expect(await heading('Star Alliance')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it.each([
    ['/data/travelers/00000000-0000-0000-0000-000000000001', '/travelers/00000000-0000-0000-0000-000000000001', 'Traveler detail'],
    ['/data/flights/5', '/flights/5', 'Flight detail'],
  ])('%s opens its own detail page', async (entry, path, text) => {
    const router = renderAt(entry)

    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(path)
  })

  it("a table with no single key can't open one record", async () => {
    renderAt('/data/seed-versions/airports')

    expect(await screen.findByText("Seed Versions records can't be opened one at a time: the table has no single key.")).toBeInTheDocument()
    expect(dataRequests('seed-versions')).toEqual([])
  })

  it('an old edit link opens the record in Edit', async () => {
    const router = renderAt('/airlines/7/edit')

    await waitFor(() => expect(router.state.location.pathname).toBe('/data/airlines/7'))
    expect(search(router).get('mode')).toBe('edit')
  })

  /**
   * An alliance's record page links to its airlines view. It links rather than redirects (which is
   * what OWN_DETAIL_PAGES does): the airlines page is not a superset of this one — the raw columns
   * and the verify toggle live only here — so redirecting would leave verifying with no route to it.
   */
  it('links an alliance record to the airlines in that alliance', async () => {
    renderAt('/data/alliances/1')

    const link = await screen.findByRole('link', { name: /airlines in this alliance/i })
    expect(link).toHaveAttribute('href', '/alliances/1')
  })

  it('a record with no related view shows no such link', async () => {
    renderAt('/data/airlines/8')

    await heading('British Airways')
    expect(screen.queryByRole('link', { name: /airlines in this alliance/i })).not.toBeInTheDocument()
  })
})
