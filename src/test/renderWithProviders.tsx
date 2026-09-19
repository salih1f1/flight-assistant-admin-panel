import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { createQueryClient } from '@/api/queryClient'

/**
 * The app's QueryClient, minus retries: a test asserting an error state shouldn't wait out a
 * retry first. Everything else is what runs in the browser — including the refetch every
 * successful write triggers, which is what keeps a view current (#180).
 */
export function createTestQueryClient() {
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return queryClient
}

/** Renders with a fresh, non-retrying QueryClient and an in-memory router. */
export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}
