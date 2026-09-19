import { render, screen, waitFor, within } from '@testing-library/react'
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

const TABLES = [{ slug: 'airports', displayName: 'Airports', rowCount: 3 }]

type Airport = {
  Id: number; Iata: string; Name: string; City: string; CountryCode: string
  IsVerified: boolean; VerifiedAt: string | null; VerifiedBy: string | null
  VerificationSource: string | null; VerificationIssue: string | null
}

const airport = (Id: number, Iata: string, Name: string, issue: string | null = null): Airport => ({
  Id, Iata, Name, City: `${Name} City`, CountryCode: 'US',
  IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: issue,
})

// Bravo is what the grid flags: unverified with a VerificationIssue, which is exactly what
// verificationState() reads as 'Needs attention'.
const FLAG = 'Name differs from ourairports'
const makeAirports = (): Airport[] => [
  airport(1, 'AAA', 'Alpha Airport'),
  airport(2, 'BBB', 'Bravo Airport', FLAG),
  airport(3, 'CCC', 'Charlie Airport'),
]

let airports: Airport[]
let sent: SentRequest[]

function install() {
  ;({ sent } = installFakeApi(async req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/airports') return pagedResult(airports, req.params)
    if (req.method === 'PATCH' && /^\/admin\/airports\/\d+\/verify$/.test(req.url)) {
      const id = Number(req.url.split('/')[3])
      airports = airports.map(a => (a.Id === id
        ? { ...a, IsVerified: true, VerifiedAt: '2026-09-18T00:00:00Z', VerifiedBy: 'admin-oid', VerificationSource: 'manual', VerificationIssue: null }
        : a))
      return undefined
    }
    throw httpError(404)
  }))
}

function renderGrid() {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserPage /> }],
    { initialEntries: ['/data/airports'] },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!
const patches = () => sent.filter(r => r.method === 'PATCH')

describe('a row that needs attention is decided on its record page, not in the grid', () => {
  beforeEach(() => {
    airports = makeAirports()
    install()
  })

  it('1. links the flagged row to its record page instead of offering Verify', async () => {
    renderGrid()
    const row = within(await rowOf('Bravo Airport'))

    expect(row.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
    expect(row.getByRole('link', { name: 'Needs attention' })).toHaveAttribute('href', '/data/airports/2')
  })

  it('2. still offers Verify on the rows that are not flagged', async () => {
    renderGrid()
    const row = within(await rowOf('Alpha Airport'))

    expect(row.getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(row.queryByRole('link', { name: 'Needs attention' })).not.toBeInTheDocument()
  })

  it('3. disables the flagged row\'s checkbox, so it cannot be selected', async () => {
    const user = userEvent.setup()
    renderGrid()
    await screen.findByText('Bravo Airport')

    const checkbox = screen.getByRole('checkbox', { name: 'Select row 2' })
    expect(checkbox).toBeDisabled()

    await user.click(checkbox)
    expect(screen.getByRole('button', { name: 'Verify selected (0)' })).toBeInTheDocument()
  })

  it('4. leaves the flagged row out when selecting every row on the page', async () => {
    const user = userEvent.setup()
    renderGrid()
    await screen.findByText('Bravo Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }))

    expect(screen.getByRole('button', { name: 'Verify selected (2)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select row 2' })).not.toBeChecked()
  })

  it('5. drops a selected row that a refetch comes back with a new issue on', async () => {
    const user = userEvent.setup()
    renderGrid()
    await screen.findByText('Alpha Airport')

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row 3' }))
    expect(screen.getByRole('button', { name: 'Verify selected (2)' })).toBeInTheDocument()

    // A check lands on Charlie while it sits selected; verifying Alpha refetches the table. The row
    // button opens the dialog on Alpha alone, so the verify itself happens in there — the selection
    // behind it is untouched by that, which is the point of the assertions below.
    airports = airports.map(a => (a.Id === 3 ? { ...a, VerificationIssue: 'City differs from ourairports' } : a))
    await user.click(within(await rowOf('Alpha Airport')).getByRole('button', { name: 'Verify' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Verify' }))
    // Closed before asserting: a modal dialog marks the grid behind it aria-hidden, so the toolbar
    // button is not reachable by role while it is open.
    await user.keyboard('{Escape}')

    // Alpha stays selected (and verified); Charlie drops out because it is now flagged.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify selected (1)' })).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Select row 3' })).toBeDisabled()
    expect(patches()).toHaveLength(1)
  })
})
