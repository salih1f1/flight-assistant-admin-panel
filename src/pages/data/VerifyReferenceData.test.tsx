import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { getAdminGetVerificationNeedsAttentionQueryKey } from '@/api/generated/admin'
import { DataBrowserPage } from './DataBrowserPage'

/**
 * Picks a filter column by the name the API knows it as, which is what these tests hold: the
 * picker shows a friendlier label, so the raw name is typed into its search and matched there.
 */
async function chooseFilterColumn(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Filter column' }))
  await user.type(screen.getByRole('textbox', { name: 'Search columns' }), name)
  const shown = within(screen.getByRole('listbox')).getAllByRole('option')
  if (shown.length !== 1) throw new Error(`"${name}" matched ${shown.length} columns, not one`)
  await user.click(shown[0])
}


vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// airlines is one of the 8 verifiable tables (PATCH /admin/airlines/{id}/verify exists);
// flight-statuses isn't.
const TABLES = [
  { slug: 'airlines', displayName: 'Airlines', rowCount: 3 },
  { slug: 'countries', displayName: 'Countries', rowCount: 2 },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
]

// Countries is verifiable but keyed by Code (CountryConfiguration: HasKey(x => x.Code)), so its
// verify route is PATCH /admin/countries/{code}/verify — a string key, unlike the other 7 tables.
type Country = {
  Code: string; Name: string; IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}
const makeCountries = (): Country[] => [
  { Code: 'DE', Name: 'Germany', IsVerified: true, VerifiedAt: '2026-09-01T10:00:00Z', VerifiedBy: 'admin-oid', VerificationSource: 'manual', VerificationIssue: null },
  { Code: 'BG', Name: 'Bulgaria', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
]

// Shaped like GET /admin/data/airlines rows (trimmed to a few columns): IsVerified, VerifiedAt,
// VerifiedBy, VerificationSource and VerificationIssue as the registry exposes them. Alpha is
// verified with a source, Beta is plainly unverified, Gamma is unverified with an issue.
type Airline = {
  Id: number; Name: string; IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}
const makeAirlines = (): Airline[] => [
  { Id: 1, Name: 'Alpha Air', IsVerified: true, VerifiedAt: '2026-09-01T10:00:00Z', VerifiedBy: 'admin-oid', VerificationSource: 'manual', VerificationIssue: null },
  { Id: 2, Name: 'Beta Air', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 3, Name: 'Gamma Air', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: 'AeroAPI: duplicate IATA code' },
]

let airlines: Airline[]
let countries: Country[]
let sent: SentRequest[]
let verifyAnswer: (req: SentRequest) => unknown
let verifyCountryAnswer: (req: SentRequest) => unknown

/**
 * Every criterion the request carries, ANDed, as the API applies them (#146): an exact match on a
 * bool column such as IsVerified, a case-insensitive contains on a string column such as Name.
 */
function applyFilters<T extends Record<string, unknown>>(rows: T[], req: SentRequest): T[] {
  return ((req.params?.filter ?? []) as string[]).reduce((kept, filter) => {
    const separator = filter.indexOf(':')
    const column = filter.slice(0, separator)
    const value = filter.slice(separator + 1)
    return kept.filter(row => typeof row[column] === 'string'
      ? (row[column] as string).toLowerCase().includes(value.toLowerCase())
      : String(row[column]) === value)
  }, rows)
}

/** Reads like the data browser (IsVerified is a bool column, so the filter is an exact match); verify writes like VerifyEntityCommand. */
function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/airlines') {
      return pagedResult(applyFilters(airlines, req), req.params)
    }
    if (req.method === 'GET' && req.url === '/admin/data/countries') {
      return pagedResult(applyFilters(countries, req), req.params)
    }
    // flight-statuses is not verifiable, but carries an IsVerified-shaped field to prove the grid
    // never mistakes a column name for verifiability: only a table with a verifier gets the badge.
    if (req.method === 'GET' && req.url === '/admin/data/flight-statuses') {
      return pagedResult([{ Id: 1, Code: 'SCH', Name: 'Scheduled', Description: null, IsVerified: true }], req.params)
    }
    if (req.method === 'PATCH' && /^\/admin\/airlines\/\d+\/verify$/.test(req.url)) return verifyAnswer(req)
    if (req.method === 'PATCH' && /^\/admin\/countries\/[A-Za-z]+\/verify$/.test(req.url)) return verifyCountryAnswer(req)
    throw httpError(404)
  }))
}

// Matches the real verify handler (spec §2.2/§4.4): manual verify stamps VerificationSource
// 'manual' and clears VerificationIssue; unverify clears the source too.
const defaultVerify = (req: SentRequest) => {
  const id = Number(req.url.split('/')[3])
  const { isVerified } = req.data as { isVerified: boolean }
  const row = airlines.find(a => a.Id === id)
  // Results.NotFound(): an empty body, not ProblemDetails.
  if (!row) throw httpError(404)
  airlines = airlines.map(a => (a.Id === id
    ? {
      ...a,
      IsVerified: isVerified,
      VerifiedAt: isVerified ? '2026-09-13T21:00:00Z' : null,
      VerifiedBy: isVerified ? 'admin-oid' : null,
      VerificationSource: isVerified ? 'manual' : null,
      VerificationIssue: null,
    }
    : a))
  return undefined
}

const defaultVerifyCountry = (req: SentRequest) => {
  const code = req.url.split('/')[3]
  const { isVerified } = req.data as { isVerified: boolean }
  const row = countries.find(c => c.Code === code)
  if (!row) throw httpError(404)
  countries = countries.map(c => (c.Code === code
    ? {
      ...c,
      IsVerified: isVerified,
      VerifiedAt: isVerified ? '2026-09-13T21:00:00Z' : null,
      VerifiedBy: isVerified ? 'admin-oid' : null,
      VerificationSource: isVerified ? 'manual' : null,
      VerificationIssue: null,
    }
    : c))
  return undefined
}

function renderAt(entry: string, queryClient: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter(
    [
      { path: '/data', element: <DataBrowserPage /> },
      { path: '/data/:table', element: <DataBrowserPage /> },
    ],
    { initialEntries: [entry] },
  )
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!
const verifies = () => sent.filter(r => r.method === 'PATCH')

/**
 * Verifying one row, the way the grid now does it: its Verify button opens the dialog on that row
 * alone, and the dialog's own Verify sends the PATCH. Escape closes it before any assertion about
 * the grid — a modal dialog marks everything behind it aria-hidden, so the rows are not reachable
 * by role (or unambiguous by text) while it is open.
 */
async function verifyFromGrid(user: ReturnType<typeof userEvent.setup>, rowName: string) {
  await user.click(within(await rowOf(rowName)).getByRole('button', { name: 'Verify' }))
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Verify' }))
}

describe('DataBrowserPage verify', () => {
  beforeEach(() => {
    airlines = makeAirlines()
    countries = makeCountries()
    verifyAnswer = defaultVerify
    verifyCountryAnswer = defaultVerifyCountry
    install()
  })

  // Unverifying belongs to the record page (VerificationPanel), which shows what the verification
  // was before undoing it. The grid offers no way to do it — that is what this asserts.
  it('offers Verify on unverified rows and no way to undo one that is verified', async () => {
    renderAt('/data/airlines?columns=all')

    expect(within(await rowOf('Alpha Air')).queryByRole('button', { name: /^(Verify|Unverify)$/ })).not.toBeInTheDocument()
    expect(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(screen.queryByText(/Verifying isn't available/)).not.toBeInTheDocument()
  })

  it('Verify sends isVerified true and shows the row as verified without a reload', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines?columns=all')

    await verifyFromGrid(user, 'Beta Air')
    await user.keyboard('{Escape}')

    expect(verifies()).toEqual([{ method: 'PATCH', url: '/admin/airlines/2/verify', params: undefined, data: { isVerified: true } }])
    await waitFor(async () => expect(await rowOf('Beta Air')).toHaveTextContent('admin-oid'))
    expect(within(await rowOf('Beta Air')).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })

  it("verifying a row from the grid also invalidates the dashboard card's needs-attention counts", async () => {
    // The dashboard card (NeedsAttentionSection) isn't mounted in this test's tree, so there's no
    // behavioural way to show its count updating here — e.g. after verifying from the filtered
    // "needs attention" grid the card linked from. Spying on the QueryClient and asserting the
    // invalidated key is the closest available proof.
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    renderAt('/data/airlines?columns=all', queryClient)

    await verifyFromGrid(user, 'Beta Air')

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: getAdminGetVerificationNeedsAttentionQueryKey() }))
  })

  it('keeps a column filter when the Verified toggle is used', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/airlines?columns=all&filter=Name%3Aa')
    await rowOf('Alpha Air')

    await user.click(screen.getByRole('button', { name: 'Unverified' }))

    await waitFor(() => expect(new URLSearchParams(router.state.location.search).getAll('filter'))
      .toEqual(['Name:a', 'IsVerified:false']))
    expect(screen.getByText('Beta Air')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Air')).not.toBeInTheDocument()
  })

  it('swaps its own criterion rather than contradicting itself', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/airlines?columns=all&filter=Name%3Aa&filter=IsVerified%3Afalse')
    await rowOf('Beta Air')

    await user.click(screen.getByRole('button', { name: 'Verified' }))

    await waitFor(() => expect(new URLSearchParams(router.state.location.search).getAll('filter'))
      .toEqual(['Name:a', 'IsVerified:true']))
    expect(await screen.findByText('Alpha Air')).toBeInTheDocument()
  })

  it('All removes only the verified criterion', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/airlines?columns=all&filter=Name%3Aa&filter=IsVerified%3Afalse')
    await rowOf('Beta Air')

    await user.click(screen.getByRole('button', { name: 'All' }))

    await waitFor(() => expect(new URLSearchParams(router.state.location.search).getAll('filter'))
      .toEqual(['Name:a']))
  })

  it('marks the toggle from the criterion that is applied, whatever else is', async () => {
    renderAt('/data/airlines?columns=all&filter=Name%3Aa&filter=IsVerified%3Atrue')
    await rowOf('Alpha Air')

    expect(screen.getByRole('button', { name: 'Verified' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('filters to unverified, verified or all rows, keeping the choice in the URL', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/airlines?columns=all')
    await rowOf('Alpha Air')

    await user.click(screen.getByRole('button', { name: 'Unverified' }))
    await waitFor(() => expect(screen.queryByText('Alpha Air')).not.toBeInTheDocument())
    expect(screen.getByText('Beta Air')).toBeInTheDocument()
    expect(screen.getByText('Gamma Air')).toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get('filter')).toBe('IsVerified:false')
    expect(screen.getByRole('button', { name: 'Unverified' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Verified' }))
    expect(await screen.findByText('Alpha Air')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Beta Air')).not.toBeInTheDocument())
    expect(new URLSearchParams(router.state.location.search).get('filter')).toBe('IsVerified:true')

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(await screen.findByText('Gamma Air')).toBeInTheDocument()
    expect(screen.getByText('Alpha Air')).toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get('filter')).toBeNull()
  })

  it('verifying a row while showing unverified rows takes it off the list', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines?columns=all&filter=IsVerified:false')

    await verifyFromGrid(user, 'Beta Air')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByText('Beta Air')).not.toBeInTheDocument())
    expect(screen.getByText('Gamma Air')).toBeInTheDocument()
  })

  it("says the row is gone when the API can't find it, and changes nothing", async () => {
    verifyAnswer = () => {
      throw httpError(404)
    }
    const user = userEvent.setup()
    renderAt('/data/airlines?columns=all')

    await verifyFromGrid(user, 'Beta Air')

    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByText("Couldn't verify: it no longer exists")).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })

  it('offers Verify on an unverified country and nothing on a verified one, keyed by its code', async () => {
    renderAt('/data/countries')

    expect(within(await rowOf('Germany')).queryByRole('button', { name: /^(Verify|Unverify)$/ })).not.toBeInTheDocument()
    expect(within(await rowOf('Bulgaria')).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(screen.queryByText(/Verifying isn't available/)).not.toBeInTheDocument()
  })

  it('Verify on a country sends isVerified true to the code route and shows the row as verified', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')

    await verifyFromGrid(user, 'Bulgaria')
    await user.keyboard('{Escape}')

    expect(verifies()).toEqual([{ method: 'PATCH', url: '/admin/countries/BG/verify', params: undefined, data: { isVerified: true } }])
    await waitFor(async () =>
      expect(within(await rowOf('Bulgaria')).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument())
  })

  it("says a country row is gone when the API can't find it, and changes nothing", async () => {
    verifyCountryAnswer = () => {
      throw httpError(404)
    }
    const user = userEvent.setup()
    renderAt('/data/countries')

    await verifyFromGrid(user, 'Bulgaria')

    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByText("Couldn't verify: it no longer exists")).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(within(await rowOf('Bulgaria')).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })

  it('still filters a table keyed by code by verified state', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await rowOf('Germany')

    await user.click(screen.getByRole('button', { name: 'Unverified' }))

    await waitFor(() => expect(screen.queryByText('Germany')).not.toBeInTheDocument())
    expect(screen.getByText('Bulgaria')).toBeInTheDocument()
  })

  it('offers no verify controls or verified filter on a table that is not verifiable', async () => {
    renderAt('/data/flight-statuses')

    const row = await rowOf('Scheduled')
    expect(within(row).queryByRole('button', { name: /verify/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unverified' })).not.toBeInTheDocument()
  })

  it('names every verification state on the icon that stands in for the IsVerified column', async () => {
    renderAt('/data/airlines')
    await rowOf('Alpha Air')

    expect(within(await rowOf('Alpha Air')).getByRole('img', { name: 'Verified · manual' })).toBeInTheDocument()
    expect(within(await rowOf('Beta Air')).getByRole('img', { name: 'Unverified' })).toBeInTheDocument()
    expect(within(await rowOf('Gamma Air')).getByRole('img', { name: 'Needs attention' })).toBeInTheDocument()
  })

  it("renders a non-verifiable table's IsVerified-shaped column as plain text, never an icon", async () => {
    renderAt('/data/flight-statuses')

    const row = await rowOf('Scheduled')
    expect(within(row).getByText('true')).toBeInTheDocument()
    expect(within(row).queryByRole('img', { name: /Verified/ })).not.toBeInTheDocument()
  })

  it('filters on VerificationSource, a hidden column, sending its raw value', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')
    await rowOf('Alpha Air')

    // The picker offers what the grid shows, so a bookkeeping column is reached the same way the
    // grid reaches it (#149). What this test is about is the value that goes out: the raw one.
    await user.click(screen.getByRole('button', { name: /^Show \d+ hidden/ }))
    await chooseFilterColumn(user, 'VerificationSource')
    await user.type(screen.getByLabelText('Filter value'), 'manual')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))

    await waitFor(() => expect(sent.some(r => String(r.params?.filter) === 'VerificationSource:manual')).toBe(true))
  })
})
