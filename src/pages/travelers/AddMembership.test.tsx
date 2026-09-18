import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { TravelerDetailPage } from './TravelerDetailPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TRAVELER_ID = '3f2b8c1e-9a4d-4e6b-8f10-2c7d5e9a1b01'

// Tiers deliberately out of rank order: the picker is expected to sort them.
const EXECUTIVE_CLUB = {
  id: 3, code: 'EXEC_CLUB', name: 'Executive Club', kind: 'AIRLINE', airlineId: 7, allianceCode: 'ONEWORLD',
  tiers: [
    { id: 2, code: 'GOLD', name: 'Gold', rank: 3, allianceCode: null, allianceTierCode: null },
    { id: 1, code: 'SILVER', name: 'Silver', rank: 2, allianceCode: null, allianceTierCode: null },
  ],
}
const MILES_AND_MORE = {
  id: 4, code: 'MILES', name: 'Miles & More', kind: 'AIRLINE', airlineId: 8, allianceCode: 'STAR',
  tiers: [{ id: 9, code: 'SEN', name: 'Senator', rank: 4, allianceCode: null, allianceTierCode: null }],
}
const PRIORITY_PASS = { id: 5, code: 'PP', name: 'Priority Pass', kind: 'LOUNGE', airlineId: null, allianceCode: null, tiers: [] }

const makeDetail = () => ({
  id: TRAVELER_ID,
  email: '<redacted>',
  displayName: 'Ann Example',
  createdUtc: '2026-01-05T09:30:00Z',
  deviceTokens: [],
  trackedFlights: [],
  trackedFlightsTruncated: false,
  loyaltyMemberships: [] as unknown[],
})

let detail: ReturnType<typeof makeDetail>
let sent: SentRequest[]
let addAnswer: (req: SentRequest) => unknown

/** What the API does with a posted membership by default: stores it, as the detail would then show it. */
const defaultAdd = (req: SentRequest) => {
  const body = req.data as { programId: number; accountNumber: string; tierId?: number | null; tierExpiryDate?: string | null }
  detail.loyaltyMemberships = [...detail.loyaltyMemberships, {
    id: 'c4e9a7b2-1d3f-4b5a-8c6e-9f0a2b4d6e03',
    programId: body.programId,
    accountNumber: body.accountNumber,
    tierId: body.tierId ?? null,
    tierExpiryDate: body.tierExpiryDate ?? null,
  }]
  return { id: 'c4e9a7b2-1d3f-4b5a-8c6e-9f0a2b4d6e03' }
}

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/loyalty/programs') return pagedResult([EXECUTIVE_CLUB, MILES_AND_MORE, PRIORITY_PASS], req.params)
    // A copy per call, as a real response is: React Query holds the object it was given, and
    // handing back that same reference after a write looks to it like nothing changed.
    if (req.method === 'GET' && req.url === `/admin/travelers/${TRAVELER_ID}/detail`) return { ...detail }
    if (req.method === 'POST' && req.url === `/admin/travelers/${TRAVELER_ID}/memberships`) return addAnswer(req)
    throw httpError(404)
  }))
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/travelers/:id', element: <TravelerDetailPage /> }],
    { initialEntries: [`/travelers/${TRAVELER_ID}`] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const memberships = () => screen.getByRole('region', { name: 'Loyalty memberships' })

/** Opens the dialog and waits for the program list to arrive. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Ann Example' })
  await user.click(within(memberships()).getByRole('button', { name: 'Add membership' }))
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /Program/ })).not.toBeDisabled())
  return dialog
}

const optionLabels = (select: HTMLElement) =>
  within(select).getAllByRole('option').map(o => o.textContent)

describe('Adding a loyalty membership to a traveler', () => {
  beforeEach(() => {
    detail = makeDetail()
    addAnswer = defaultAdd
    install()
  })

  it('offers every loyalty program, the airline ones and the rest', async () => {
    const user = userEvent.setup()
    renderPage()

    const dialog = await openDialog(user)

    expect(optionLabels(within(dialog).getByRole('combobox', { name: /Program/ })))
      .toEqual(['Choose a program…', 'Executive Club (EXEC_CLUB)', 'Miles & More (MILES)', 'Priority Pass (PP)'])
  })

  it('narrows the programs to what was typed, by name or by code', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)
    const program = within(dialog).getByRole('combobox', { name: /Program/ })

    await user.type(within(dialog).getByRole('textbox', { name: 'Filter programs' }), 'miles')
    expect(optionLabels(program)).toEqual(['Choose a program…', 'Miles & More (MILES)'])

    await user.clear(within(dialog).getByRole('textbox', { name: 'Filter programs' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Filter programs' }), 'exec_')
    expect(optionLabels(program)).toEqual(['Choose a program…', 'Executive Club (EXEC_CLUB)'])
  })

  it("offers only the chosen program's tiers, lowest rank first", async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    expect(within(dialog).getByRole('combobox', { name: /Tier/ })).toBeDisabled()

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '3')

    const tier = within(dialog).getByRole('combobox', { name: /Tier/ })
    expect(tier).not.toBeDisabled()
    expect(optionLabels(tier)).toEqual(['No tier', 'Silver (SILVER)', 'Gold (GOLD)'])
  })

  it('drops a tier the traveler picked when the program changes under it', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '3')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Tier/ }), '2')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '4')

    const tier = within(dialog).getByRole('combobox', { name: /Tier/ })
    expect(optionLabels(tier)).toEqual(['No tier', 'Senator (SEN)'])
    expect(tier).toHaveValue('')

    // The select alone proves little — the browser drops a selected option that no longer exists,
    // while the form can still be holding the old tier. What's posted is the real question.
    await user.type(within(dialog).getByRole('textbox', { name: /Account number/ }), 'LH-555')
    await user.click(within(dialog).getByRole('button', { name: 'Add membership' }))

    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
      method: 'POST',
      url: `/admin/travelers/${TRAVELER_ID}/memberships`,
      data: { programId: 4, accountNumber: 'LH-555' },
    })))
  })

  it('says a program with no tiers has none, rather than offering an empty list', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '5')

    expect(within(dialog).getByRole('combobox', { name: /Tier/ })).toBeDisabled()
    expect(dialog).toHaveTextContent('Priority Pass has no tiers.')
  })

  it('posts the membership, closes, and shows the new row', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '3')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Tier/ }), '2')
    await user.type(within(dialog).getByRole('textbox', { name: /Account number/ }), 'BA-12345678')
    await user.click(within(dialog).getByRole('button', { name: 'Add membership' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent).toContainEqual(expect.objectContaining({
      method: 'POST',
      url: `/admin/travelers/${TRAVELER_ID}/memberships`,
      data: { programId: 3, tierId: 2, accountNumber: 'BA-12345678' },
    }))
    const row = await within(memberships()).findByRole('row', { name: /BA-12345678/ })
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('Executive Club (EXEC_CLUB)')
    // The row is the refetched traveler, not something the dialog drew from what it posted.
    expect(sent.filter(r => r.method === 'GET' && r.url === `/admin/travelers/${TRAVELER_ID}/detail`).length).toBeGreaterThan(1)
  })

  it('sends the tier expiry date when it is filled in, and leaves it out when it is not', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '3')
    await user.type(within(dialog).getByRole('textbox', { name: /Account number/ }), 'BA-999')
    // Points expiry went with the column it was written to (#154); tier expiry is the only date left.
    expect(within(dialog).queryByLabelText(/Points expiry/)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Tier expiry/), '2027-03-31')
    await user.click(within(dialog).getByRole('button', { name: 'Add membership' }))

    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
      method: 'POST',
      url: `/admin/travelers/${TRAVELER_ID}/memberships`,
      data: { programId: 3, accountNumber: 'BA-999', tierExpiryDate: '2027-03-31' },
    })))
  })

  it('asks for a program and an account number before it posts anything', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('button', { name: 'Add membership' }))

    expect(await within(dialog).findByText('Choose a program')).toBeInTheDocument()
    expect(within(dialog).getByText('Required')).toBeInTheDocument()
    expect(sent.filter(r => r.method === 'POST')).toHaveLength(0)
  })

  /** A program or tier the API doesn't have is a 409 — the dialog stays open with what the API said. */
  it('keeps the dialog open and says why when the API refuses', async () => {
    addAnswer = () => {
      throw httpError(409, { title: 'TravelerLoyaltyMembership ProgramId 3 is not a loyalty program we have; add the program first.' })
    }
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '3')
    await user.type(within(dialog).getByRole('textbox', { name: /Account number/ }), 'BA-12345678')
    await user.click(within(dialog).getByRole('button', { name: 'Add membership' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('is not a loyalty program we have')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Radix hides the page behind an open dialog from the a11y tree, so this asks the table by text.
    expect(screen.queryByRole('cell', { name: 'BA-12345678', hidden: true })).not.toBeInTheDocument()
  })

  it('starts empty again the next time it is opened', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Program/ }), '3')
    await user.type(within(dialog).getByRole('textbox', { name: /Account number/ }), 'BA-12345678')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const reopened = await openDialog(user)
    expect(within(reopened).getByRole('combobox', { name: /Program/ })).toHaveValue('')
    expect(within(reopened).getByRole('textbox', { name: /Account number/ })).toHaveValue('')
  })
})
