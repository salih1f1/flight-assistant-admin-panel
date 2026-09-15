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

// airlines is one of the 8 verifiable tables (PATCH /admin/airlines/{id}/verify exists);
// flight-statuses isn't.
const TABLES = [
  { slug: 'airlines', displayName: 'Airlines', rowCount: 3 },
  { slug: 'countries', displayName: 'Countries', rowCount: 2 },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
]

// Countries is verifiable but keyed by Code (CountryConfiguration: HasKey(x => x.Code)), so its
// verify route is PATCH /admin/countries/{code}/verify — a string key, unlike the other 7 tables.
type Country = { Code: string; Name: string; IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null }
const makeCountries = (): Country[] => [
  { Code: 'DE', Name: 'Germany', IsVerified: true, VerifiedAt: '2026-09-01T10:00:00Z', VerifiedBy: 'admin-oid' },
  { Code: 'BG', Name: 'Bulgaria', IsVerified: false, VerifiedAt: null, VerifiedBy: null },
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

/** Reads like the data browser (IsVerified is a bool column, so the filter is an exact match); verify writes like VerifyEntityCommand. */
function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/airlines') {
      const filter = req.params?.filter as string | undefined
      const rows = filter?.startsWith('IsVerified:') ? airlines.filter(a => String(a.IsVerified) === filter.slice('IsVerified:'.length)) : airlines
      return pagedResult(rows, req.params)
    }
    if (req.method === 'GET' && req.url === '/admin/data/countries') {
      const filter = req.params?.filter as string | undefined
      const rows = filter?.startsWith('IsVerified:') ? countries.filter(c => String(c.IsVerified) === filter.slice('IsVerified:'.length)) : countries
      return pagedResult(rows, req.params)
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

const defaultVerify = (req: SentRequest) => {
  const id = Number(req.url.split('/')[3])
  const { isVerified } = req.data as { isVerified: boolean }
  const row = airlines.find(a => a.Id === id)
  // Results.NotFound(): an empty body, not ProblemDetails.
  if (!row) throw httpError(404)
  airlines = airlines.map(a => (a.Id === id
    ? { ...a, IsVerified: isVerified, VerifiedAt: isVerified ? '2026-09-13T21:00:00Z' : null, VerifiedBy: isVerified ? 'admin-oid' : null }
    : a))
  return undefined
}

const defaultVerifyCountry = (req: SentRequest) => {
  const code = req.url.split('/')[3]
  const { isVerified } = req.data as { isVerified: boolean }
  const row = countries.find(c => c.Code === code)
  if (!row) throw httpError(404)
  countries = countries.map(c => (c.Code === code
    ? { ...c, IsVerified: isVerified, VerifiedAt: isVerified ? '2026-09-13T21:00:00Z' : null, VerifiedBy: isVerified ? 'admin-oid' : null }
    : c))
  return undefined
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/data', element: <DataBrowserPage /> },
      { path: '/data/:table', element: <DataBrowserPage /> },
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

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!
const verifies = () => sent.filter(r => r.method === 'PATCH')

describe('DataBrowserPage verify', () => {
  beforeEach(() => {
    airlines = makeAirlines()
    countries = makeCountries()
    verifyAnswer = defaultVerify
    verifyCountryAnswer = defaultVerifyCountry
    install()
  })

  it("offers Verify on unverified rows and Unverify on verified ones", async () => {
    renderAt('/data/airlines?columns=all')

    expect(within(await rowOf('Alpha Air')).getByRole('button', { name: 'Unverify' })).toBeInTheDocument()
    expect(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(screen.queryByText(/Verifying isn't available/)).not.toBeInTheDocument()
  })

  it('Verify sends isVerified true and shows the row as verified without a reload', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines?columns=all')

    await user.click(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' }))

    expect(await within(await rowOf('Beta Air')).findByRole('button', { name: 'Unverify' })).toBeInTheDocument()
    expect(verifies()).toEqual([{ method: 'PATCH', url: '/admin/airlines/2/verify', params: undefined, data: { isVerified: true } }])
    expect(await rowOf('Beta Air')).toHaveTextContent('admin-oid')
  })

  it('Unverify sends isVerified false and clears the verified details', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines?columns=all')

    await user.click(within(await rowOf('Alpha Air')).getByRole('button', { name: 'Unverify' }))

    expect(await within(await rowOf('Alpha Air')).findByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(verifies()).toEqual([expect.objectContaining({ url: '/admin/airlines/1/verify', data: { isVerified: false } })])
    expect(await rowOf('Alpha Air')).not.toHaveTextContent('admin-oid')
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

    await user.click(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(screen.queryByText('Beta Air')).not.toBeInTheDocument())
    expect(screen.getByText('Gamma Air')).toBeInTheDocument()
  })

  it("says the row is gone when the API can't find it, and changes nothing", async () => {
    verifyAnswer = () => {
      throw httpError(404)
    }
    const user = userEvent.setup()
    renderAt('/data/airlines?columns=all')

    await user.click(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't verify row 2: it no longer exists. Refresh to see the current rows.")
    expect(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })

  it('offers Verify on an unverified country and Unverify on a verified one, keyed by its code', async () => {
    renderAt('/data/countries')

    expect(within(await rowOf('Germany')).getByRole('button', { name: 'Unverify' })).toBeInTheDocument()
    expect(within(await rowOf('Bulgaria')).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(screen.queryByText(/Verifying isn't available/)).not.toBeInTheDocument()
  })

  it('Verify on a country sends isVerified true to the code route and shows the row as verified', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')

    await user.click(within(await rowOf('Bulgaria')).getByRole('button', { name: 'Verify' }))

    expect(await within(await rowOf('Bulgaria')).findByRole('button', { name: 'Unverify' })).toBeInTheDocument()
    expect(verifies()).toEqual([{ method: 'PATCH', url: '/admin/countries/BG/verify', params: undefined, data: { isVerified: true } }])
  })

  it('Unverify on a country sends isVerified false to the code route', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')

    await user.click(within(await rowOf('Germany')).getByRole('button', { name: 'Unverify' }))

    expect(await within(await rowOf('Germany')).findByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(verifies()).toEqual([expect.objectContaining({ url: '/admin/countries/DE/verify', data: { isVerified: false } })])
  })

  it("names a country row by its code when the API can't find it, and changes nothing", async () => {
    verifyCountryAnswer = () => {
      throw httpError(404)
    }
    const user = userEvent.setup()
    renderAt('/data/countries')

    await user.click(within(await rowOf('Bulgaria')).getByRole('button', { name: 'Verify' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't verify row BG: it no longer exists. Refresh to see the current rows.")
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

  it('shows a status badge for each verification state in the IsVerified cell', async () => {
    renderAt('/data/airlines')

    expect(await rowOf('Alpha Air')).toHaveTextContent('Verified · manual')
    expect(await rowOf('Beta Air')).toHaveTextContent('Unverified')
    expect(await rowOf('Gamma Air')).toHaveTextContent('Needs attention')
  })

  it("renders a non-verifiable table's IsVerified-shaped column as plain text, never a badge", async () => {
    renderAt('/data/flight-statuses')

    const row = await rowOf('Scheduled')
    expect(within(row).getByText('true')).toBeInTheDocument()
    expect(within(row).queryByText('Verified')).not.toBeInTheDocument()
  })

  it('filters on VerificationSource, a hidden column, sending its raw value', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')
    await rowOf('Alpha Air')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'VerificationSource')
    await user.type(screen.getByLabelText('Filter value'), 'manual')
    await user.click(screen.getByRole('button', { name: 'Apply filter' }))

    await waitFor(() => expect(sent.some(r => r.params?.filter === 'VerificationSource:manual')).toBe(true))
  })
})
