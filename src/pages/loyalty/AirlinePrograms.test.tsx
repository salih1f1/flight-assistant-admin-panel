import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, rawRows, type SentRequest } from '@/test/fakeApi'
import { AirlineProgramsSection } from './AirlineProgramsSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const AIRLINE_ID = 7

type Program = {
  id: number; code: string; name: string; kind: string
  airlineId: number | null; allianceCode: string | null
  tiers: { id: number; code: string; name: string; rank: number }[]
}

const makePrograms = (): Program[] => [
  {
    id: 3, code: 'EXEC_CLUB', name: 'Executive Club', kind: 'AIRLINE', airlineId: AIRLINE_ID,
    allianceCode: 'ONEWORLD', tiers: [{ id: 1, code: 'BLUE', name: 'Blue', rank: 1 }],
  },
  // Another airline's: must not show here.
  { id: 4, code: 'MILES_MORE', name: 'Miles & More', kind: 'AIRLINE', airlineId: 9, allianceCode: 'STAR', tiers: [] },
  // Free to attach.
  { id: 5, code: 'FLYING_BLUE', name: 'Flying Blue', kind: 'AIRLINE', airlineId: null, allianceCode: null, tiers: [] },
  { id: 6, code: 'PP', name: 'Priority Pass', kind: 'INDEPENDENT', airlineId: null, allianceCode: null, tiers: [] },
]

// Kind 1 is deliberately not the kind under test, so an attach that falls back to kindId 1
// instead of resolving the program's own kind cannot pass by accident.
const KINDS = [
  { id: 1, code: 'HOTEL', name: 'Hotel programme' },
  { id: 2, code: 'AIRLINE', name: 'Airline programme' },
  { id: 3, code: 'INDEPENDENT', name: 'Independent programme' },
]

let programs: Program[]
let sent: SentRequest[]
/** Set by a test that needs the attach to fail. */
let failWrites = false
/** Set by a test that needs the program list itself to fail. */
let failReads = false

function install() {
  ;({ sent } = installFakeApi(req => {
    // A copy per call, as a real response is: React Query holds the object it was given, and
    // handing back that same reference after a write looks to it like nothing changed.
    if (req.method === 'GET' && req.url === '/admin/loyalty/programs') {
      if (failReads) throw httpError(500)
      return pagedResult(programs.map(p => ({ ...p })), req.params)
    }
    if (req.method === 'GET' && req.url === '/admin/data/loyalty-program-kinds') return pagedResult(rawRows(KINDS), req.params)
    if (req.method === 'PUT' && req.url.startsWith('/admin/loyalty/programs/')) {
      if (failWrites) throw httpError(409, { title: 'Conflict' })
      const id = Number(req.url.split('/').pop())
      const body = req.data as { airlineId?: number | null }
      programs = programs.map(p => (p.id === id ? { ...p, ...body } : p))
      return undefined
    }
    throw httpError(404)
  }))
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><AirlineProgramsSection airlineId={AIRLINE_ID} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  programs = makePrograms()
  failWrites = false
  failReads = false
  install()
})

describe('an airline\'s loyalty programs', () => {
  it('lists the programs that point at this airline, each linking to its own page', async () => {
    renderSection()

    const table = await screen.findByRole('table', { name: 'Loyalty programs' })
    const link = within(table).getByRole('link', { name: 'Executive Club' })
    expect(link).toHaveAttribute('href', '/data/loyalty-programs/3')
    expect(within(table).getByText('EXEC_CLUB')).toBeInTheDocument()
  })

  it('shows what tells one program from another: its kind, alliance and how many tiers it has', async () => {
    renderSection()

    const table = await screen.findByRole('table', { name: 'Loyalty programs' })
    const row = within(table).getByRole('row', { name: /Executive Club/ })
    // The kind arrives as a code; the kinds table is what turns it into a name.
    expect(within(row).getByText('Airline programme')).toBeInTheDocument()
    expect(within(row).getByText('ONEWORLD')).toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
  })

  it('leaves out programs that point at another airline or at none', async () => {
    renderSection()

    const table = await screen.findByRole('table', { name: 'Loyalty programs' })
    expect(within(table).queryByText('Miles & More')).not.toBeInTheDocument()
    expect(within(table).queryByText('Flying Blue')).not.toBeInTheDocument()
  })

  it('offers no attach when the programs could not be loaded, rather than an empty picker', async () => {
    failReads = true

    renderSection()

    expect(await screen.findByText(/could not load loyalty programs/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Attach a program' })).not.toBeInTheDocument()
  })

  it('says so when no program points at this airline', async () => {
    programs = programs.map(p => ({ ...p, airlineId: p.airlineId === AIRLINE_ID ? null : p.airlineId }))

    renderSection()

    expect(await screen.findByText(/no loyalty program points at this airline/i)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Loyalty programs' })).not.toBeInTheDocument()
  })
})

/** Opens the attach picker and chooses `name` from it. */
async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole('combobox', { name: 'Attach a program' }))
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name }))
}

describe('creating a program for an airline', () => {
  it('opens the create form with this airline already chosen', async () => {
    renderSection()
    await screen.findByRole('table', { name: 'Loyalty programs' })

    expect(screen.getByRole('link', { name: /new program/i })).toHaveAttribute('href', `/loyalty/new?airlineId=${AIRLINE_ID}`)
  })
})

describe('attaching an existing program to an airline', () => {
  it('offers only the programs that have no airline yet', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('table', { name: 'Loyalty programs' })

    await user.click(screen.getByRole('combobox', { name: 'Attach a program' }))

    const options = within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(expect.arrayContaining([expect.stringContaining('Flying Blue'), expect.stringContaining('Priority Pass')]))
    // Already this airline's, and already another airline's: neither is free to attach.
    expect(options.join(' ')).not.toContain('Executive Club')
    expect(options.join(' ')).not.toContain('Miles & More')
  })

  it('points the chosen program at this airline, and shows it in the list', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('table', { name: 'Loyalty programs' })

    await pick(user, /Flying Blue/)
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    const table = await screen.findByRole('table', { name: 'Loyalty programs' })
    await waitFor(() => expect(within(table).getByRole('link', { name: 'Flying Blue' })).toBeInTheDocument())
  })

  it('sends the program\'s other fields back unchanged, since the update replaces the whole program', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('table', { name: 'Loyalty programs' })

    await pick(user, /Flying Blue/)
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() => expect(sent.some(r => r.method === 'PUT')).toBe(true))
    const put = sent.find(r => r.method === 'PUT')!
    expect(put.url).toBe('/admin/loyalty/programs/5')
    // kindId, not the kind code the API hands back: the request has no field for a code.
    expect(put.data).toEqual({ code: 'FLYING_BLUE', name: 'Flying Blue', kindId: 2, airlineId: AIRLINE_ID, allianceCode: undefined })
  })

  it('refuses a program whose kind is not in the kinds list, rather than blanking its kind', async () => {
    programs = programs.map(p => (p.id === 5 ? { ...p, kind: 'RETIRED_KIND' } : p))
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('table', { name: 'Loyalty programs' })

    await pick(user, /Flying Blue/)

    expect(await screen.findByText(/kind "RETIRED_KIND" isn't in the kinds list/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled()
    expect(sent.some(r => r.method === 'PUT')).toBe(false)
  })

  it('reports a failed attach and keeps the choice, so it can be tried again', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('table', { name: 'Loyalty programs' })
    failWrites = true

    await pick(user, /Flying Blue/)
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not attach/i)
    expect(screen.getByRole('combobox', { name: 'Attach a program' })).toHaveTextContent(/Flying Blue/)
  })
})
