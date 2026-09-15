import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// airports and countries carry the §3 CHECKED_COLUMNS; alliances is verifiable with no outside
// source (CHECKED_COLUMNS has no entry for it); flight-statuses isn't verifiable at all.
const TABLES = [
  { slug: 'airports', displayName: 'Airports', rowCount: 3 },
  { slug: 'countries', displayName: 'Countries', rowCount: 2 },
  { slug: 'alliances', displayName: 'Alliances', rowCount: 2 },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
]

// Shaped like GET /admin/data/airports (trimmed to what the §3 check and the badge need).
type Airport = {
  Id: number; Iata: string; Icao: string; Name: string; City: string; CountryCode: string
  Latitude: number; Longitude: number; ElevationFt: number
  IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}
const makeAirports = (): Airport[] => [
  { Id: 1, Iata: 'AAA', Icao: 'KAAA', Name: 'Alpha Airport', City: 'Alpha City', CountryCode: 'US', Latitude: 10.1, Longitude: 20.2, ElevationFt: 100, IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 2, Iata: 'BBB', Icao: 'KBBB', Name: 'Bravo Airport', City: 'Bravo City', CountryCode: 'US', Latitude: 11.1, Longitude: 21.2, ElevationFt: 200, IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 3, Iata: 'CCC', Icao: 'KCCC', Name: 'Charlie Airport', City: 'Charlie City', CountryCode: 'US', Latitude: 12.1, Longitude: 22.2, ElevationFt: 300, IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
]

// Countries is keyed by Code, not Id (CountryConfiguration: HasKey(x => x.Code)).
type Country = {
  Code: string; Name: string; Alpha3: string; NumericCode: number; Region: string; Subregion: string
  IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}
const makeCountries = (): Country[] => [
  { Code: 'DE', Name: 'Germany', Alpha3: 'DEU', NumericCode: 276, Region: 'Europe', Subregion: 'Western Europe', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Code: 'BG', Name: 'Bulgaria', Alpha3: 'BGR', NumericCode: 100, Region: 'Europe', Subregion: 'Eastern Europe', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
]

// Verifiable with no outside source: CHECKED_COLUMNS has no 'alliances' entry, so the Manually
// dialog falls back to the grid's default-visible columns (SourceType/FirstSeenAt/Verified* are
// bookkeeping, hidden the same way DataBrowserPage.HIDDEN_COLUMNS hides them everywhere else).
type Alliance = {
  Id: number; Code: string; Name: string; SourceType: string; FirstSeenAt: string
  IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}
const makeAlliances = (): Alliance[] => [
  { Id: 1, Code: 'SA', Name: 'Star Alliance', SourceType: 'seed', FirstSeenAt: '2026-01-01T00:00:00Z', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 2, Code: 'OW', Name: 'Oneworld', SourceType: 'seed', FirstSeenAt: '2026-01-01T00:00:00Z', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
]

let airports: Airport[]
let countries: Country[]
let alliances: Alliance[]
let sent: SentRequest[]
let airportVerifyAnswer: (req: SentRequest) => unknown
let countryVerifyAnswer: (req: SentRequest) => unknown
let allianceVerifyAnswer: (req: SentRequest) => unknown

/** GET /admin/data/{table}: applies the one `column:value` filter the way the real API does. */
function readTable<T extends Record<string, unknown>>(rows: T[], req: SentRequest) {
  const filter = req.params?.filter as string | undefined
  const out = filter ? rows.filter(row => String(row[filter.split(':')[0]]) === filter.slice(filter.indexOf(':') + 1)) : rows
  return pagedResult(out, req.params)
}

// Matches the real verify handler: manual verify stamps VerificationSource 'manual' and clears
// VerificationIssue; a missing row answers an empty 404 (Results.NotFound()).
const defaultAirportVerify = (req: SentRequest) => {
  const id = Number(req.url.split('/')[3])
  const { isVerified } = req.data as { isVerified: boolean }
  if (!airports.some(a => a.Id === id)) throw httpError(404)
  airports = airports.map(a => (a.Id === id
    ? { ...a, IsVerified: isVerified, VerifiedAt: isVerified ? '2026-09-16T00:00:00Z' : null, VerifiedBy: isVerified ? 'admin-oid' : null, VerificationSource: isVerified ? 'manual' : null, VerificationIssue: null }
    : a))
  return undefined
}
const defaultCountryVerify = (req: SentRequest) => {
  const code = req.url.split('/')[3]
  const { isVerified } = req.data as { isVerified: boolean }
  if (!countries.some(c => c.Code === code)) throw httpError(404)
  countries = countries.map(c => (c.Code === code
    ? { ...c, IsVerified: isVerified, VerifiedAt: isVerified ? '2026-09-16T00:00:00Z' : null, VerifiedBy: isVerified ? 'admin-oid' : null, VerificationSource: isVerified ? 'manual' : null, VerificationIssue: null }
    : c))
  return undefined
}
const defaultAllianceVerify = (req: SentRequest) => {
  const id = Number(req.url.split('/')[3])
  const { isVerified } = req.data as { isVerified: boolean }
  if (!alliances.some(a => a.Id === id)) throw httpError(404)
  alliances = alliances.map(a => (a.Id === id
    ? { ...a, IsVerified: isVerified, VerifiedAt: isVerified ? '2026-09-16T00:00:00Z' : null, VerifiedBy: isVerified ? 'admin-oid' : null, VerificationSource: isVerified ? 'manual' : null, VerificationIssue: null }
    : a))
  return undefined
}

function install() {
  ;({ sent } = installFakeApi(async req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/airports') return readTable(airports, req)
    if (req.method === 'GET' && req.url === '/admin/data/countries') return readTable(countries, req)
    if (req.method === 'GET' && req.url === '/admin/data/alliances') return readTable(alliances, req)
    if (req.method === 'GET' && req.url === '/admin/data/flight-statuses') {
      return pagedResult([{ Id: 1, Code: 'SCH', Name: 'Scheduled', Description: null }], req.params)
    }
    if (req.method === 'PATCH' && /^\/admin\/airports\/\d+\/verify$/.test(req.url)) return airportVerifyAnswer(req)
    if (req.method === 'PATCH' && /^\/admin\/countries\/[A-Za-z]+\/verify$/.test(req.url)) return countryVerifyAnswer(req)
    if (req.method === 'PATCH' && /^\/admin\/alliances\/\d+\/verify$/.test(req.url)) return allianceVerifyAnswer(req)
    throw httpError(404)
  }))
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserPage /> }],
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

const patches = () => sent.filter(r => r.method === 'PATCH')
const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!

describe('DataBrowserPage row selection and the Verify dialog', () => {
  beforeEach(() => {
    airports = makeAirports()
    countries = makeCountries()
    alliances = makeAlliances()
    airportVerifyAnswer = defaultAirportVerify
    countryVerifyAnswer = defaultCountryVerify
    allianceVerifyAnswer = defaultAllianceVerify
    install()
  })

  it('1. a verifiable table shows the header checkbox and one checkbox per row', async () => {
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    expect(screen.getByRole('checkbox', { name: 'Select all rows on this page' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /^Select row / })).toHaveLength(3)
    expect(screen.getByRole('button', { name: /^Verify selected/ })).toBeInTheDocument()
  })

  it('1. flight-statuses (not verifiable) shows no checkbox and no Verify selected button', async () => {
    renderAt('/data/flight-statuses')
    await screen.findByText('Scheduled')

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Verify selected/ })).not.toBeInTheDocument()
  })

  it('2. the button and header checkbox reflect the selection', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))

    expect(screen.getByRole('button', { name: 'Verify selected (2)' })).toBeEnabled()
    // Re-queried before each read/click rather than cached: TanStack Table's flexRender treats an
    // inline header/cell function as a component, so DataBrowserPage's un-memoized `columns` (like
    // its existing verify/actions columns) hands back a fresh checkbox element every render.
    const headerCheckbox = () => screen.getByRole('checkbox', { name: 'Select all rows on this page' }) as HTMLInputElement
    expect(headerCheckbox().checked).toBe(false)
    expect(headerCheckbox().indeterminate).toBe(true)

    await user.click(headerCheckbox())
    expect(screen.getByRole('button', { name: 'Verify selected (3)' })).toBeInTheDocument()
    expect(headerCheckbox().checked).toBe(true)
    expect(headerCheckbox().indeterminate).toBe(false)

    await user.click(headerCheckbox())
    expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeInTheDocument()
    expect(headerCheckbox().checked).toBe(false)
  })

  it('3. the selection drops on a filter or sort change, and does not come back', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    expect(screen.getByRole('button', { name: 'Verify selected (2)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Unverified' }))
    await screen.findByText('Alpha Airport')
    expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    await screen.findByText('Alpha Airport')
    expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    expect(screen.getByRole('button', { name: 'Verify selected (1)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Iata/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeInTheDocument())
  })

  it('4. a row that leaves the view stops counting', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports?filter=IsVerified:false')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    expect(screen.getByRole('button', { name: 'Verify selected (2)' })).toBeInTheDocument()

    await user.click(within(await rowOf('Alpha Airport')).getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(screen.queryByText('Alpha Airport')).not.toBeInTheDocument())
    expect(screen.getByText('Bravo Airport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify selected (1)' })).toBeInTheDocument()
  })

  it('5. Manually columns for airports: the key column, the §3 checks, then Status', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    const headers = within(dialog).getAllByRole('columnheader').map(h => h.textContent?.trim())
    expect(headers).toEqual(['Id', 'Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt', 'Status', ''])
  })

  it('5. Manually columns for countries: Code appears once, as the key column', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await screen.findByText('Germany')

    await user.click(screen.getByRole('checkbox', { name: 'Select row DE' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    const headers = within(dialog).getAllByRole('columnheader').map(h => h.textContent?.trim())
    expect(headers).toEqual(['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion', 'Status', ''])
  })

  it('5. Manually columns for alliances: the key column plus the default-visible columns, minus IsVerified', async () => {
    const user = userEvent.setup()
    renderAt('/data/alliances')
    await screen.findByText('Star Alliance')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    const headers = within(dialog).getAllByRole('columnheader').map(h => h.textContent?.trim())
    expect(headers).toEqual(['Id', 'Code', 'Name', 'Status', ''])
  })

  it('5. rows appear in the dialog in grid order', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 3' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

    const dialog = await screen.findByRole('dialog')
    // Columns: Id, Iata, Icao, Name, City, ... — Name is index 3.
    const names = within(dialog).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[3].textContent)
    expect(names).toEqual(['Alpha Airport', 'Charlie Airport'])
  })

  it('6. a per-row Verify sends the PATCH, updates the badge, and the grid shows it verified after closing', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    const dialogRow = (await within(dialog).findByText('Alpha Airport')).closest('tr')!
    await user.click(within(dialogRow).getByRole('button', { name: 'Verify' }))

    expect(await within(dialogRow).findByText('Verified · manual')).toBeInTheDocument()
    expect(within(dialogRow).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
    expect(patches()).toEqual([{ method: 'PATCH', url: '/admin/airports/1/verify', params: undefined, data: { isVerified: true } }])

    // Two "Close" buttons: the footer button and Radix's built-in dismiss (X, sr-only "Close");
    // the footer one is the first in DOM order.
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const gridRow = await rowOf('Alpha Airport')
    expect(within(gridRow).getByRole('button', { name: 'Unverify' })).toBeInTheDocument()
  })

  it('7. Verify all shown skips an already-verified row, sending the rest in list order', async () => {
    airports = airports.map((airport, index) => (index === 1 ? { ...airport, IsVerified: true, VerificationSource: 'ourairports' } : airport))
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))

    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(patches().map(r => r.url)).toEqual(['/admin/airports/1/verify', '/admin/airports/3/verify'])
  })

  it("8. Verify all shown continues past a failed row, and shows the API's title", async () => {
    airportVerifyAnswer = req => {
      const id = Number(req.url.split('/')[3])
      if (id === 2) throw httpError(500, { title: 'Airport BBB rejected', status: 500 })
      return defaultAirportVerify(req)
    }
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))

    const bravoRow = (await within(dialog).findByText('Bravo Airport')).closest('tr')!
    expect(await within(bravoRow).findByText("Couldn't verify: Airport BBB rejected")).toBeInTheDocument()
    expect(within(bravoRow).getByRole('button', { name: 'Verify' })).toBeInTheDocument()

    const charlieRow = (await within(dialog).findByText('Charlie Airport')).closest('tr')!
    expect(await within(charlieRow).findByText('Verified · manual')).toBeInTheDocument()

    await waitFor(() => expect(patches()).toHaveLength(3))
  })

  it('8. a 404 shows the row no longer exists', async () => {
    airportVerifyAnswer = () => {
      throw httpError(404)
    }
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    const dialogRow = (await within(dialog).findByText('Alpha Airport')).closest('tr')!
    await user.click(within(dialogRow).getByRole('button', { name: 'Verify' }))

    expect(await within(dialogRow).findByText("Couldn't verify: it no longer exists")).toBeInTheDocument()
  })

  it('9. Verify all shown sends one request at a time', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    airportVerifyAnswer = async req => {
      if (Number(req.url.split('/')[3]) === 1) await gate
      return defaultAirportVerify(req)
    }
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches().map(r => r.url)).toEqual(['/admin/airports/1/verify'])

    release()
    await waitFor(() => expect(patches()).toHaveLength(3))
  })

  it('10. the dialog keeps a row it verified even after the grid refetch drops it', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports?filter=IsVerified:false')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    const dialogRow = (await within(dialog).findByText('Alpha Airport')).closest('tr')!
    await user.click(within(dialogRow).getByRole('button', { name: 'Verify' }))

    await within(dialogRow).findByText('Verified · manual')
    // The grid behind the dialog refetches under the Unverified filter and drops the now-verified row.
    await waitFor(() => expect(screen.getAllByText('Alpha Airport')).toHaveLength(1))
    expect(within(dialog).getByText('Alpha Airport')).toBeInTheDocument()
  })
})
