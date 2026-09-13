import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { fakePagedGet } from '@/test/fakePagedGet'
import { renderWithProviders } from '@/test/renderWithProviders'
import { LoyaltyProgramFormPage } from './LoyaltyProgramFormPage'

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))

// 260 programs puts #250 on the second page even at the API's maximum PageSize
// of 200, so the form has to look past the first page to find it.
const PROGRAMS = Array.from({ length: 260 }, (_, i) => ({
  id: i + 1,
  code: `P${i + 1}`,
  name: `Program ${i + 1}`,
  kind: 'Airline',
  airlineId: null,
  allianceCode: null,
  tiers: [],
}))

function renderEdit(id: number) {
  return renderWithProviders(
    <Routes>
      <Route path="/loyalty/:id/edit" element={<LoyaltyProgramFormPage />} />
    </Routes>,
    { route: `/loyalty/${id}/edit` },
  )
}

describe('LoyaltyProgramFormPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(fakePagedGet({ '/admin/loyalty/programs': PROGRAMS }))
  })

  it('fills the form with a program on the first page of the list', async () => {
    renderEdit(3)

    expect(await screen.findByDisplayValue('Program 3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('P3')).toBeInTheDocument()
  })

  it('fills the form with a program that is not on the first page of the list', async () => {
    renderEdit(250)

    expect(await screen.findByDisplayValue('Program 250')).toBeInTheDocument()
    expect(screen.getByDisplayValue('P250')).toBeInTheDocument()
  })
})
