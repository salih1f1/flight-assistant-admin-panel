import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { APPEAR_DELAY_MS } from './LoadingBar'

vi.mock('@/auth/useAdminAuth', () => ({
  useAdminAuth: () => ({ logout: vi.fn(), account: { username: 'admin@example.com' } }),
}))

/** A page whose request never answers, so the layout is caught mid-load. */
function SlowPage() {
  useQuery({ queryKey: ['slow'], queryFn: () => new Promise(() => {}) })
  return <p>Page</p>
}

describe('AppLayout', () => {
  it('carries the loading bar, so every page it holds says when it is waiting on the API', async () => {
    const router = createMemoryRouter(
      [{ element: <AppLayout />, children: [{ path: '/', element: <SlowPage /> }] }],
      { initialEntries: ['/'] },
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await act(() => new Promise(resolve => setTimeout(resolve, APPEAR_DELAY_MS * 3)))

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()
  })
})
