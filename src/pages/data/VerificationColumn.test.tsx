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

const TABLES = [
  { slug: 'airlines', displayName: 'Airlines', rowCount: 4 },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
]

type Airline = {
  Id: number; Iata: string; Name: string; CountryCode: string; IsVerified: boolean
  VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}

// Comfortably past any window this could be run with, so the stale row doesn't decay with the calendar.
const LONG_AGO = '2019-01-01T08:30:00Z'

// One row per state the column renders: verified, unverified, needs attention, verified-but-stale.
const makeAirlines = (): Airline[] => [
  { Id: 1, Iata: 'AL', Name: 'Alpha Air', CountryCode: 'DE', IsVerified: true, VerifiedAt: '2026-09-17T10:00:00Z', VerifiedBy: 'admin-oid', VerificationSource: 'manual', VerificationIssue: null },
  { Id: 2, Iata: 'BE', Name: 'Beta Air', CountryCode: 'FR', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null },
  { Id: 3, Iata: 'GA', Name: 'Gamma Air', CountryCode: 'IT', IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: 'ourairports: Name differs' },
  { Id: 4, Iata: 'DE', Name: 'Delta Air', CountryCode: 'ES', IsVerified: true, VerifiedAt: LONG_AGO, VerifiedBy: 'admin-oid', VerificationSource: 'ourairports', VerificationIssue: null },
]

let airlines: Airline[]
let sent: SentRequest[]

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    // The icon reads the stale window off the health report, the same way the badge does.
    if (req.method === 'GET' && req.url === '/admin/health') return { verification: { staleAfterDays: 180 } }
    if (req.method === 'GET' && req.url === '/admin/data/airlines') return pagedResult(airlines, req.params)
    // Not verifiable, but carries an IsVerified-shaped column: proves the grid keys off the verifier,
    // never off a column name.
    if (req.method === 'GET' && req.url === '/admin/data/flight-statuses') {
      return pagedResult([{ Id: 1, Code: 'SCH', Name: 'Scheduled', IsVerified: true }], req.params)
    }
    if (req.method === 'PATCH' && /^\/admin\/airlines\/\d+\/verify$/.test(req.url)) {
      const id = Number(req.url.split('/')[3])
      const { isVerified } = req.data as { isVerified: boolean }
      airlines = airlines.map(a => (a.Id === id
        ? { ...a, IsVerified: isVerified, VerifiedAt: '2026-09-18T00:00:00Z', VerifiedBy: 'admin-oid', VerificationSource: 'manual', VerificationIssue: null }
        : a))
      return undefined
    }
    // The sources side of the dialog, so the Against sources mode has something to render.
    if (req.method === 'GET' && req.url === '/admin/verification-sources') return [{ name: 'ourairports', entityType: 'Airline' }]
    throw httpError(404)
  }))
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!
const patches = () => sent.filter(r => r.method === 'PATCH')
const headers = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

describe('the grid says a row\'s verification state with one icon, and only offers Verify', () => {
  beforeEach(() => {
    airlines = makeAirlines()
    install()
  })

  it('1. marks a verified row with an icon naming its source, and offers no button at all', async () => {
    renderAt('/data/airlines')
    const row = within(await rowOf('Alpha Air'))

    expect(row.getByRole('img', { name: 'Verified · manual' })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: /^(Verify|Unverify)$/ })).not.toBeInTheDocument()
  })

  it('2. marks an unverified row with an icon and offers Verify beside it', async () => {
    renderAt('/data/airlines')
    const row = within(await rowOf('Beta Air'))

    expect(row.getByRole('img', { name: 'Unverified' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })

  it('3. marks a row verified longer ago than the window as stale, naming the reason on hover', async () => {
    renderAt('/data/airlines')
    await rowOf('Delta Air')

    const icon = await within(await rowOf('Delta Air')).findByRole('img', { name: 'Verified · stale' })
    expect(icon).toHaveAttribute('title', 'Verified 2019-01-01 08:30 UTC by ourairports — older than the 180-day window')
  })

  /**
   * Verified and stale share the tick, so the tone is the whole of what separates them on screen —
   * the label behind it says which, but nobody reads a title to tell two rows apart in a list. A
   * stale row reporting itself as plainly verified would look exactly right without this.
   */
  it('3b. tints a stale tick amber and a fresh one green, so the two are not the same mark', async () => {
    renderAt('/data/airlines')
    await rowOf('Alpha Air')

    const stale = await within(await rowOf('Delta Air')).findByRole('img', { name: 'Verified · stale' })
    const fresh = within(await rowOf('Alpha Air')).getByRole('img', { name: 'Verified · manual' })
    expect(stale).toHaveClass('text-amber-600')
    expect(fresh).toHaveClass('text-green-600')
  })

  it('4. sends a flagged row to its record page, naming the issue on hover', async () => {
    renderAt('/data/airlines')
    const row = within(await rowOf('Gamma Air'))

    expect(row.getByRole('link', { name: 'Needs attention' })).toHaveAttribute('href', '/data/airlines/3')
    expect(row.getByRole('img', { name: 'Needs attention' })).toHaveAttribute('title', 'ourairports: Name differs')
    expect(row.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })

  it('5. opens the dialog on that one row instead of verifying it outright', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')

    await user.click(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' }))

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Beta Air')).toBeInTheDocument()
    // Its data, not just its name: the point of the prompt is seeing what is being signed off.
    expect(dialog.getByText('BE')).toBeInTheDocument()
    // Nothing else came along from the grid.
    expect(dialog.queryByText('Alpha Air')).not.toBeInTheDocument()
    expect(patches()).toEqual([])
  })

  it('6. offers the single row the same manual-or-sources choice a selection gets', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')

    await user.click(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' }))

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByRole('button', { name: 'Manually' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Against sources' })).toBeInTheDocument()
  })

  it('7. verifies only that row when the dialog\'s Verify is pressed', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')

    await user.click(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(patches()).toEqual([
      { method: 'PATCH', url: '/admin/airlines/2/verify', params: undefined, data: { isVerified: true } },
    ]))
  })

  it('8. shows the row as verified in the grid once the dialog has verified it', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')

    await user.click(within(await rowOf('Beta Air')).getByRole('button', { name: 'Verify' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Verify' }))
    await user.keyboard('{Escape}')

    await waitFor(async () =>
      expect(within(await rowOf('Beta Air')).getByRole('img', { name: 'Verified · manual' })).toBeInTheDocument())
  })

  it('9. keeps IsVerified out of the default columns, reachable behind the hidden-columns toggle', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')
    await rowOf('Alpha Air')

    expect(headers()).not.toContain('IsVerified')

    await user.click(screen.getByRole('button', { name: /^Show \d+ hidden columns$/ }))

    expect(headers()).toContain('IsVerified')
  })

  it('10. leaves a non-verifiable table\'s IsVerified column showing its raw value', async () => {
    renderAt('/data/flight-statuses')
    const row = within(await rowOf('Scheduled'))

    expect(headers()).toContain('IsVerified')
    expect(row.getByText('true')).toBeInTheDocument()
    expect(row.queryByRole('img', { name: /Verified/ })).not.toBeInTheDocument()
  })
})
