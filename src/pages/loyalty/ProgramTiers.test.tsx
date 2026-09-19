import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { ProgramTiersSection } from './ProgramTiersSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const PROGRAM_ID = 3

type Tier = {
  id: number; code: string; name: string; rank: number
  allianceCode: string | null; allianceTierCode: string | null
}

// Deliberately out of rank order: the section is expected to sort them, since the API
// promises no order.
const makeTiers = (): Tier[] => [
  { id: 2, code: 'GOLD', name: 'Gold', rank: 3, allianceCode: 'OW', allianceTierCode: 'EMD' },
  { id: 1, code: 'BLUE', name: 'Blue', rank: 1, allianceCode: null, allianceTierCode: null },
  { id: 5, code: 'SILVER', name: 'Silver', rank: 2, allianceCode: null, allianceTierCode: null },
]

let tiers: Tier[]
let sent: SentRequest[]
let writeAnswer: (req: SentRequest) => unknown

const program = () => ({
  id: PROGRAM_ID, code: 'EXEC_CLUB', name: 'Executive Club', kind: 'AIRLINE',
  airlineId: 7, allianceCode: 'ONEWORLD', tiers,
})

/** What the API does with a written tier by default: stores it, as the program would then show it. */
const defaultWrite = (req: SentRequest) => {
  const body = req.data as Omit<Tier, 'id'>
  if (req.method === 'POST') {
    tiers = [...tiers, { ...body, id: 99, allianceCode: body.allianceCode ?? null, allianceTierCode: body.allianceTierCode ?? null }]
    return { id: 99 }
  }
  const tierId = Number(req.url.split('/').pop())
  if (req.method === 'PUT') {
    tiers = tiers.map(t => (t.id === tierId ? { ...t, ...body } : t))
    return undefined
  }
  tiers = tiers.filter(t => t.id !== tierId)
  return undefined
}

function install() {
  ;({ sent } = installFakeApi(req => {
    // A copy per call, as a real response is: React Query holds the object it was given, and
    // handing back that same reference after a write looks to it like nothing changed.
    if (req.method === 'GET' && req.url === '/admin/loyalty/programs') return pagedResult([{ ...program() }], req.params)
    if (req.url.startsWith(`/admin/loyalty/programs/${PROGRAM_ID}/tiers`)) return writeAnswer(req)
    throw httpError(404)
  }))
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ProgramTiersSection programId={PROGRAM_ID} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const tierTable = () => screen.getByRole('table', { name: /tiers/i })
const tierRows = () => within(tierTable()).getAllByRole('row').slice(1)
const rowFor = (code: string) => tierRows().find(r => within(r).queryByText(code)) as HTMLElement
const writes = () => sent.filter(r => r.method !== 'GET')

beforeEach(() => {
  tiers = makeTiers()
  writeAnswer = defaultWrite
  install()
})

describe('ProgramTiersSection', () => {
  it('lists the program\'s tiers lowest rank first', async () => {
    renderSection()

    await screen.findByRole('table', { name: /tiers/i })
    expect(tierRows().map(r => within(r).getAllByRole('cell')[1].textContent)).toEqual(['BLUE', 'SILVER', 'GOLD'])
  })

  it('shows a tier\'s rank, name and alliance codes', async () => {
    renderSection()

    const gold = await waitFor(() => rowFor('GOLD'))
    const cells = within(gold).getAllByRole('cell').map(c => c.textContent)
    expect(cells.slice(0, 4)).toEqual(['3', 'GOLD', 'Gold', 'OW / EMD'])
  })

  it('says so when the program has no tiers, rather than showing an empty table', async () => {
    tiers = []
    renderSection()

    expect(await screen.findByText(/no tiers/i)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /tiers/i })).not.toBeInTheDocument()
  })

  it('adds a tier through the program that owns it', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('table', { name: /tiers/i })

    await user.click(screen.getByRole('button', { name: /add tier/i }))
    await user.type(screen.getByLabelText(/^code/i), 'BRONZE')
    await user.type(screen.getByLabelText(/^name/i), 'Bronze')
    await user.clear(screen.getByLabelText(/^rank/i))
    await user.type(screen.getByLabelText(/^rank/i), '4')
    await user.click(screen.getByRole('button', { name: /save tier/i }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: `/admin/loyalty/programs/${PROGRAM_ID}/tiers`,
      data: { code: 'BRONZE', name: 'Bronze', rank: 4 },
    })
    // The dialog closes and the list refetches, so the new tier is on screen without a reload.
    await waitFor(() => expect(rowFor('BRONZE')).toBeTruthy())
  })

  it('opens the edit dialog filled in, and saves to that tier', async () => {
    const user = userEvent.setup()
    renderSection()
    await waitFor(() => rowFor('GOLD'))

    await user.click(within(rowFor('GOLD')).getByRole('button', { name: /edit tier/i }))

    expect(screen.getByLabelText(/^code/i)).toHaveValue('GOLD')
    expect(screen.getByLabelText(/^name/i)).toHaveValue('Gold')
    expect(screen.getByLabelText(/^rank/i)).toHaveValue(3)
    expect(screen.getByLabelText(/alliance code/i)).toHaveValue('OW')

    await user.clear(screen.getByLabelText(/^name/i))
    await user.type(screen.getByLabelText(/^name/i), 'Gold Elite')
    await user.click(screen.getByRole('button', { name: /save tier/i }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      method: 'PUT',
      url: `/admin/loyalty/programs/${PROGRAM_ID}/tiers/2`,
      data: { code: 'GOLD', name: 'Gold Elite', rank: 3 },
    })
  })

  it('deletes a tier once the confirm is accepted, and says what it costs the travelers on it', async () => {
    const user = userEvent.setup()
    renderSection()
    await waitFor(() => rowFor('GOLD'))

    await user.click(within(rowFor('GOLD')).getByRole('button', { name: /delete tier/i }))

    // The API sets a membership's TierId to null rather than refusing, so the confirm has to say
    // that the travelers on the tier keep their membership and lose the tier.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/keep their membership/i)
    expect(dialog).toHaveTextContent(/Gold/)

    await user.click(within(dialog).getByRole('button', { name: /^delete tier$/i }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: `/admin/loyalty/programs/${PROGRAM_ID}/tiers/2` })
    await waitFor(() => expect(rowFor('GOLD')).toBeUndefined())
  })

  it('deletes nothing when the confirm is dismissed', async () => {
    const user = userEvent.setup()
    renderSection()
    await waitFor(() => rowFor('GOLD'))

    await user.click(within(rowFor('GOLD')).getByRole('button', { name: /delete tier/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }))

    expect(writes()).toHaveLength(0)
    expect(rowFor('GOLD')).toBeTruthy()
  })

  /**
   * A duplicate code or rank is a 409 the API raises deliberately, because loyalty_tiers is unique
   * on both per program. Swallowing it would leave the admin staring at a dialog that did nothing.
   */
  it('shows the API\'s refusal when a tier clashes, and keeps the dialog open', async () => {
    const user = userEvent.setup()
    writeAnswer = () => { throw httpError(409, { title: 'Conflict', detail: 'Loyalty program 3 already has a tier with code GOLD.' }) }
    renderSection()
    await screen.findByRole('table', { name: /tiers/i })

    await user.click(screen.getByRole('button', { name: /add tier/i }))
    await user.type(screen.getByLabelText(/^code/i), 'GOLD')
    await user.type(screen.getByLabelText(/^name/i), 'Gold again')
    await user.clear(screen.getByLabelText(/^rank/i))
    await user.type(screen.getByLabelText(/^rank/i), '9')
    await user.click(screen.getByRole('button', { name: /save tier/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already has a tier with code GOLD/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('will not submit a tier with no code or name', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByRole('table', { name: /tiers/i })

    await user.click(screen.getByRole('button', { name: /add tier/i }))
    await user.click(screen.getByRole('button', { name: /save tier/i }))

    expect(await screen.findAllByText('Required')).toHaveLength(2)
    expect(writes()).toHaveLength(0)
  })
})
