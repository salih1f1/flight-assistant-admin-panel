import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
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

/** GET /admin/data/{table}: applies the one `column:value` filter the way the real API does. */
function readTable<T extends Record<string, unknown>>(rows: T[], req: SentRequest) {
  // The API takes `filter` repeated, ANDed; a list of one is the single filter it always took.
  const filters = (req.params?.filter ?? []) as string[]
  const out = filters.reduce(
    (kept, filter) => kept.filter(row => String(row[filter.split(':')[0]]) === filter.slice(filter.indexOf(':') + 1)),
    rows)
  return pagedResult(out, req.params)
}

// Matches the real verify handler: manual verify stamps VerificationSource 'manual' and clears
// VerificationIssue; a missing row answers an empty 404 (Results.NotFound()). Only airports is ever
// actually verified in these tests — countries and alliances only need GET, for the Manually
// columns tests — so this is the one PATCH handler, not a copy per table.
const defaultAirportVerify = (req: SentRequest) => {
  const id = Number(req.url.split('/')[3])
  const { isVerified } = req.data as { isVerified: boolean }
  if (!airports.some(a => a.Id === id)) throw httpError(404)
  airports = airports.map(a => (a.Id === id
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
    throw httpError(404)
  }))
}

function renderAt(entry: string, queryClient: QueryClient = createTestQueryClient()) {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserPage /> }],
    { initialEntries: [entry] },
  )
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
    const headerCheckbox = screen.getByRole('checkbox', { name: 'Select all rows on this page' }) as HTMLInputElement
    expect(headerCheckbox.checked).toBe(false)
    expect(headerCheckbox.indeterminate).toBe(true)

    await user.click(headerCheckbox)
    expect(screen.getByRole('button', { name: 'Verify selected (3)' })).toBeInTheDocument()
    expect(headerCheckbox.checked).toBe(true)
    expect(headerCheckbox.indeterminate).toBe(false)

    await user.click(headerCheckbox)
    expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeInTheDocument()
    expect(headerCheckbox.checked).toBe(false)
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

    // The row's own Verify opens this same dialog on Alpha alone; the selection behind it is a
    // separate thing, and what this asserts is that the row leaving the filtered view takes it out
    // of that selection.
    await user.click(within(await rowOf('Alpha Airport')).getByRole('button', { name: 'Verify' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Verify' }))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByText('Alpha Airport')).not.toBeInTheDocument())
    expect(screen.getByText('Bravo Airport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify selected (1)' })).toBeInTheDocument()
  })

  it('5. Manually columns for airports: the key column, the §3 checks, then Status', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    // Two rows, not one: at exactly one row the dialog drops the table for a field list — see
    // VerifyOneRow.test.tsx. Every test here that reads that table selects two for that reason.
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

    const dialog = await screen.findByRole('dialog')
    const headers = within(dialog).getAllByRole('columnheader').map(h => h.textContent?.trim())
    expect(headers).toEqual(['Id', 'Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt', 'Status', ''])
  })

  it('5. Manually columns for countries: Code appears once, as the key column', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await screen.findByText('Germany')

    await user.click(screen.getByRole('checkbox', { name: 'Select row DE' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row BG' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

    const dialog = await screen.findByRole('dialog')
    const headers = within(dialog).getAllByRole('columnheader').map(h => h.textContent?.trim())
    expect(headers).toEqual(['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion', 'Status', ''])
  })

  it('5. Manually columns for alliances: the key column plus the default-visible columns, minus IsVerified', async () => {
    const user = userEvent.setup()
    renderAt('/data/alliances')
    await screen.findByText('Star Alliance')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

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
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

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

    await waitFor(async () =>
      expect(within(await rowOf('Alpha Airport')).getByRole('img', { name: 'Verified · manual' })).toBeInTheDocument())
    // Nothing to press on a verified row: undoing it is the record page's job.
    expect(within(await rowOf('Alpha Airport')).queryByRole('button', { name: /^(Verify|Unverify)$/ })).not.toBeInTheDocument()
  })

  it("a per-row Verify refreshes what it isn't on screen with, like the dashboard card's counts", async () => {
    // The dashboard card (NeedsAttentionSection) isn't mounted in this test's tree, so there's no
    // behavioural way to show its count updating here. Spying on the QueryClient is the closest
    // available proof: a verify asks for the refresh every write gets, which reaches the card.
    const user = userEvent.setup()
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    renderAt('/data/airports', queryClient)
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))
    const dialog = await screen.findByRole('dialog')
    const dialogRow = (await within(dialog).findByText('Alpha Airport')).closest('tr')!
    await user.click(within(dialogRow).getByRole('button', { name: 'Verify' }))

    await within(dialogRow).findByText('Verified · manual')

    // No filter: everything, the card's counts included.
    expect(invalidateSpy).toHaveBeenCalledWith()
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

    // Wait for the run to actually finish (the last row's badge) before counting requests, so a
    // slow-but-eventually-correct implementation can't pass on a premature read.
    const charlieRow = (await within(dialog).findByText('Charlie Airport')).closest('tr')!
    await within(charlieRow).findByText('Verified · manual')

    expect(patches()).toHaveLength(2)
    expect(patches().map(r => r.url)).toEqual(['/admin/airports/1/verify', '/admin/airports/3/verify'])

    const bravoRow = (await within(dialog).findByText('Bravo Airport')).closest('tr')!
    expect(within(bravoRow).getByText('Verified · ourairports')).toBeInTheDocument()
    expect(within(bravoRow).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })

  it('Verify all shown refreshes the app once for the whole run, not once per row', async () => {
    // Same reasoning as the per-row test above: no consumer mounted here, so this spies on the
    // QueryClient instead of asserting on the (absent) dashboard card.
    const user = userEvent.setup()
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    renderAt('/data/airports', queryClient)
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))

    const charlieRow = (await within(dialog).findByText('Charlie Airport')).closest('tr')!
    await within(charlieRow).findByText('Verified · manual')

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })

  it('a Verify all shown run over 3 rows refetches the grid once, not once per verified row', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))

    // Wait for the run to actually finish (the last row's badge) before counting requests, so a
    // slow-but-eventually-correct implementation can't pass on a premature read.
    const charlieRow = (await within(dialog).findByText('Charlie Airport')).closest('tr')!
    await within(charlieRow).findByText('Verified · manual')
    expect(patches()).toHaveLength(3)

    // Give any invalidation-triggered refetch a moment to actually land before counting it, so a
    // per-row invalidation that just hasn't resolved yet can't pass as "one".
    await new Promise(resolve => setTimeout(resolve, 10))

    const firstPatchIndex = sent.findIndex(r => r.method === 'PATCH')
    const gridGetsDuringRun = sent.slice(firstPatchIndex).filter(r => r.method === 'GET' && r.url === '/admin/data/airports')
    expect(gridGetsDuringRun).toHaveLength(1)
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
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

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
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

    const dialog = await screen.findByRole('dialog')
    const dialogRow = (await within(dialog).findByText('Alpha Airport')).closest('tr')!
    await user.click(within(dialogRow).getByRole('button', { name: 'Verify' }))

    await within(dialogRow).findByText('Verified · manual')
    // The grid behind the dialog refetches under the Unverified filter and drops the now-verified row.
    await waitFor(() => expect(screen.getAllByText('Alpha Airport')).toHaveLength(1))
    expect(within(dialog).getByText('Alpha Airport')).toBeInTheDocument()
  })

  it('checkbox focus: clicking, or pressing Space on, a row checkbox or the header checkbox keeps focus on that same checkbox', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    // Cached across every interaction below on purpose: a checkbox that gets swapped for a new DOM
    // node on any render (the bug this proves fixed) would make a later click land on nothing.
    const rowCheckbox = screen.getByRole('checkbox', { name: 'Select row 1' })
    await user.click(rowCheckbox)
    expect(rowCheckbox).toHaveFocus()
    expect(rowCheckbox).toBeChecked()

    await user.keyboard(' ')
    expect(rowCheckbox).toHaveFocus()
    expect(rowCheckbox).not.toBeChecked()

    const headerCheckbox = screen.getByRole('checkbox', { name: 'Select all rows on this page' })
    await user.click(headerCheckbox)
    expect(headerCheckbox).toHaveFocus()
    expect(headerCheckbox).toBeChecked()
    expect(screen.getByRole('button', { name: 'Verify selected (3)' })).toBeInTheDocument()

    await user.keyboard(' ')
    expect(headerCheckbox).toHaveFocus()
    expect(headerCheckbox).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeInTheDocument()
  })

  it('a row with no value in the key column has no checkbox', async () => {
    airports = [...airports, { ...airports[0], Id: null as unknown as number, Iata: 'ZZZ', Name: 'No-Id Airport' }]
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const row = (await screen.findByText('No-Id Airport')).closest('tr')!
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
    // The other three rows still get theirs.
    expect(screen.getAllByRole('checkbox', { name: /^Select row / })).toHaveLength(3)
  })

  it('closing the dialog keeps the selection', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Verify selected (1)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select row 1' })).toBeChecked()
  })

  it('Verify all shown and the per-row Verify buttons are disabled while a run is in flight', async () => {
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

    expect(within(dialog).getByRole('button', { name: 'Verify all shown' })).toBeDisabled()
    const bravoRow = (await within(dialog).findByText('Bravo Airport')).closest('tr')!
    expect(within(bravoRow).getByRole('button', { name: 'Verify' })).toBeDisabled()

    release()
    await waitFor(() => expect(patches()).toHaveLength(3))
  })

  it("Verify all shown does not send a second PATCH for a row whose own per-row Verify is still in flight", async () => {
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
    const alphaRow = (await within(dialog).findByText('Alpha Airport')).closest('tr')!
    // Alpha's own per-row Verify, held in flight on the gate.
    await user.click(within(alphaRow).getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(patches()).toHaveLength(1))

    // Bravo and Charlie should still be sent; Alpha must not get a second PATCH while its first is pending.
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))
    await waitFor(() => expect(patches()).toHaveLength(3))
    expect(patches().map(r => r.url)).toEqual(['/admin/airports/1/verify', '/admin/airports/2/verify', '/admin/airports/3/verify'])

    release()
    await within(alphaRow).findByText('Verified · manual')
    // Releasing Alpha's request didn't trigger a further send either.
    expect(patches()).toHaveLength(3)
  })

  it("closing the dialog mid-run stops further requests, and a stopped run's outcome does not leak into a reopened dialog", async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    airportVerifyAnswer = async req => {
      if (Number(req.url.split('/')[3]) === 1) {
        await gate
        throw httpError(500, { title: 'boom', status: 500 })
      }
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

    await user.click(within(dialog).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Reopen — with the held request still unsettled — before releasing it. Reopening resets the
    // dialog's outcomes on its own, so releasing before this point would leave a missing generation
    // guard undetected: the outcomes would already be empty either way. This is the case the guard
    // actually exists for: a write that arrives *after* the reset, landing back on top of it.
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))
    const reopened = await screen.findByRole('dialog')
    expect(within(reopened).getByRole('button', { name: 'Verify all shown' })).toBeEnabled()

    release()
    // Give the released (and failing) request's microtasks a chance to run before checking that its
    // outcome never reached the reopened dialog, and that it triggered no further request.
    await new Promise(resolve => setTimeout(resolve, 10))

    const alphaRow = (await within(reopened).findByText('Alpha Airport')).closest('tr')!
    expect(within(alphaRow).queryByText(/Couldn't verify/)).not.toBeInTheDocument()
    expect(within(alphaRow).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(patches()).toHaveLength(1)
  })

  it('the dialog closes and a running Verify all shown stops when the view changes, e.g. Back', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    airportVerifyAnswer = async req => {
      if (Number(req.url.split('/')[3]) === 1) await gate
      return defaultAirportVerify(req)
    }
    const user = userEvent.setup()
    const router = renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))
    await waitFor(() => expect(patches()).toHaveLength(1))

    // Stands in for Back: the same route element re-renders with a different :table param, with no
    // remount.
    await act(() => router.navigate('/data/countries'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    release()
    // Give the released request's microtasks a chance to run before checking it triggered no further one.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(patches()).toHaveLength(1)

    await screen.findByText('Germany')
    await user.click(screen.getByRole('checkbox', { name: 'Select row DE' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))
    const reopened = await screen.findByRole('dialog')
    expect(within(reopened).getByText('Germany')).toBeInTheDocument()
    expect(within(reopened).queryByText(/Airport/)).not.toBeInTheDocument()
  })

  it('unmounting the dialog when the new table is not verifiable also stops a running Verify all shown', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    airportVerifyAnswer = async req => {
      if (Number(req.url.split('/')[3]) === 1) await gate
      return defaultAirportVerify(req)
    }
    const user = userEvent.setup()
    const router = renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (3)' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Verify all shown' }))
    await waitFor(() => expect(patches()).toHaveLength(1))

    // flight-statuses isn't verifiable: `verifier` turns falsy in the same render pass the table
    // changes, so DataBrowserPage drops <VerifyDialog> from its JSX outright instead of re-rendering
    // it with open=false — this unmounts the dialog rather than closing it.
    await act(() => router.navigate('/data/flight-statuses'))
    await screen.findByText('Scheduled')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    release()
    // Give the released request's microtasks a chance to run before checking it triggered no further one.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(patches()).toHaveLength(1)
  })
})
