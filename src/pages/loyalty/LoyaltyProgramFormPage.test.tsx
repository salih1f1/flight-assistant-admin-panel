import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { LoyaltyProgramFormPage } from './LoyaltyProgramFormPage'
import { LoyaltyProgramsPage } from './LoyaltyProgramsPage'

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), request: vi.fn() },
}))

// Shaped like GET /admin/data/loyalty-program-kinds: rows keyed by the entity's
// PascalCase property names. Kind 1 is deliberately not the kind under test, so
// a form that falls back to kindId 1 cannot pass by accident.
const KINDS = [
  { Id: 1, Code: 'AIRLINE', Name: 'Airline', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null },
  { Id: 2, Code: 'ALLIANCE', Name: 'Alliance', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null },
  { Id: 3, Code: 'HOTEL', Name: 'Hotel', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null },
]

const KIND_OVERRIDES: Record<number, string> = { 3: 'ALLIANCE', 7: 'RETIRED', 250: 'HOTEL' }

// Shaped like LoyaltyProgramDto. 260 programs puts #250 on the second page even
// at the API's maximum PageSize of 200, so the form has to look past page one.
type ProgramRow = { id: number; code: string; name: string; kind: string; airlineId: number | null; allianceCode: string | null; tiers: [] }
const makePrograms = (): ProgramRow[] =>
  Array.from({ length: 260 }, (_, i) => ({
    id: i + 1,
    code: `P${i + 1}`,
    name: `Program ${i + 1}`,
    kind: KIND_OVERRIDES[i + 1] ?? 'AIRLINE',
    airlineId: null,
    allianceCode: null,
    tiers: [],
  }))

let programs: ProgramRow[]
let sent: SentRequest[]

/** An in-memory loyalty API: create and update change what later reads return. */
function loyaltyApi(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/loyalty/programs') return pagedResult(programs, req.params)
  if (req.method === 'GET' && req.url === '/admin/data/loyalty-program-kinds') return pagedResult(KINDS, req.params)
  const body = req.data as { code: string; name: string; kindId: number; airlineId?: number; allianceCode?: string }
  const kindCode = () => KINDS.find(k => k.Id === body.kindId)?.Code ?? `#${body.kindId}`
  if (req.method === 'POST' && req.url === '/admin/loyalty/programs') {
    const id = 1000 + programs.length
    programs = [...programs, { id, code: body.code, name: body.name, kind: kindCode(), airlineId: body.airlineId ?? null, allianceCode: body.allianceCode ?? null, tiers: [] }]
    return { id }
  }
  const byId = req.url.match(/^\/admin\/loyalty\/programs\/(\d+)$/)
  if (req.method === 'PUT' && byId) {
    const id = Number(byId[1])
    if (!programs.some(p => p.id === id)) throw httpError(404)
    programs = programs.map(p => (p.id === id
      ? { ...p, code: body.code, name: body.name, kind: kindCode(), airlineId: body.airlineId ?? null, allianceCode: body.allianceCode ?? null }
      : p))
    return undefined
  }
  throw httpError(404)
}

/** The loyalty routes; staleTime Infinity, so a list only shows a change a mutation invalidated. */
function renderRoutes(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: '/loyalty', element: <LoyaltyProgramsPage /> },
      { path: '/loyalty/new', element: <LoyaltyProgramFormPage /> },
      { path: '/loyalty/:id/edit', element: <LoyaltyProgramFormPage /> },
    ],
    { initialEntries: [initialEntry] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, container: view.container }
}

const putRequest = () => sent.find(r => r.method === 'PUT')

describe('LoyaltyProgramFormPage', () => {
  beforeEach(() => {
    programs = makePrograms()
    ;({ sent } = installFakeApi(loyaltyApi))
  })

  it('fills the form with a program on the first page of the list', async () => {
    renderRoutes('/loyalty/3/edit')

    expect(await screen.findByDisplayValue('Program 3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('P3')).toBeInTheDocument()
  })

  it('fills the form with a program that is not on the first page of the list', async () => {
    renderRoutes('/loyalty/250/edit')

    expect(await screen.findByDisplayValue('Program 250')).toBeInTheDocument()
    expect(screen.getByDisplayValue('P250')).toBeInTheDocument()
  })

  it("preselects the program's own kind, matched by code", async () => {
    renderRoutes('/loyalty/3/edit')

    expect(await screen.findByDisplayValue('Alliance (ALLIANCE)')).toBeInTheDocument()
  })

  it("saving an edit sends the program's real kind id, not 1", async () => {
    const user = userEvent.setup()
    renderRoutes('/loyalty/250/edit')
    await screen.findByDisplayValue('Hotel (HOTEL)')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(putRequest()).toEqual(
        expect.objectContaining({
          url: '/admin/loyalty/programs/250',
          data: expect.objectContaining({ code: 'P250', name: 'Program 250', kindId: 3 }),
        }),
      ),
    )
  })

  it('creating a program sends the kind the admin picked', async () => {
    const user = userEvent.setup()
    const { container } = renderRoutes('/loyalty/new')
    await screen.findByRole('option', { name: 'Hotel (HOTEL)' })

    await user.type(screen.getByPlaceholderText('e.g. EXEC_CLUB'), 'NEWPROG')
    await user.type(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'New Program')
    await user.selectOptions(screen.getByLabelText(/Kind/), 'Hotel (HOTEL)')
    await user.click(screen.getByRole('button', { name: 'Create program' }))

    await waitFor(() =>
      expect(sent).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          url: '/admin/loyalty/programs',
          data: expect.objectContaining({ code: 'NEWPROG', name: 'New Program', kindId: 3 }),
        }),
      ),
    )
  })

  it("will not save a guessed kind when the program's kind is not in the kinds list", async () => {
    const user = userEvent.setup()
    renderRoutes('/loyalty/7/edit')
    await screen.findByDisplayValue('Program 7')
    expect(await screen.findByText(/"RETIRED" isn't in the kinds list/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Choose a kind')).toBeInTheDocument()
    expect(putRequest()).toBeUndefined()
  })

  it('saving a program with no airline does not send airlineId 0', async () => {
    const user = userEvent.setup()
    renderRoutes('/loyalty/250/edit')
    await screen.findByDisplayValue('Hotel (HOTEL)')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(putRequest()).toBeDefined())
    expect((putRequest()!.data as Record<string, unknown>).airlineId).toBeUndefined()
  })

  it("saving keeps a program's airline", async () => {
    programs = programs.map(p => (p.id === 3 ? { ...p, airlineId: 42 } : p))
    const user = userEvent.setup()
    renderRoutes('/loyalty/3/edit')
    await screen.findByDisplayValue('Alliance (ALLIANCE)')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(putRequest()).toEqual(
        expect.objectContaining({ url: '/admin/loyalty/programs/3', data: expect.objectContaining({ airlineId: 42 }) }),
      ),
    )
  })

  it('after saving, the loyalty program list shows the change without a reload', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes('/loyalty')
    await screen.findByText('Program 3')

    await act(async () => {
      await router.navigate('/loyalty/3/edit')
    })
    await screen.findByDisplayValue('Alliance (ALLIANCE)')
    const name = screen.getByDisplayValue('Program 3')
    await user.clear(name)
    await user.type(name, 'Renamed Program')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The form navigates back to /loyalty on success.
    expect(await screen.findByText('Renamed Program')).toBeInTheDocument()
    expect(screen.queryByText('Program 3')).not.toBeInTheDocument()
  })
})
