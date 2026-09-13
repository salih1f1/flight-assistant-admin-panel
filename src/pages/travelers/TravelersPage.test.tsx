import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult } from '@/test/fakeApi'
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

  it("the view button opens the traveler's page", async () => {
    const router = createMemoryRouter(
      [
        { path: '/travelers', element: <TravelersPage /> },
        { path: '/travelers/:id', element: <p>traveler page</p> },
      ],
      { initialEntries: ['/travelers'] },
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    const tableRow = (await screen.findByText('one@example.com')).closest('tr')!

    await user.click(within(tableRow).getByRole('button', { name: 'View traveler' }))

    expect(await screen.findByText('traveler page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/travelers/00000000-0000-0000-0000-000000000001')
  })
})
