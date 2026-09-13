import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Dashboard } from './Dashboard'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like AdminAuditDto, newest first as GET /admin/audit returns them.
type AuditRow = {
  id: string; actorId: string | null; actorName: string | null; actionUtc: string; action: string
  entityType: string; entityId: string | null; summary: string; before: unknown; after: unknown; traceId: string | null
}
const row = (n: number, fields: Partial<AuditRow>): AuditRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  actorId: 'oid-robot',
  actorName: 'Import Robot',
  actionUtc: new Date(Date.UTC(2026, 8, 13, 20, 45, 0) - n * 60_000).toISOString(),
  action: 'Update',
  entityType: 'Lounge',
  entityId: String(n),
  summary: `Update Lounge ${n}`,
  before: null,
  after: null,
  traceId: null,
  ...fields,
})

const makeRows = (): AuditRow[] => [
  row(0, { actorId: 'oid-salih', actorName: 'Salih Alishov', action: 'Update', entityType: 'Airline', entityId: '7', summary: 'Update Airline 7' }),
  row(1, { action: 'Delete', entityType: 'SeedVersion', entityId: '9', summary: 'Delete SeedVersion 9' }),
  ...Array.from({ length: 30 }, (_, i) => row(i + 2, {})),
]

let rows: AuditRow[]
let auditAnswer: (req: SentRequest) => unknown
let sent: SentRequest[]

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/audit') return auditAnswer(req)
    // The other Dashboard sections get something harmless; they aren't under test here.
    if (req.method === 'GET' && (req.url === '/admin/health' || req.url === '/admin/usage/aeroapi')) throw httpError(503)
    if (req.method === 'GET' && req.url.startsWith('/admin/')) return pagedResult([], req.params)
    throw httpError(404)
  }))
}

const activity = async () => (await screen.findByRole('heading', { name: 'Recent activity' })).closest('section')!

describe('Dashboard recent activity', () => {
  beforeEach(() => {
    rows = makeRows()
    auditAnswer = req => pagedResult(rows, req.params)
    install()
  })

  it('shows the latest audit rows, newest first, asking for one small page', async () => {
    renderWithProviders(<Dashboard />)
    const section = await activity()

    const first = (await within(section).findByText('Update Airline 7')).closest('li')!
    expect(first).toHaveTextContent('2026-09-13 20:45 UTC')
    expect(first).toHaveTextContent('Salih Alishov')
    expect(first).toHaveTextContent('Update')
    expect(within(section).getAllByRole('listitem')).toHaveLength(5)
    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: '/admin/audit', params: { Page: 1, PageSize: 5 } }))
  })

  it("links a row's entity to its page where the panel has one", async () => {
    renderWithProviders(<Dashboard />)
    const section = await activity()

    const airline = (await within(section).findByText('Update Airline 7')).closest('li')!
    expect(within(airline).getByRole('link', { name: 'Airline 7' })).toHaveAttribute('href', '/airlines/7/edit')
    const seed = within(section).getByText('Delete SeedVersion 9').closest('li')!
    expect(within(seed).queryByRole('link')).not.toBeInTheDocument()
  })

  it('links to the full audit log', async () => {
    renderWithProviders(<Dashboard />)
    const section = await activity()

    expect(within(section).getByRole('link', { name: 'View all activity' })).toHaveAttribute('href', '/audit')
  })

  it('says when there is no activity yet', async () => {
    rows = []
    renderWithProviders(<Dashboard />)
    const section = await activity()

    expect(await within(section).findByText('No admin activity yet.')).toBeInTheDocument()
  })

  it("shows the API's reason when activity can't be loaded, without taking down the Dashboard", async () => {
    auditAnswer = () => {
      throw httpError(500, { title: 'An unexpected error occurred.', status: 500 })
    }
    renderWithProviders(<Dashboard />)
    const section = await activity()

    expect(await within(section).findByRole('alert')).toHaveTextContent('Could not load recent activity: An unexpected error occurred.')
    expect(screen.getByText('Travelers')).toBeInTheDocument()
  })
})
