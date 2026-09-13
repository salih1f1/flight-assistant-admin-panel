import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { AirlineFormPage } from './AirlineFormPage'
import { AirlinesPage } from './AirlinesPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

type AirlineRow = { id: number; iata: string | null; icao: string | null; name: string; countryCode: string; allianceCode: string | null }

let airlines: AirlineRow[]
let sent: SentRequest[]

/** An in-memory /admin/airlines: list, get, create and update change what later reads return. */
function airlinesApi(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/airlines') return pagedResult(airlines, req.params)
  if (req.method === 'POST' && req.url === '/admin/airlines') {
    const id = 100 + airlines.length
    airlines = [...airlines, { id, ...(req.data as Omit<AirlineRow, 'id'>) }]
    return { id }
  }
  const byId = req.url.match(/^\/admin\/airlines\/(\d+)$/)
  if (byId) {
    const id = Number(byId[1])
    const airline = airlines.find(a => a.id === id)
    if (!airline) throw httpError(404)
    if (req.method === 'GET') return airline
    if (req.method === 'PUT') {
      airlines = airlines.map(a => (a.id === id ? { ...a, ...(req.data as Partial<AirlineRow>) } : a))
      return undefined
    }
  }
  throw httpError(404)
}

/**
 * The airline routes in a memory router. staleTime is Infinity, like the app's long
 * staleTime, so a list only shows a change if a mutation invalidated it.
 */
function renderRoutes(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: '/airlines', element: <AirlinesPage /> },
      { path: '/airlines/new', element: <AirlineFormPage /> },
      { path: '/airlines/:id/edit', element: <AirlineFormPage /> },
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

describe('AirlineFormPage', () => {
  beforeEach(() => {
    airlines = [{ id: 5, iata: 'BA', icao: 'BAW', name: 'British Airways', countryCode: 'GB', allianceCode: 'OW' }]
    ;({ sent } = installFakeApi(airlinesApi))
  })

  it('fills the form from GET /admin/airlines/5', async () => {
    renderRoutes('/airlines/5/edit')

    expect(await screen.findByDisplayValue('British Airways')).toBeInTheDocument()
    expect(screen.getByLabelText('IATA code')).toHaveValue('BA')
    expect(screen.getByLabelText('ICAO code')).toHaveValue('BAW')
    expect(screen.getByLabelText(/^Country code/)).toHaveValue('GB')
    expect(screen.getByLabelText('Alliance')).toHaveValue('OW')
  })

  it('saving an edit PUTs the form values to /admin/airlines/5', async () => {
    const user = userEvent.setup()
    renderRoutes('/airlines/5/edit')
    const name = await screen.findByDisplayValue('British Airways')

    await user.clear(name)
    await user.type(name, 'BA Euroflyer')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(sent).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          url: '/admin/airlines/5',
          data: expect.objectContaining({ name: 'BA Euroflyer', countryCode: 'GB', iata: 'BA', icao: 'BAW', allianceCode: 'OW' }),
        }),
      ),
    )
  })

  it('creating POSTs to /admin/airlines and leaves blank codes unset', async () => {
    const user = userEvent.setup()
    renderRoutes('/airlines/new')

    await user.type(await screen.findByLabelText(/^Name/), 'Aer Lingus')
    await user.type(screen.getByLabelText(/^Country code/), 'IE')
    await user.click(screen.getByRole('button', { name: 'Create airline' }))

    await waitFor(() => expect(sent.some(r => r.method === 'POST')).toBe(true))
    const post = sent.find(r => r.method === 'POST')!
    expect(post.url).toBe('/admin/airlines')
    expect(post.data).toEqual(expect.objectContaining({ name: 'Aer Lingus', countryCode: 'IE' }))
    const body = post.data as Record<string, unknown>
    expect(body.iata).toBeUndefined()
    expect(body.icao).toBeUndefined()
    expect(body.allianceCode).toBeUndefined()
  })

  it('after saving, the airline list shows the change without a reload', async () => {
    const user = userEvent.setup()
    const router = renderRoutes('/airlines')
    await screen.findByText('British Airways')

    await act(async () => {
      await router.navigate('/airlines/5/edit')
    })
    const name = await screen.findByDisplayValue('British Airways')
    await user.clear(name)
    await user.type(name, 'BA Euroflyer')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The form navigates back to /airlines on success.
    expect(await screen.findByText('BA Euroflyer')).toBeInTheDocument()
    expect(screen.queryByText('British Airways')).not.toBeInTheDocument()
  })
})
