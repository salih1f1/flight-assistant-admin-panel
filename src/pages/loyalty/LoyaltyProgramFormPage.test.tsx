import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { fakePagedGet } from '@/test/fakePagedGet'
import { renderWithProviders } from '@/test/renderWithProviders'
import { LoyaltyProgramFormPage } from './LoyaltyProgramFormPage'

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))

// Shaped like GET /admin/data/loyalty-program-kinds: rows keyed by the entity's
// PascalCase property names. Kind 1 is deliberately not the kind under test, so
// a form that falls back to kindId 1 cannot pass by accident.
const KINDS = [
  { Id: 1, Code: 'AIRLINE', Name: 'Airline', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null },
  { Id: 2, Code: 'ALLIANCE', Name: 'Alliance', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null },
  { Id: 3, Code: 'HOTEL', Name: 'Hotel', Description: null, IsVerified: true, VerifiedAt: null, VerifiedBy: null },
]

const KIND_OVERRIDES: Record<number, string> = { 3: 'ALLIANCE', 7: 'RETIRED', 250: 'HOTEL' }

// 260 programs puts #250 on the second page even at the API's maximum PageSize
// of 200, so the form has to look past the first page to find it.
const PROGRAMS = Array.from({ length: 260 }, (_, i) => ({
  id: i + 1,
  code: `P${i + 1}`,
  name: `Program ${i + 1}`,
  kind: KIND_OVERRIDES[i + 1] ?? 'AIRLINE',
  airlineId: null,
  allianceCode: null,
  tiers: [],
}))

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/loyalty/new" element={<LoyaltyProgramFormPage />} />
      <Route path="/loyalty/:id/edit" element={<LoyaltyProgramFormPage />} />
    </Routes>,
    { route },
  )
}

describe('LoyaltyProgramFormPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(
      fakePagedGet({ '/admin/loyalty/programs': PROGRAMS, '/admin/data/loyalty-program-kinds': KINDS }),
    )
    vi.mocked(apiClient.put).mockReset().mockResolvedValue({ data: undefined })
    vi.mocked(apiClient.post).mockReset().mockResolvedValue({ data: { id: 999 } })
  })

  it('fills the form with a program on the first page of the list', async () => {
    renderAt('/loyalty/3/edit')

    expect(await screen.findByDisplayValue('Program 3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('P3')).toBeInTheDocument()
  })

  it('fills the form with a program that is not on the first page of the list', async () => {
    renderAt('/loyalty/250/edit')

    expect(await screen.findByDisplayValue('Program 250')).toBeInTheDocument()
    expect(screen.getByDisplayValue('P250')).toBeInTheDocument()
  })

  it("preselects the program's own kind, matched by code", async () => {
    renderAt('/loyalty/3/edit')

    expect(await screen.findByDisplayValue('Alliance (ALLIANCE)')).toBeInTheDocument()
  })

  it("saving an edit sends the program's real kind id, not 1", async () => {
    const user = userEvent.setup()
    renderAt('/loyalty/250/edit')
    await screen.findByDisplayValue('Hotel (HOTEL)')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        '/admin/loyalty/programs/250',
        expect.objectContaining({ code: 'P250', name: 'Program 250', kindId: 3 }),
      ),
    )
  })

  it('creating a program sends the kind the admin picked', async () => {
    const user = userEvent.setup()
    const { container } = renderAt('/loyalty/new')
    await screen.findByRole('option', { name: 'Hotel (HOTEL)' })

    await user.type(screen.getByPlaceholderText('e.g. EXEC_CLUB'), 'NEWPROG')
    await user.type(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'New Program')
    await user.selectOptions(screen.getByLabelText(/Kind/), 'Hotel (HOTEL)')
    await user.click(screen.getByRole('button', { name: 'Create program' }))

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/admin/loyalty/programs',
        expect.objectContaining({ code: 'NEWPROG', name: 'New Program', kindId: 3 }),
      ),
    )
  })

  it("will not save a guessed kind when the program's kind is not in the kinds list", async () => {
    const user = userEvent.setup()
    renderAt('/loyalty/7/edit')
    await screen.findByDisplayValue('Program 7')
    expect(await screen.findByText(/"RETIRED" isn't in the kinds list/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Choose a kind')).toBeInTheDocument()
    expect(apiClient.put).not.toHaveBeenCalled()
  })

  it('saving a program with no airline does not send airlineId 0', async () => {
    const user = userEvent.setup()
    renderAt('/loyalty/250/edit')
    await screen.findByDisplayValue('Hotel (HOTEL)')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1))
    const body = vi.mocked(apiClient.put).mock.calls[0][1] as Record<string, unknown>
    expect(body.airlineId).toBeUndefined()
  })

  it("saving keeps a program's airline", async () => {
    vi.mocked(apiClient.get).mockImplementation(
      fakePagedGet({
        '/admin/loyalty/programs': PROGRAMS.map(p => (p.id === 3 ? { ...p, airlineId: 42 } : p)),
        '/admin/data/loyalty-program-kinds': KINDS,
      }),
    )
    const user = userEvent.setup()
    renderAt('/loyalty/3/edit')
    await screen.findByDisplayValue('Alliance (ALLIANCE)')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/admin/loyalty/programs/3', expect.objectContaining({ airlineId: 42 })),
    )
  })
})
