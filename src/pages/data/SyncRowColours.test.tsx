import { render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'flights', displayName: 'Flights', rowCount: 4 },
  { slug: 'airlines', displayName: 'Airlines', rowCount: 1 },
]

type Row = Record<string, unknown>

// Raw rows as GET /admin/data/flights returns them: SyncMode arrives as its name (backend #392).
let rows: Record<string, Row[]>
const makeRows = (): Record<string, Row[]> => ({
  flights: [
    { Id: 1, FlightNumber: 'FA001', SyncMode: 'Fast', ScheduleMissingSinceUtc: null },
    { Id: 2, FlightNumber: 'FA002', SyncMode: 'Live', ScheduleMissingSinceUtc: null },
    { Id: 3, FlightNumber: 'FA003', SyncMode: 'Stopped', ScheduleMissingSinceUtc: null },
    { Id: 4, FlightNumber: 'FA004', SyncMode: 'Live', ScheduleMissingSinceUtc: '2026-09-18T06:00:00Z' },
  ],
  // Deliberately carries the sync columns even though the real airlines table has none: without
  // them this fixture would pass whether the tint is scoped to flights or applied to every table,
  // since syncRowTone returns '' for a row that lacks the columns either way.
  airlines: [{ Id: 7, Iata: 'TK', Name: 'Turkish Airlines', SyncMode: 'Fast', ScheduleMissingSinceUtc: null }],
})

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!

// The base TableRow class already mentions gray (border-gray-100, hover:bg-gray-50/50), so a bare
// "does it say gray" check can never fail. Every tint adds the left border, and nothing else does,
// so that is what says a row was tinted at all.
const isTinted = (row: Element) => row.className.includes('border-l-4')

describe('flights grid sync colours', () => {
  beforeEach(() => {
    rows = makeRows()
    installFakeApi((req: SentRequest) => {
      if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
      const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
      if (req.method === 'GET' && table && rows[table]) return pagedResult(rows[table], req.params)
      throw httpError(404)
    })
  })

  it('tints each row by the mode it syncs at', async () => {
    renderAt('/data/flights')

    expect((await rowOf('FA001')).className).toContain('bg-green-50')
    expect((await rowOf('FA001')).className).toContain('border-l-green-500')
    expect((await rowOf('FA002')).className).toContain('bg-blue-50')
  })

  it('leaves a stopped flight uncoloured', async () => {
    renderAt('/data/flights')

    expect(isTinted(await rowOf('FA003'))).toBe(false)
  })

  it('marks a flight missing from the schedule red, over its mode', async () => {
    renderAt('/data/flights')

    const missing = await rowOf('FA004')
    expect(missing.className).toContain('bg-red-50')
    expect(missing.className).not.toContain('bg-blue-50')
  })

  // Colour alone would leave the mode unreadable to anyone who can't distinguish these tints, and
  // unsearchable for everyone. SyncMode must stay in the grid as text.
  it('still shows the mode as text, so colour is not the only signal', async () => {
    renderAt('/data/flights')

    expect(within(await rowOf('FA001')).getByText('Fast')).toBeInTheDocument()
    expect(within(await rowOf('FA002')).getByText('Live')).toBeInTheDocument()
  })

  it('explains the colours in a legend', async () => {
    renderAt('/data/flights')
    await rowOf('FA001')

    const legend = screen.getByRole('list', { name: 'Sync colours' })
    expect(within(legend).getByText('Fast')).toBeInTheDocument()
    expect(within(legend).getByText('Not in schedule')).toBeInTheDocument()
  })

  it('leaves every other table plain, legend included, even one carrying the same columns', async () => {
    renderAt('/data/airlines')

    expect(isTinted(await rowOf('Turkish Airlines'))).toBe(false)
    expect(screen.queryByRole('list', { name: 'Sync colours' })).not.toBeInTheDocument()
  })
})
