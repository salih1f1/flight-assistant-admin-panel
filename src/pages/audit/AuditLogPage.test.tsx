import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { AuditLogPage } from './AuditLogPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TRAVELER_ID = '3f2b8c1e-9a4d-4e6b-8f10-2c7d5e9a1b01'

// AdminAuditAction in declaration order: the generated client sends the action filter as this number.
const ACTIONS = ['Create', 'Update', 'Delete', 'Verify', 'Import', 'Reveal']

// Shaped like AdminAuditDto as AdminAuditInterceptor and RevealValueCommand write them: EntityType is
// the CLR type name, Before/After hold properties (only the changed ones for an update), sensitive
// values are stored masked, and a reveal records neither.
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
  row(0, { actorId: 'oid-salih', actorName: 'Salih Alishov', action: 'Update', entityType: 'Airline', entityId: '7', summary: 'Update Airline 7', before: { Name: 'British Airway' }, after: { Name: 'British Airways' }, traceId: 'trace-1' }),
  row(1, { actorId: 'oid-salih', actorName: 'Salih Alishov', action: 'Reveal', entityType: 'Traveler', entityId: TRAVELER_ID, summary: `Revealed Email on Traveler ${TRAVELER_ID}` }),
  row(2, { action: 'Create', entityType: 'Airport', entityId: null, summary: 'Create Airport (pending id)', after: { Iata: 'LHR', Name: 'London Heathrow' } }),
  row(3, { action: 'Update', entityType: 'Traveler', entityId: TRAVELER_ID, summary: `Update Traveler ${TRAVELER_ID}`, before: { Email: '<redacted>', DisplayName: 'Ann' }, after: { Email: '<redacted>', DisplayName: 'Ann Example' } }),
  row(4, { action: 'Delete', entityType: 'SeedVersion', entityId: '9', summary: 'Delete SeedVersion 9', before: { Version: 3 } }),
  ...Array.from({ length: 115 }, (_, i) => row(i + 5, {})),
]

let rows: AuditRow[]
let sent: SentRequest[]

/** GET /admin/audit: filters combine with AND, newest first, and a range with from after to is a 400. */
function auditApi(req: SentRequest) {
  if (req.method !== 'GET' || req.url !== '/admin/audit') throw httpError(404)
  const p = req.params ?? {}
  if (p.fromUtc && p.toUtc && String(p.fromUtc) > String(p.toUtc)) {
    throw httpError(400, { title: 'Validation failed', status: 400, errors: { '': ['FromUtc must not be after ToUtc.'] } })
  }
  let result = rows
  if (p.action !== undefined) result = result.filter(r => r.action === ACTIONS[p.action as number])
  if (p.entityType) result = result.filter(r => r.entityType === p.entityType)
  if (p.entityId) result = result.filter(r => r.entityId === p.entityId)
  if (p.actorId) result = result.filter(r => r.actorId?.toLowerCase() === String(p.actorId).toLowerCase())
  return pagedResult(result, p)
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/audit', element: <AuditLogPage /> }],
    { initialEntries: [entry] },
  )
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const lastRequest = () => sent[sent.length - 1]
const search = (router: ReturnType<typeof renderAt>) => new URLSearchParams(router.state.location.search)
const rowOf = async (summary: string) => (await screen.findByText(summary)).closest('tr')!
const cells = (tr: HTMLElement) => within(tr).getAllByRole('cell').map(c => c.textContent)

describe('AuditLogPage', () => {
  beforeEach(() => {
    rows = makeRows()
    ;({ sent } = installFakeApi(auditApi))
  })

  it('lists audit rows newest first: when, who, action, entity and summary', async () => {
    renderAt('/audit')

    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument()
    const first = await rowOf('Update Airline 7')
    expect(cells(first).slice(0, 5)).toEqual(['2026-09-13 20:45 UTC', 'Salih Alishov', 'Update', 'Airline 7', 'Update Airline 7'])
    expect(lastRequest()).toEqual(expect.objectContaining({ method: 'GET', url: '/admin/audit', params: { Page: 1, PageSize: 50 } }))
  })

  it('pages through the log with the API, keeping the page in the URL', async () => {
    const user = userEvent.setup()
    const router = renderAt('/audit')
    await rowOf('Update Airline 7')
    expect(screen.getByText('Page 1 of 3 · 120 total')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Update Lounge 50')).toBeInTheDocument()
    expect(lastRequest().params).toEqual({ Page: 2, PageSize: 50 })
    expect(search(router).get('page')).toBe('2')
  })

  it('shows what an update changed, property by property', async () => {
    const user = userEvent.setup()
    renderAt('/audit')

    await user.click(within(await rowOf('Update Airline 7')).getByRole('button', { name: 'Show changes' }))

    const changes = await screen.findByRole('table', { name: 'Changes to Airline 7' })
    expect(within(changes).getAllByRole('row').slice(1).map(cells)).toEqual([['Name', 'British Airway', 'British Airways']])
  })

  it('shows a create with only the values it wrote, and masked values as masked', async () => {
    const user = userEvent.setup()
    renderAt('/audit')

    await user.click(within(await rowOf('Create Airport (pending id)')).getByRole('button', { name: 'Show changes' }))
    const created = await screen.findByRole('table', { name: 'Changes to Airport (pending id)' })
    expect(within(created).getAllByRole('row').slice(1).map(cells)).toEqual([['Iata', '—', 'LHR'], ['Name', '—', 'London Heathrow']])

    await user.click(within(await rowOf(`Update Traveler ${TRAVELER_ID}`)).getByRole('button', { name: 'Show changes' }))
    const traveler = await screen.findByRole('table', { name: `Changes to Traveler ${TRAVELER_ID}` })
    expect(within(traveler).getAllByRole('row').slice(1).map(cells)).toEqual([['Email', 'Masked', 'Masked'], ['DisplayName', 'Ann', 'Ann Example']])
  })

  it('shows a delete with the values it removed, since a delete has only Before', async () => {
    const user = userEvent.setup()
    renderAt('/audit')

    await user.click(within(await rowOf('Delete SeedVersion 9')).getByRole('button', { name: 'Show changes' }))

    const removed = await screen.findByRole('table', { name: 'Changes to SeedVersion 9' })
    expect(within(removed).getAllByRole('row').slice(1).map(cells)).toEqual([['Version', '3', '—']])
  })

  it('says a reveal records no value, instead of offering changes', async () => {
    renderAt('/audit')

    const reveal = await rowOf(`Revealed Email on Traveler ${TRAVELER_ID}`)
    expect(within(reveal).queryByRole('button', { name: 'Show changes' })).not.toBeInTheDocument()
    expect(reveal).toHaveTextContent('Value not logged')
  })

  it("links an entity to its page when the panel has one, and leaves others as text", async () => {
    renderAt('/audit')

    expect(within(await rowOf('Update Airline 7')).getByRole('link', { name: 'Airline 7' })).toHaveAttribute('href', '/data/airlines/7')
    expect(within(await rowOf(`Update Traveler ${TRAVELER_ID}`)).getByRole('link', { name: `Traveler ${TRAVELER_ID}` })).toHaveAttribute('href', `/travelers/${TRAVELER_ID}`)
    expect(within(await rowOf('Delete SeedVersion 9')).queryByRole('link')).not.toBeInTheDocument()
    expect(within(await rowOf('Create Airport (pending id)')).queryByRole('link')).not.toBeInTheDocument()
  })

  it('filters by action, entity and actor, keeping the filters in the URL', async () => {
    const user = userEvent.setup()
    const router = renderAt('/audit')
    await rowOf('Update Airline 7')

    await user.selectOptions(screen.getByLabelText('Action'), 'Reveal')
    await user.type(screen.getByLabelText('Entity type'), 'Traveler')
    await user.type(screen.getByLabelText('Entity id'), TRAVELER_ID)
    await user.type(screen.getByLabelText('Actor id'), 'OID-SALIH')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))

    expect(await screen.findByText('Page 1 of 1 · 1 total')).toBeInTheDocument()
    expect(screen.getByText(`Revealed Email on Traveler ${TRAVELER_ID}`)).toBeInTheDocument()
    // AdminAuditAction.Reveal is 5.
    expect(lastRequest().params).toEqual({ Page: 1, PageSize: 50, action: 5, entityType: 'Traveler', entityId: TRAVELER_ID, actorId: 'OID-SALIH' })
    expect(Object.fromEntries(search(router))).toEqual({ action: 'Reveal', entityType: 'Traveler', entityId: TRAVELER_ID, actorId: 'OID-SALIH' })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(await screen.findByText('Page 1 of 3 · 120 total')).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
  })

  it('sends a date range as the whole of each day in UTC, since the API reads a bare date as midnight', async () => {
    const user = userEvent.setup()
    const router = renderAt('/audit')
    await rowOf('Update Airline 7')

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-13' } })
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => expect(lastRequest().params).toEqual({ Page: 1, PageSize: 50, fromUtc: '2026-09-01T00:00:00Z', toUtc: '2026-09-13T23:59:59.999Z' }))
    expect(search(router).get('from')).toBe('2026-09-01')
    expect(search(router).get('to')).toBe('2026-09-13')
  })

  it('opens a shared link with its filters applied', async () => {
    renderAt('/audit?action=Update&entityType=Airline&page=1')

    expect(await screen.findByText('Update Airline 7')).toBeInTheDocument()
    expect(lastRequest().params).toEqual({ Page: 1, PageSize: 50, action: 1, entityType: 'Airline' })
    expect(screen.getByLabelText('Action')).toHaveValue('Update')
    expect(screen.getByLabelText('Entity type')).toHaveValue('Airline')
  })

  it("shows the API's reason when it rejects the filters", async () => {
    renderAt('/audit?from=2026-09-13&to=2026-09-01')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the audit log: Validation failed')
    expect(alert).toHaveTextContent('FromUtc must not be after ToUtc.')
  })
})
