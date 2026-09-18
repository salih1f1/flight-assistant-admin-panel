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

const TABLES = [{ slug: 'airports', displayName: 'Airports', rowCount: 3 }]

type Airport = {
  Id: number; Iata: string; Icao: string; Name: string; City: string; CountryCode: string
  Latitude: number; Longitude: number; ElevationFt: number
  IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}
const makeAirports = (): Airport[] => [
  { Id: 1, Iata: 'AAA', Icao: 'KAAA', Name: 'Alpha Airport', City: 'Alpha City', CountryCode: 'US', Latitude: 10.1, Longitude: 20.2, ElevationFt: 100, IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 2, Iata: 'BBB', Icao: 'KBBB', Name: 'Bravo Airport', City: 'Bravo City', CountryCode: 'US', Latitude: 11.1, Longitude: 21.2, ElevationFt: 200, IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 3, Iata: 'CCC', Icao: 'KCCC', Name: 'Charlie Airport', City: 'Charlie City', CountryCode: 'US', Latitude: 12.1, Longitude: 22.2, ElevationFt: 300, IsVerified: true, VerifiedAt: '2026-09-16T00:00:00Z', VerifiedBy: 'admin-oid', VerificationSource: 'manual', VerificationIssue: null },
]

let airports: Airport[]
let sent: SentRequest[]
let airportVerifyAnswer: (req: SentRequest) => unknown

const defaultAirportVerify = (req: SentRequest) => {
  const id = Number(req.url.split('/')[3])
  const { isVerified } = req.data as { isVerified: boolean }
  if (!airports.some(a => a.Id === id)) throw httpError(404)
  airports = airports.map(a => (a.Id === id
    ? { ...a, IsVerified: isVerified, VerifiedAt: '2026-09-16T00:00:00Z', VerifiedBy: 'admin-oid', VerificationSource: 'manual', VerificationIssue: null }
    : a))
  return undefined
}

function install() {
  ;({ sent } = installFakeApi(async req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/airports') return pagedResult(airports, req.params)
    if (req.method === 'PATCH' && /^\/admin\/airports\/\d+\/verify$/.test(req.url)) return airportVerifyAnswer(req)
    throw httpError(404)
  }))
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserPage /> }],
    { initialEntries: [entry] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const patches = () => sent.filter(r => r.method === 'PATCH')
const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!

/** The `<dd>` next to the `<dt>` carrying this label, inside the single-row dialog's field list. */
const fieldValue = (dialog: HTMLElement, label: string) => {
  const term = within(dialog).getByText(label, { selector: 'dt' })
  return term.parentElement!.querySelector('dd')!.textContent
}

/** Opens the dialog on one row via that row's own Verify button. */
async function openRowDialog(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(await rowOf(name)).getByRole('button', { name: 'Verify' }))
  return screen.findByRole('dialog')
}

describe('VerifyDialog: one row', () => {
  beforeEach(() => {
    airports = makeAirports()
    airportVerifyAnswer = defaultAirportVerify
    install()
  })

  it('a row\'s own Verify opens a record-shaped dialog, not the batch one', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const dialog = await openRowDialog(user, 'Alpha Airport')

    expect(within(dialog).getByRole('heading', { name: 'Verify this row' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Verify all shown' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
  })

  it('the dialog lists the key column, the checked columns and the status as label/value pairs', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const dialog = await openRowDialog(user, 'Alpha Airport')

    expect(within(dialog).getAllByRole('term').map(t => t.textContent)).toEqual(
      ['Id', 'Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt', 'Status'])
    expect(fieldValue(dialog, 'Id')).toBe('1')
    expect(fieldValue(dialog, 'Name')).toBe('Alpha Airport')
    expect(fieldValue(dialog, 'Status')).toBe('Unverified')
  })

  it('the footer Verify sends the PATCH, closes the dialog, and the grid shows the row verified', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const dialog = await openRowDialog(user, 'Alpha Airport')
    await user.click(within(dialog).getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toEqual([{ method: 'PATCH', url: '/admin/airports/1/verify', params: undefined, data: { isVerified: true } }])
    await waitFor(async () =>
      expect(within(await rowOf('Alpha Airport')).getByRole('img', { name: 'Verified · manual' })).toBeInTheDocument())
  })

  it('Cancel closes the dialog without verifying', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const dialog = await openRowDialog(user, 'Alpha Airport')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toEqual([])
  })

  it('a failed verify keeps the dialog open and shows the message', async () => {
    const user = userEvent.setup()
    airportVerifyAnswer = () => { throw httpError(500, { title: 'Upstream is down' }) }
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const dialog = await openRowDialog(user, 'Alpha Airport')
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Verify' }))

    expect(await within(dialog).findByText("Couldn't verify: Upstream is down")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a 404 says the row no longer exists, and Verify can be pressed again', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')
    airports = airports.filter(a => a.Id !== 1)

    const dialog = await openRowDialog(user, 'Alpha Airport')
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Verify' }))

    expect(await within(dialog).findByText("Couldn't verify: it no longer exists")).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeEnabled()
  })

  it('Verify is disabled while the request is in flight', async () => {
    const user = userEvent.setup()
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    airportVerifyAnswer = async req => { await gate; return defaultAirportVerify(req) }
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const dialog = await openRowDialog(user, 'Alpha Airport')
    await user.click(within(dialog).getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeDisabled())
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toHaveLength(1)
  })

  it('an already-verified single row offers nothing to press', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Charlie Airport')

    // Charlie is already verified, so it has no Verify button of its own — the checkbox is the
    // only way one verified row reaches the dialog.
    await user.click(screen.getByRole('checkbox', { name: 'Select row 3' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    expect(fieldValue(dialog, 'Status')).toBe('Verified · manual')
    expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeDisabled()
  })

  it('Verify selected (1) reaches the same record-shaped dialog', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (1)' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Verify this row' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Verify all shown' })).not.toBeInTheDocument()
  })

  it('two rows keep the batch dialog', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }))
    await user.click(screen.getByRole('button', { name: 'Verify selected (2)' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Verify 2 rows' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Verify all shown' })).toBeInTheDocument()
    expect(within(dialog).getByRole('table')).toBeInTheDocument()
  })

  it('one row still offers the Against sources mode, and that side keeps its own Close', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Alpha Airport')

    const dialog = await openRowDialog(user, 'Alpha Airport')
    expect(within(dialog).getByRole('heading', { name: 'Verify this row' })).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Verify how' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Against sources' }))
    expect(within(dialog).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: 'Close' })[0]).toBeInTheDocument()
  })
})
