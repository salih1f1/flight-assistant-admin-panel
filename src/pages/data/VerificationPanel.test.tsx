import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { useAdminGetBrowsableTableData } from '@/api/generated/admin'
import { VerificationPanel } from './VerificationPanel'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

type Row = Record<string, unknown>

// Shaped like a GET /admin/data/airports row: PascalCase, the verification columns every
// verifiable table carries.
const baseAirport = (overrides: Partial<Row> = {}): Row => ({
  Id: 1, Iata: 'JFK', Icao: 'KJFK', Name: 'JFK Airport', City: 'New York', CountryCode: 'US',
  IsVerified: false, VerificationSource: null, VerificationIssue: null, VerifiedAt: null, VerifiedBy: null,
  ...overrides,
})

// Shaped like a GET /admin/data/countries row: keyed by Code, not Id — countries has no entry in
// EDIT_FORMS, so it's the table that exercises "no edit form" below.
const baseCountry = (overrides: Partial<Row> = {}): Row => ({
  Code: 'DE', Name: 'Germany', Alpha3: 'DEU', NumericCode: 276, Region: 'Europe', Subregion: 'Western Europe',
  IsVerified: false, VerificationSource: null, VerificationIssue: null, VerifiedAt: null, VerifiedBy: null,
  ...overrides,
})

let airports: Row[]
let countries: Row[]
let sent: SentRequest[]
let checksAnswer: (req: SentRequest) => unknown
let sourcesAnswer: (req: SentRequest) => unknown
let queueAnswer: (req: SentRequest) => unknown
let acceptAnswer: (req: SentRequest) => unknown

/** Matches the real accept-source handler: writes the source's values and verifies the row. */
function acceptSource(req: SentRequest) {
  const { source } = req.data as { source: string }
  airports = airports.map(a => ({ ...a, IsVerified: true, VerificationSource: source, VerificationIssue: null }))
  return undefined
}

/** Matches the real verify handler: manual verify stamps VerificationSource 'manual' and clears the issue. */
function verifyAirport(req: SentRequest) {
  const { isVerified } = req.data as { isVerified: boolean }
  airports = airports.map(a => ({ ...a, IsVerified: isVerified, VerificationSource: isVerified ? 'manual' : null, VerificationIssue: null }))
  return undefined
}

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/airports') return pagedResult(airports, req.params)
    if (req.method === 'GET' && req.url === '/admin/data/countries') return pagedResult(countries, req.params)
    if (req.method === 'GET' && req.url === '/admin/verification-requests') return checksAnswer(req)
    if (req.method === 'GET' && req.url === '/admin/verification-sources') return sourcesAnswer(req)
    if (req.method === 'POST' && req.url === '/admin/verification-requests') return queueAnswer(req)
    if (req.method === 'POST' && /^\/admin\/verification-requests\/\d+\/accept-source$/.test(req.url)) return acceptAnswer(req)
    if (req.method === 'PATCH' && /^\/admin\/airports\/\d+\/verify$/.test(req.url)) return verifyAirport(req)
    throw httpError(404)
  }))
}

/**
 * Fetches the row the same way RecordPage does (the real hook, not a stub), so an action's
 * invalidation of the browsable-data query key genuinely refetches and re-renders the panel with
 * the updated row, proving the refresh-through-invalidation wiring actually works end to end
 * rather than assuming it. Defaults to airports (as every existing test used before countries
 * joined); `onEdit` has no default, since whether it exists at all is what's under test here —
 * RecordPage only ever supplies it for a table with an edit form.
 */
function Harness({ table = 'airports', entityType = 'Airport', onEdit }: {
  table?: string
  entityType?: 'Airport' | 'Airline' | 'Country'
  onEdit?: () => void
}) {
  const rows = useAdminGetBrowsableTableData(table, { Page: 1, PageSize: 50 })
  const row = rows.data?.items?.[0]
  if (!row) return <p>Loading…</p>
  const key = table === 'countries' ? 'Code' : 'Id'
  return <VerificationPanel table={table} entityType={entityType} recordKey={String(row[key])} row={row} onEdit={onEdit} />
}

function renderPanel(onEdit?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness onEdit={onEdit} />
    </QueryClientProvider>,
  )
}

/** Countries has no entry in EDIT_FORMS, so RecordPage never supplies onEdit for it — matched here by never passing one. */
function renderCountryPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness table="countries" entityType="Country" />
    </QueryClientProvider>,
  )
}

const checkRequests = () => sent.filter(r => r.method === 'GET' && r.url === '/admin/verification-requests')
const sourcesRequests = () => sent.filter(r => r.method === 'GET' && r.url === '/admin/verification-sources')
const posts = () => sent.filter(r => r.method === 'POST')
/** The value shown for a field: the <dd> after its <dt>, matching RecordPage.test.tsx's own helper. */
const field = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement

describe('VerificationPanel', () => {
  beforeEach(() => {
    checksAnswer = () => []
    sourcesAnswer = () => []
    queueAnswer = () => ({ queued: 0, skipped: 0 })
    acceptAnswer = () => undefined
  })

  it('1. a verified row shows the badge, source, verified at and by, and sends no check request', async () => {
    airports = [baseAirport({ IsVerified: true, VerificationSource: 'ourairports', VerifiedAt: '2026-09-01T10:00:00Z', VerifiedBy: 'admin-oid' })]
    install()
    renderPanel()

    expect(await screen.findByText('Verified · ourairports')).toBeInTheDocument()
    expect(field('Source')).toHaveTextContent('ourairports')
    expect(field('Verified at')).toHaveTextContent('2026-09-01 10:00 UTC')
    expect(field('Verified by')).toHaveTextContent('admin-oid')
    expect(checkRequests()).toEqual([])
  })

  it('2. a needs-attention row requests entityType=Airport&entityKey=1&limit=1 exactly once', async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    install()
    renderPanel()

    await screen.findByRole('button', { name: 'Keep ours and verify' })
    expect(checkRequests()).toEqual([
      { method: 'GET', url: '/admin/verification-requests', params: { entityType: 'Airport', entityKey: '1', limit: 1 }, data: undefined },
    ])
  })

  it("3. a mismatch renders one column per source, with each row's ours and each source's value", async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{
      id: 501, status: 'Mismatch', sources: ['aeroapi', 'oag'],
      differences: [
        { column: 'Iata', ours: 'JFK', source: 'aeroapi', sourceName: 'AeroAPI' },
        { column: 'Name', ours: 'JFK Airport', source: 'aeroapi', sourceName: 'AeroAPI' },
        { column: 'Iata', ours: 'JFK', source: 'oag', sourceName: 'OAG' },
      ],
      sourceValues: { aeroapi: { Iata: 'JFK1', Name: 'John F Kennedy Intl' }, oag: { Iata: 'JFK2' } },
    }]
    install()
    renderPanel(() => {})

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Column', 'Ours', 'AeroAPI', 'OAG'])

    const iataRow = within(table).getByText('Iata').closest('tr')!
    expect(within(iataRow).getAllByRole('cell').map(c => c.textContent)).toEqual(['Iata', 'JFK', 'JFK1', 'JFK2'])

    // Airports have an edit form, so a mismatch offers Edit — unlike countries, see below.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    // Name only differed for aeroapi: oag's cell has nothing to show, not a copy of "ours".
    const nameRow = within(table).getByText('Name').closest('tr')!
    expect(within(nameRow).getAllByRole('cell').map(c => c.textContent)).toEqual(['Name', 'JFK Airport', 'John F Kennedy Intl', '—'])
  })

  it('a country mismatch offers no Edit: countries has no edit form for the button to switch into', async () => {
    countries = [baseCountry({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{
      id: 601, status: 'Mismatch', sources: ['mledoze'],
      differences: [{ column: 'Name', ours: 'Germany', source: 'mledoze', sourceName: 'mledoze' }],
      sourceValues: { mledoze: { Name: 'Deutschland' } },
    }]
    install()
    renderCountryPanel()

    expect(await screen.findByRole('button', { name: 'Take source values' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep ours and verify' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('a Mismatch with no actual differences falls back to the same rendering as no check on file', async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{ id: 501, status: 'Mismatch', sources: ['aeroapi'], differences: [] }]
    install()
    renderPanel()

    expect(await screen.findByText('Automated check found a problem')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep ours and verify' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Take/ })).not.toBeInTheDocument()
  })

  it('an empty-string difference value reads as — the same as a missing one, not blank', async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{
      id: 501, status: 'Mismatch', sources: ['aeroapi'],
      differences: [{ column: 'City', ours: '', source: 'aeroapi', sourceName: 'AeroAPI' }],
      sourceValues: { aeroapi: { City: '' } },
    }]
    install()
    renderPanel()

    const table = await screen.findByRole('table')
    const cityRow = within(table).getByText('City').closest('tr')!
    expect(within(cityRow).getAllByRole('cell').map(c => c.textContent)).toEqual(['City', '—', '—'])
  })

  it('a needs-attention row on a table with no checkable entity type sends no check request', async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    install()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <VerificationPanel table="airports" entityType={undefined} recordKey="1" row={airports[0]} />
      </QueryClientProvider>,
    )

    // Status-only: the plain toggle, not the needs-attention block.
    expect(await screen.findByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(checkRequests()).toEqual([])
  })

  it("4. Take source values sends accept-source with that source's name, then the row shows as verified", async () => {
    const user = userEvent.setup()
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{
      id: 501, status: 'Mismatch', sources: ['aeroapi'],
      differences: [{ column: 'Iata', ours: 'JFK', source: 'aeroapi', sourceName: 'AeroAPI' }],
      sourceValues: { aeroapi: { Iata: 'JFK1' } },
    }]
    acceptAnswer = acceptSource
    install()
    renderPanel()

    // A single disagreeing source: the literal label applies, not the per-source form.
    await user.click(await screen.findByRole('button', { name: 'Take source values' }))

    expect(posts()).toContainEqual({
      method: 'POST', url: '/admin/verification-requests/501/accept-source', params: undefined, data: { source: 'aeroapi' },
    })
    expect(await screen.findByText('Verified · aeroapi')).toBeInTheDocument()
  })

  it('5. two disagreeing sources render two buttons, and clicking one sends only that source', async () => {
    const user = userEvent.setup()
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{
      id: 501, status: 'Mismatch', sources: ['aeroapi', 'oag'],
      differences: [
        { column: 'Iata', ours: 'JFK', source: 'aeroapi', sourceName: 'AeroAPI' },
        { column: 'Iata', ours: 'JFK', source: 'oag', sourceName: 'OAG' },
      ],
      sourceValues: { aeroapi: { Iata: 'JFK1' }, oag: { Iata: 'JFK2' } },
    }]
    acceptAnswer = acceptSource
    install()
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Take AeroAPI values' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take OAG values' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Take OAG values' }))

    await screen.findByText('Verified · oag')
    expect(posts().filter(r => r.url === '/admin/verification-requests/501/accept-source')).toEqual([
      { method: 'POST', url: '/admin/verification-requests/501/accept-source', params: undefined, data: { source: 'oag' } },
    ])
  })

  it('6. Keep ours and verify sends the verify route with isVerified: true', async () => {
    const user = userEvent.setup()
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    install()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Keep ours and verify' }))

    expect(sent).toContainEqual(expect.objectContaining({ method: 'PATCH', url: '/admin/airports/1/verify', data: { isVerified: true } }))
    expect(await screen.findByRole('button', { name: 'Unverify' })).toBeInTheDocument()
  })

  it("7a. Check again reuses the check's own sources", async () => {
    const user = userEvent.setup()
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{ id: 501, status: 'Error', error: 'Timed out', sources: ['aeroapi', 'oag'] }]
    queueAnswer = () => ({ queued: 1, skipped: 0 })
    install()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    // Settlement signal: the button re-enables once the mutation resolves.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled())

    expect(sourcesRequests()).toEqual([])
    expect(posts()).toContainEqual({
      method: 'POST', url: '/admin/verification-requests', params: undefined,
      data: { entityType: 'Airport', keys: ['1'], sources: ['aeroapi', 'oag'] },
    })
  })

  it('7b. Check again falls back to the sources endpoint when the check names none', async () => {
    const user = userEvent.setup()
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{ id: 501, status: 'Error', error: 'Timed out', sources: [] }]
    sourcesAnswer = () => [{ name: 'aeroapi', costPerRowUsd: 0.015 }, { name: 'ourairports', costPerRowUsd: 0 }]
    queueAnswer = () => ({ queued: 1, skipped: 0 })
    install()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    // Settlement signal: the button re-enables once both awaited calls resolve.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled())

    expect(sourcesRequests()).toEqual([{ method: 'GET', url: '/admin/verification-sources', params: { entityType: 'Airport' }, data: undefined }])
    expect(posts()).toContainEqual({
      method: 'POST', url: '/admin/verification-requests', params: undefined,
      data: { entityType: 'Airport', keys: ['1'], sources: ['aeroapi', 'ourairports'] },
    })
  })

  it('8. a 409 on accept shows the message and leaves the row unchanged', async () => {
    const user = userEvent.setup()
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{
      id: 501, status: 'Mismatch', sources: ['aeroapi'],
      differences: [{ column: 'Iata', ours: 'JFK', source: 'aeroapi', sourceName: 'AeroAPI' }],
      sourceValues: { aeroapi: { Iata: 'JFK1' } },
    }]
    // detail carries which of the four documented causes actually fired (outside Production); the
    // custom title above stands in for it, but the detail line itself must still come through.
    acceptAnswer = () => { throw httpError(409, { title: 'Conflict', detail: 'A differing column changed since the check.' }) }
    install()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Take source values' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This row changed, or a check is already running')
    expect(alert).toHaveTextContent('A differing column changed since the check.')
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(field('Source')).toHaveTextContent('—')
    // The row didn't change, so this is still a live option, not something the failure hid.
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })

  it('9. a Pending check shows "running" and offers no accept', async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{ id: 501, status: 'Pending', sources: ['aeroapi'] }]
    install()
    renderPanel()

    expect(await screen.findByText('A check is running.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Take|Keep ours and verify|Check again|Edit/ })).not.toBeInTheDocument()
  })

  it('10. an Error check shows the error text and offers Check again only', async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{ id: 501, status: 'Error', error: 'AeroAPI request failed', sources: ['aeroapi'] }]
    install()
    renderPanel()

    expect(await screen.findByText('AeroAPI request failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep ours and verify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Take/ })).not.toBeInTheDocument()
  })

  it('a NotFound check shows what each source returned, with Keep ours and verify, Edit and Check again — nothing to take', async () => {
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{
      id: 501, status: 'NotFound', sources: ['aeroapi', 'oag'],
      sourceValues: { aeroapi: { Iata: 'JFK1' } },
    }]
    install()
    renderPanel(() => {})

    expect(await screen.findByText('aeroapi')).toBeInTheDocument()
    expect(screen.getByText('Iata: JFK1')).toBeInTheDocument()
    expect(screen.getByText('oag')).toBeInTheDocument()
    expect(screen.getByText('No data returned')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep ours and verify' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Take/ })).not.toBeInTheDocument()
  })

  it('Edit calls onEdit', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    airports = [baseAirport({ VerificationIssue: 'Automated check found a problem' })]
    checksAnswer = () => [{ id: 501, status: 'NotFound', sources: [] }]
    install()
    renderPanel(onEdit)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('the plain toggle unverifies an already-verified row when the table has no checks (status-only panel)', async () => {
    const user = userEvent.setup()
    airports = [baseAirport({ IsVerified: true, VerificationSource: 'manual' })]
    install()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Unverify' }))

    expect(sent).toContainEqual(expect.objectContaining({ method: 'PATCH', url: '/admin/airports/1/verify', data: { isVerified: false } }))
    expect(await screen.findByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })
})
