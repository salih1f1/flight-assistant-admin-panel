import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// airports has an outside source (VERIFICATION_ENTITY_TYPES.airports === 'Airport'); alliances is
// verifiable but has no entry in VERIFICATION_ENTITY_TYPES, so it gets no mode toggle at all.
// airlines is used for the "no sources" case — the backend returns [] for it until backend step 9.
const TABLES = [
  { slug: 'airports', displayName: 'Airports', rowCount: 12 },
  { slug: 'airlines', displayName: 'Airlines', rowCount: 1 },
  { slug: 'countries', displayName: 'Countries', rowCount: 2 },
  { slug: 'alliances', displayName: 'Alliances', rowCount: 1 },
]

type Airport = { Id: number; Iata: string; Name: string; IsVerified: boolean; VerificationSource: string | null; VerificationIssue: string | null }
// 12 rows, matching the brief's fixture: keys ['1', ..., '12'] in grid order.
const makeAirports = (): Airport[] => Array.from({ length: 12 }, (_, i) => ({
  Id: i + 1, Iata: `AA${i}`, Name: `Airport ${i + 1}`, IsVerified: false, VerificationSource: null, VerificationIssue: null,
}))

type Airline = { Id: number; Name: string; IsVerified: boolean; VerificationSource: string | null; VerificationIssue: string | null }
const makeAirlines = (): Airline[] => [{ Id: 1, Name: 'Alpha Air', IsVerified: false, VerificationSource: null, VerificationIssue: null }]

// Countries is keyed by Code, not Id.
type Country = { Code: string; Name: string; IsVerified: boolean; VerificationSource: string | null; VerificationIssue: string | null }
const makeCountries = (): Country[] => [
  { Code: 'DE', Name: 'Germany', IsVerified: false, VerificationSource: null, VerificationIssue: null },
  { Code: 'BG', Name: 'Bulgaria', IsVerified: false, VerificationSource: null, VerificationIssue: null },
]

type Alliance = { Id: number; Code: string; Name: string; IsVerified: boolean; VerificationSource: string | null; VerificationIssue: string | null }
const makeAlliances = (): Alliance[] => [{ Id: 1, Code: 'SA', Name: 'Star Alliance', IsVerified: false, VerificationSource: null, VerificationIssue: null }]

// The brief's fixture (aeroapi costs $0.015/row, ourairports is free), plus a third source with its
// own distinct non-zero cost: with only two sources and one of them free, "sum of checked", "max of
// checked" and "last checked" all happen to produce the same total, so they can't be told apart. The
// third cost breaks that coincidence.
const FAKE_SOURCES = [
  { name: 'aeroapi', costPerRowUsd: 0.015 },
  { name: 'oag', costPerRowUsd: 0.02 },
  { name: 'ourairports', costPerRowUsd: 0 },
]
const FAKE_USAGE = { totalCostUsd: 2.1, monthlyBudgetUsd: 5 }

let airports: Airport[]
let airlines: Airline[]
let countries: Country[]
let alliances: Alliance[]
let sent: SentRequest[]
let sourcesAnswer: (req: SentRequest) => unknown
let usageAnswer: (req: SentRequest) => unknown
let queueAnswer: (req: SentRequest) => unknown

// Matches the real verify handler (also used by VerifySelected.test.tsx): manual verify stamps
// VerificationSource 'manual'; a missing row answers an empty 404.
function verifyAirport(req: SentRequest) {
  const id = Number(req.url.split('/')[3])
  const { isVerified } = req.data as { isVerified: boolean }
  if (!airports.some(a => a.Id === id)) throw httpError(404)
  airports = airports.map(a => (a.Id === id ? { ...a, IsVerified: isVerified, VerificationSource: isVerified ? 'manual' : null } : a))
  return undefined
}

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/airports') return pagedResult(airports, req.params)
    if (req.method === 'GET' && req.url === '/admin/data/airlines') return pagedResult(airlines, req.params)
    if (req.method === 'GET' && req.url === '/admin/data/countries') return pagedResult(countries, req.params)
    if (req.method === 'GET' && req.url === '/admin/data/alliances') return pagedResult(alliances, req.params)
    if (req.method === 'PATCH' && /^\/admin\/airports\/\d+\/verify$/.test(req.url)) return verifyAirport(req)
    if (req.method === 'GET' && req.url === '/admin/verification-sources') return sourcesAnswer(req)
    if (req.method === 'GET' && req.url === '/admin/usage/aeroapi') return usageAnswer(req)
    if (req.method === 'POST' && req.url === '/admin/verification-requests') return queueAnswer(req)
    throw httpError(404)
  }))
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserPage /> }],
    { initialEntries: [entry] },
  )
  const queryClient = createTestQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const posts = () => sent.filter(r => r.method === 'POST')
const sourcesRequests = () => sent.filter(r => r.method === 'GET' && r.url === '/admin/verification-sources')

/** Selects all rows on the current page (the airports fixture is exactly one page of 12). */
async function selectAllAndOpenDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
  await user.click(screen.getByRole('button', { name: /^Verify selected/ }))
  return screen.findByRole('dialog')
}

describe('VerifyDialog: against sources', () => {
  beforeEach(() => {
    airports = makeAirports()
    airlines = makeAirlines()
    countries = makeCountries()
    alliances = makeAlliances()
    sourcesAnswer = () => FAKE_SOURCES
    usageAnswer = () => FAKE_USAGE
    queueAnswer = () => ({ queued: 11, skipped: 1 })
    install()
  })

  it('1. an airports dialog shows the Verify how group, opened on Manually', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    const group = within(dialog).getByRole('group', { name: 'Verify how' })
    expect(within(group).getByRole('button', { name: 'Manually' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Against sources' })).toHaveAttribute('aria-pressed', 'false')
    // Opened on Manually: the per-row Verify buttons are already on screen.
    expect(within(dialog).getByRole('button', { name: 'Verify all shown' })).toBeInTheDocument()
  })

  it('1. an alliances dialog (no registered source) shows no Verify how group', async () => {
    const user = userEvent.setup()
    renderAt('/data/alliances')
    await screen.findByText('Star Alliance')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: /^Verify selected/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('group', { name: 'Verify how' })).not.toBeInTheDocument()
  })

  it('2. Against sources sends GET /admin/verification-sources?entityType=Airport and lists sources; none checked, Start disabled', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))

    expect(await within(dialog).findByRole('checkbox', { name: 'aeroapi' })).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'ourairports' })).toBeInTheDocument()
    expect(sourcesRequests()).toEqual([{ method: 'GET', url: '/admin/verification-sources', params: { entityType: 'Airport' }, data: undefined }])
    expect(within(dialog).getByRole('checkbox', { name: 'aeroapi' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'ourairports' })).not.toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('a failed sources fetch shows an alert, not the empty-sources message', async () => {
    sourcesAnswer = () => {
      throw httpError(500, { title: 'Something went wrong' })
    }
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))

    expect(await within(dialog).findByText('Could not load sources: Something went wrong')).toBeInTheDocument()
    expect(within(dialog).queryByText('No outside source can check these rows yet.')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('3. the cost line reflects the checked sources', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    await within(dialog).findByRole('checkbox', { name: 'aeroapi' })

    // Checked in this order (the free source first) so that a "use the first checked source's
    // cost" bug — reading whichever source was checked first rather than summing every checked
    // source — would show $0.00 here instead of the correct total. All three checked: sum =
    // 0.015 + 0 + 0.02 = 0.035; a "max of checked" or "last checked" bug would show $0.02 instead.
    await user.click(within(dialog).getByRole('checkbox', { name: 'ourairports' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'aeroapi' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'oag' }))
    expect(await within(dialog).findByText('12 × $0.035 = $0.42 · this month $2.10 of $5.00')).toBeInTheDocument()

    // Unchecking aeroapi leaves ourairports (0) and oag (0.02) checked: sum = 0.02.
    await user.click(within(dialog).getByRole('checkbox', { name: 'aeroapi' }))
    expect(await within(dialog).findByText('12 × $0.02 = $0.24 · this month $2.10 of $5.00')).toBeInTheDocument()
  })

  it('4. a failed usage fetch drops the month part with no alert', async () => {
    usageAnswer = () => {
      throw httpError(503)
    }
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    await user.click(await within(dialog).findByRole('checkbox', { name: 'aeroapi' }))

    expect(await within(dialog).findByText('12 × $0.015 = $0.18')).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('5. Start sends sources in the API-listed order and keys as strings, then shows the queue result', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    await within(dialog).findByRole('checkbox', { name: 'aeroapi' })

    // Checked ourairports first, then aeroapi — the sent order must still be the API's own
    // (aeroapi, ourairports), not click order.
    await user.click(within(dialog).getByRole('checkbox', { name: 'ourairports' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'aeroapi' }))
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))

    await within(dialog).findByText('Queued 11 · skipped 1')
    expect(posts()).toEqual([{
      method: 'POST',
      url: '/admin/verification-requests',
      params: undefined,
      data: { entityType: 'Airport', keys: Array.from({ length: 12 }, (_, i) => String(i + 1)), sources: ['aeroapi', 'ourairports'] },
    }])
    expect(within(dialog).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'aeroapi' })).toBeDisabled()
    expect(within(dialog).getByRole('checkbox', { name: 'ourairports' })).toBeDisabled()
  })

  it('6. a 400 from Start shows the validation message and re-enables Start', async () => {
    queueAnswer = () => {
      throw httpError(400, { title: 'Validation failed', errors: { 'Keys[0]': ['Key 0 is not a valid airport id.'] } })
    }
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    await user.click(await within(dialog).findByRole('checkbox', { name: 'aeroapi' }))
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))

    expect(await within(dialog).findByText("Couldn't queue checks: Validation failed")).toBeInTheDocument()
    expect(within(dialog).getByText('Key 0 is not a valid airport id.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Start' })).toBeEnabled()
  })

  it('7. no sources shows the empty message, no checkbox and no Start', async () => {
    sourcesAnswer = () => []
    const user = userEvent.setup()
    renderAt('/data/airlines')
    await screen.findByText('Alpha Air')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: /^Verify selected/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))

    expect(await within(dialog).findByText('No outside source can check these rows yet.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('8. a countries dialog sends entityType Country and keys as codes', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await screen.findByText('Germany')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))
    await user.click(screen.getByRole('button', { name: /^Verify selected/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    await within(dialog).findByRole('checkbox', { name: 'aeroapi' })

    expect(sourcesRequests()).toEqual([{ method: 'GET', url: '/admin/verification-sources', params: { entityType: 'Country' }, data: undefined }])

    await user.click(within(dialog).getByRole('checkbox', { name: 'aeroapi' }))
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))
    await within(dialog).findByText('Queued 11 · skipped 1')
    expect(posts()[0].data).toMatchObject({ entityType: 'Country', keys: ['DE', 'BG'] })
  })

  it('switching mode does not disturb a Manually outcome, or a checked source', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    const row1 = (await within(dialog).findByText('Airport 1')).closest('tr')!
    await user.click(within(row1).getByRole('button', { name: 'Verify' }))
    await within(row1).findByText('Verified · manual')

    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    await user.click(await within(dialog).findByRole('checkbox', { name: 'aeroapi' }))

    await user.click(within(dialog).getByRole('button', { name: 'Manually' }))
    const row1Again = (await within(dialog).findByText('Airport 1')).closest('tr')!
    expect(within(row1Again).getByText('Verified · manual')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    // The sources panel itself remounts on every mode switch (sources/usage are only fetched while
    // it's shown), but the checked set lives in VerifyDialog's own session state, so it survives the
    // round trip without needing to re-check anything.
    expect(await within(dialog).findByRole('checkbox', { name: 'aeroapi' })).toBeChecked()
    expect(await within(dialog).findByText('12 × $0.015 = $0.18 · this month $2.10 of $5.00')).toBeInTheDocument()
  })

  it('a mode round trip after a successful queue keeps the receipt and the disabled, checked sources', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Airport 1')

    const dialog = await selectAllAndOpenDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    await user.click(await within(dialog).findByRole('checkbox', { name: 'aeroapi' }))
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))
    await within(dialog).findByText('Queued 11 · skipped 1')

    await user.click(within(dialog).getByRole('button', { name: 'Manually' }))
    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))

    expect(await within(dialog).findByText('Queued 11 · skipped 1')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'aeroapi' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'aeroapi' })).toBeDisabled()
  })
})
