import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { TravelersPage } from './TravelersPage'

// List, paging and delete are covered in pagedListPages.test.
vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like AdminTravelerDto.
const TRAVELERS = [
  { id: '00000000-0000-0000-0000-000000000001', email: 'one@example.com', displayName: 'One', createdUtc: '2026-01-01T00:00:00Z' },
]

describe('TravelersPage', () => {
  beforeEach(() => {
    installFakeApi(req => {
      if (req.method === 'GET' && req.url === '/admin/travelers') return pagedResult(TRAVELERS, req.params)
      throw httpError(404)
    })
  })

  it('offers only delete on a row, with no link to a traveler page the panel does not have', async () => {
    renderWithProviders(<TravelersPage />)
    const tableRow = (await screen.findByText('one@example.com')).closest('tr')!

    expect(within(tableRow).getAllByRole('button')).toHaveLength(1)
  })
})
