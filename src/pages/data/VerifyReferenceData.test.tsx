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

// Countries is verifiable but keyed by Code (CountryConfiguration: HasKey(x => x.Code)) and has
// no Id column, while PATCH /admin/countries/{id:int}/verify only takes a number.
const COUNTRIES = [
  { Code: 'DE', Name: 'Germany', IsVerified: true, VerifiedAt: '2026-09-01T10:00:00Z', VerifiedBy: 'admin-oid' },
  { Code: 'BG', Name: 'Bulgaria', IsVerified: false, VerifiedAt: null, VerifiedBy: null },
]

// Shaped like GET /admin/data/airlines rows (trimmed to a few columns): IsVerified,
// VerifiedAt and VerifiedBy as the registry exposes them; unverified rows have both null.
type Airline = { Id: number; Name: string; IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null }
const makeAirlines = (): Airline[] => [
  { Id: 1, Name: 'Alpha Air', IsVerified: true, VerifiedAt: '2026-09-01T10:00:00Z', VerifiedBy: 'admin-oid' },
  { Id: 2, Name: 'Beta Air', IsVerified: false, VerifiedAt: null, VerifiedBy: null },
  { Id: 3, Name: 'Gamma Air', IsVerified: false, VerifiedAt: null, VerifiedBy: null },
]

let airlines: Airline[]
let sent: SentRequest[]
let verifyAnswer: (req: SentRequest) => unknown

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
      const rows = filter?.startsWith('IsVerified:') ? COUNTRIES.filter(c => String(c.IsVerified) === filter.slice('IsVerified:'.length)) : COUNTRIES
      return pagedResult(rows, req.params)
    }
    if (req.method === 'GET' && req.url === '/admin/data/flight-statuses') return pagedResult([{ Id: 1, Code: 'SCH', Name: 'Scheduled', Description: null }], req.params)
    if (req.method === 'PATCH' && /^\/admin\/airlines\/\d+\/verify$/.test(req.url)) return verifyAnswer(req)
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
    verifyAnswer = defaultVerify
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

  it("offers no Verify on a table keyed by code, since the verify route only takes a number, and says why", async () => {
    renderAt('/data/countries')

    const row = await rowOf('Bulgaria')
    expect(within(row).queryByRole('button', { name: /verify/i })).not.toBeInTheDocument()
    expect(screen.getByText("Verifying isn't available for Countries: the API's verify route takes a numeric id, and these rows have none.")).toBeInTheDocument()
    expect(verifies()).toHaveLength(0)
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
})
