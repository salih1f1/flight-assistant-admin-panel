import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { LoungeFormPage } from './LoungeFormPage'
import { LoungesPage } from './LoungesPage'

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), request: vi.fn() },
}))

// Shaped like AdminLoungeDto. The API calls this field locationHint; there is no accessInfo.
type LoungeRow = {
  id: number; airportId: number; name: string; terminal: string | null; locationHint: string | null
  hours: string | null; isAirside: boolean; isDomesticOnly: boolean; isInternationalOnly: boolean; amenities: string | null
}

let lounges: LoungeRow[]
let sent: SentRequest[]

/** An in-memory /admin/lounges: list, get, create and update change what later reads return. */
function loungesApi(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/lounges') return pagedResult(lounges, req.params)
  if (req.method === 'POST' && req.url === '/admin/lounges') {
    const id = 100 + lounges.length
    lounges = [...lounges, { id, ...(req.data as Omit<LoungeRow, 'id'>) }]
    return { id }
  }
  const byId = req.url.match(/^\/admin\/lounges\/(\d+)$/)
  if (byId) {
    const id = Number(byId[1])
    const lounge = lounges.find(l => l.id === id)
    if (!lounge) throw httpError(404)
    if (req.method === 'GET') return lounge
    if (req.method === 'PUT') {
      lounges = lounges.map(l => (l.id === id ? { ...l, ...(req.data as Partial<LoungeRow>) } : l))
      return undefined
    }
  }
  throw httpError(404)
}

/** The lounge routes; staleTime Infinity, so a list only shows a change a mutation invalidated. */
function renderRoutes(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: '/lounges', element: <LoungesPage /> },
      { path: '/lounges/new', element: <LoungeFormPage /> },
      { path: '/lounges/:id/edit', element: <LoungeFormPage /> },
    ],
    { initialEntries: [initialEntry] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe('LoungeFormPage', () => {
  beforeEach(() => {
    lounges = [{
      id: 12,
      airportId: 5,
      name: 'Galleries First',
      terminal: '5',
      locationHint: 'After security, near gate A10',
      hours: '05:00–22:00',
      isAirside: true,
      isDomesticOnly: false,
      isInternationalOnly: true,
      amenities: 'Showers',
    }]
    ;({ sent } = installFakeApi(loungesApi))
  })

  it("fills Location hint from the lounge's locationHint", async () => {
    renderRoutes('/lounges/12/edit')

    expect(await screen.findByLabelText('Location hint')).toHaveValue('After security, near gate A10')
  })

  it('saving an edit sends locationHint, not accessInfo', async () => {
    const user = userEvent.setup()
    renderRoutes('/lounges/12/edit')
    const hint = await screen.findByLabelText('Location hint')
    await waitFor(() => expect(hint).toHaveValue('After security, near gate A10'))

    await user.clear(hint)
    await user.type(hint, 'Upstairs, gate B3')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(sent).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          url: '/admin/lounges/12',
          data: expect.objectContaining({ name: 'Galleries First', locationHint: 'Upstairs, gate B3' }),
        }),
      ),
    )
    expect(sent.find(r => r.method === 'PUT')!.data).not.toHaveProperty('accessInfo')
  })

  it('creating a lounge sends locationHint', async () => {
    const user = userEvent.setup()
    renderRoutes('/lounges/new')

    await user.type(await screen.findByLabelText('Airport ID'), '5')
    await user.type(screen.getByLabelText('Name'), 'New Lounge')
    await user.type(screen.getByLabelText('Location hint'), 'Level 2')
    await user.click(screen.getByRole('button', { name: 'Create lounge' }))

    await waitFor(() =>
      expect(sent).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          url: '/admin/lounges',
          data: expect.objectContaining({ airportId: 5, name: 'New Lounge', locationHint: 'Level 2' }),
        }),
      ),
    )
  })

  it('after saving, the lounge list shows the change without a reload', async () => {
    const user = userEvent.setup()
    const router = renderRoutes('/lounges')
    await screen.findByText('Galleries First')

    await act(async () => {
      await router.navigate('/lounges/12/edit')
    })
    const name = await screen.findByLabelText('Name')
    await waitFor(() => expect(name).toHaveValue('Galleries First'))
    await user.clear(name)
    await user.type(name, 'Concorde Room')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The form navigates back to /lounges on success.
    expect(await screen.findByText('Concorde Room')).toBeInTheDocument()
    expect(screen.queryByText('Galleries First')).not.toBeInTheDocument()
  })
})
