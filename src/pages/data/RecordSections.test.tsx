import { render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, rawRows } from '@/test/fakeApi'
import { RecordPage } from './RecordPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'airlines', displayName: 'Airlines', rowCount: 1 },
  { slug: 'loyalty-programs', displayName: 'Loyalty Programs', rowCount: 1 },
  { slug: 'loyalty-program-kinds', displayName: 'Program Kinds', rowCount: 1 },
]

const PROGRAM = {
  id: 3, code: 'EXEC_CLUB', name: 'Executive Club', kind: 'AIRLINE', airlineId: 7, allianceCode: 'OW',
  tiers: [{ id: 2, code: 'GOLD', name: 'Gold', rank: 3, allianceCode: null, allianceTierCode: null }],
}

const ROWS: Record<string, object[]> = {
  airlines: [{ id: 7, iata: 'TK', icao: 'THY', name: 'Turk Hava Yollari', isVerified: true }],
  'loyalty-programs': [{ id: 3, code: 'EXEC_CLUB', name: 'Executive Club', kindId: 1, isVerified: true }],
  'loyalty-program-kinds': [{ id: 1, code: 'AIRLINE', name: 'Airline programme', isVerified: true }],
}

beforeEach(() => {
  installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/verification-requests') return []
    if (req.method === 'GET' && req.url === '/admin/loyalty/programs') return pagedResult([{ ...PROGRAM }], req.params)
    const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
    if (req.method === 'GET' && table && ROWS[table]) return pagedResult(rawRows(ROWS[table]), req.params)
    throw httpError(404)
  })
})

function renderRecord(table: string, id: string) {
  const queryClient = createTestQueryClient()
  const router = createMemoryRouter([{ path: '/data/:table/:id', element: <RecordPage /> }], {
    initialEntries: [`/data/${table}/${id}`],
  })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}

describe('sections that add to a record page', () => {
  it('shows a loyalty program\'s tiers on the program record page', async () => {
    renderRecord('loyalty-programs', '3')

    // The section reads the tiers from the program itself, not from the raw row on this page.
    expect(await screen.findByRole('table', { name: 'Tiers' })).toBeInTheDocument()
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add tier/i })).toBeInTheDocument()
  })

  it('shows an airline\'s loyalty programs on the airline record page', async () => {
    renderRecord('airlines', '7')

    // PROGRAM points at airline 7; the section reads it from the program list, not from this row.
    const table = await screen.findByRole('table', { name: 'Loyalty programs' })
    expect(within(table).getByRole('link', { name: 'Executive Club' })).toHaveAttribute('href', '/data/loyalty-programs/3')
  })

  it('leaves every other table\'s record page alone', async () => {
    renderRecord('loyalty-program-kinds', '1')

    expect(await screen.findByRole('heading', { name: 'Airline programme' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Tiers' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add tier/i })).not.toBeInTheDocument()
  })
})
