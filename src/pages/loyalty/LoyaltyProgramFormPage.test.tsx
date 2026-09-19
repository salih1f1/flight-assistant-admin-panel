import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, rawRows, type SentRequest } from '@/test/fakeApi'
import { LoyaltyProgramFormPage } from './LoyaltyProgramFormPage'
import { DataBrowserPage } from '@/pages/data/DataBrowserPage'

const airlineField = () => screen.getByRole('combobox', { name: /Airline/ })

/** Picks an airline the way a person does: open the picker, type, click the single match. */
async function chooseAirline(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.click(airlineField())
  await user.type(screen.getByRole('textbox', { name: 'Search airlines' }), query)
  const shown = within(screen.getByRole('listbox')).getAllByRole('option')
  if (shown.length !== 1) throw new Error(`"${query}" matched ${shown.length} airlines, not one`)
  await user.click(shown[0])
}


vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like GET /admin/data/loyalty-program-kinds: rows keyed by the entity's
// PascalCase property names. Kind 1 is deliberately not the kind under test, so
// a form that falls back to kindId 1 cannot pass by accident.
const KINDS = [
  { Id: 1, Code: 'AIRLINE', Name: 'Airline', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null, VerificationSource: 'manual', VerificationIssue: null },
  { Id: 2, Code: 'ALLIANCE', Name: 'Alliance', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null, VerificationSource: 'manual', VerificationIssue: null },
  { Id: 3, Code: 'HOTEL', Name: 'Hotel', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null, VerificationSource: 'manual', VerificationIssue: null },
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
// Shaped like AirlineAdminDto, as GET /admin/airlines/{id} returns it.
const BRITISH_AIRWAYS = { id: 42, iata: 'BA', icao: 'BAW', name: 'British Airways', countryCode: 'GB', allianceCode: 'ONEWORLD' }
const LUFTHANSA = { id: 7, iata: 'LH', icao: 'DLH', name: 'Lufthansa', countryCode: 'DE', allianceCode: 'STAR' }
let airlines: (typeof BRITISH_AIRWAYS)[]

function loyaltyApi(req: SentRequest) {
  // The grid the form returns to: the same records, as GET /admin/data/loyalty-programs rows.
  if (req.method === 'GET' && req.url === '/admin/data/tables') return []
  if (req.method === 'GET' && req.url === '/admin/data/loyalty-programs') return pagedResult(rawRows(programs), req.params)
  if (req.method === 'GET' && req.url === '/admin/airlines/42') return BRITISH_AIRWAYS
  if (req.method === 'GET' && req.url === '/admin/airlines') return pagedResult(airlines, req.params)
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
      { path: '/data/:table', element: <DataBrowserPage /> },
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
    airlines = [LUFTHANSA, BRITISH_AIRWAYS]
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

  it('shows the airline a program already has, by name', async () => {
    programs = programs.map(p => (p.id === 3 ? { ...p, airlineId: 42 } : p))
    renderRoutes('/loyalty/3/edit')

    await waitFor(() => expect(airlineField()).toHaveTextContent('British Airways (BA)'))
    expect(await screen.findByRole('link', { name: 'British Airways (BA)' })).toHaveAttribute('href', '/data/airlines/42')
  })

  it('picks an airline by name, with no id to know', async () => {
    const user = userEvent.setup()
    renderRoutes('/loyalty/3/edit')
    await screen.findByDisplayValue('Alliance (ALLIANCE)')

    await chooseAirline(user, 'British')

    expect(airlineField()).toHaveTextContent('British Airways (BA)')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(putRequest()).toEqual(expect.objectContaining({ data: expect.objectContaining({ airlineId: 42 }) })),
    )
  })

  it('finds an airline by its code as well as its name', async () => {
    const user = userEvent.setup()
    renderRoutes('/loyalty/3/edit')
    await screen.findByDisplayValue('Alliance (ALLIANCE)')

    await chooseAirline(user, 'DLH')

    expect(airlineField()).toHaveTextContent('Lufthansa (LH)')
  })

  it('clears the airline back to none', async () => {
    programs = programs.map(p => (p.id === 3 ? { ...p, airlineId: 42 } : p))
    const user = userEvent.setup()
    renderRoutes('/loyalty/3/edit')
    await waitFor(() => expect(airlineField()).toHaveTextContent('British Airways (BA)'))

    await user.click(airlineField())
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'No airline' }))

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(putRequest()).toBeDefined())
    expect((putRequest()!.data as Record<string, unknown>).airlineId).toBeUndefined()
  })

  /**
   * GET /admin/airlines is paged at 200 and takes no filter, so the picker holds the whole list.
   * Stopping at the first page would hide most of seven hundred airlines.
   */
  it('offers airlines past the first page of the API', async () => {
    const filler = Array.from({ length: 200 }, (_, i) => ({
      id: 500 + i, iata: null, icao: null, name: `Filler ${i}`, countryCode: 'GB', allianceCode: null,
    })) as unknown as (typeof BRITISH_AIRWAYS)[]
    airlines = [...filler, BRITISH_AIRWAYS]
    const user = userEvent.setup()
    renderRoutes('/loyalty/3/edit')
    await screen.findByDisplayValue('Alliance (ALLIANCE)')

    await chooseAirline(user, 'British')

    expect(airlineField()).toHaveTextContent('British Airways (BA)')
  })

  /**
   * A program can point at an airline the list doesn't hold — one removed since, or a list that
   * failed to load. Dropping it to "no airline" would quietly rewrite the record on the next save.
   */
  it('keeps an airline id the list does not have, and still saves it', async () => {
    programs = programs.map(p => (p.id === 3 ? { ...p, airlineId: 999 } : p))
    const user = userEvent.setup()
    renderRoutes('/loyalty/3/edit')

    await waitFor(() => expect(airlineField()).toHaveTextContent('#999'))

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(putRequest()).toEqual(expect.objectContaining({ data: expect.objectContaining({ airlineId: 999 }) })),
    )
  })

  it('after saving, the loyalty program list shows the change without a reload', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes('/data/loyalty-programs')
    await screen.findByText('Program 3')

    await act(async () => {
      await router.navigate('/loyalty/3/edit')
    })
    await screen.findByDisplayValue('Alliance (ALLIANCE)')
    const name = screen.getByDisplayValue('Program 3')
    await user.clear(name)
    await user.type(name, 'Renamed Program')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The form navigates back to the /data/loyalty-programs grid on success.
    expect(await screen.findByText('Renamed Program')).toBeInTheDocument()
    expect(screen.queryByText('Program 3')).not.toBeInTheDocument()

    // Reopening the program must not show the looked-up copy cached before the save.
    await act(async () => {
      await router.navigate('/loyalty/3/edit')
    })
    expect(await screen.findByDisplayValue('Renamed Program')).toBeInTheDocument()
  })
})
