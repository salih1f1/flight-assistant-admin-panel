import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { AirportFormPage } from './AirportFormPage'
import { AirportsPage } from './AirportsPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like AirportAdminDto.
type AirportRow = {
  id: number; iata: string; icao: string | null; name: string; city: string; countryCode: string
  latitude: number | null; longitude: number | null; elevationFt: number | null
}

let airports: AirportRow[]
let sent: SentRequest[]

/** An in-memory /admin/airports: list, get, create and update change what later reads return. */
function airportsApi(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/airports') return pagedResult(airports, req.params)
  if (req.method === 'POST' && req.url === '/admin/airports') {
    const id = 100 + airports.length
    airports = [...airports, { id, ...(req.data as Omit<AirportRow, 'id'>) }]
    return { id }
  }
  const byId = req.url.match(/^\/admin\/airports\/(\d+)$/)
  if (byId) {
    const id = Number(byId[1])
    const airport = airports.find(a => a.id === id)
    if (!airport) throw httpError(404)
    if (req.method === 'GET') return airport
    if (req.method === 'PUT') {
      airports = airports.map(a => (a.id === id ? { ...a, ...(req.data as Partial<AirportRow>) } : a))
      return undefined
    }
  }
  throw httpError(404)
}

/** The airport routes; staleTime Infinity, so a list only shows a change a mutation invalidated. */
function renderRoutes(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: '/airports', element: <AirportsPage /> },
      { path: '/airports/new', element: <AirportFormPage /> },
      { path: '/airports/:id/edit', element: <AirportFormPage /> },
    ],
    { initialEntries: [initialEntry] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, container: view.container }
}

/** The body of the one PUT the form sent. */
async function savedAirport() {
  await waitFor(() => expect(sent.filter(r => r.method === 'PUT')).toHaveLength(1))
  return sent.find(r => r.method === 'PUT')!.data as Record<string, unknown>
}

describe('AirportFormPage', () => {
  beforeEach(() => {
    airports = [
      { id: 7, iata: 'XXA', icao: null, name: 'No Coordinates', city: 'Nowhere', countryCode: 'GB', latitude: null, longitude: null, elevationFt: null },
      { id: 8, iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', countryCode: 'GB', latitude: 51.47, longitude: -0.4543, elevationFt: 83 },
    ]
    ;({ sent } = installFakeApi(airportsApi))
  })

  it('saving an airport without coordinates does not turn them into 0,0', async () => {
    const user = userEvent.setup()
    renderRoutes('/airports/7/edit')
    await screen.findByDisplayValue('No Coordinates')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const body = await savedAirport()
    expect(sent.find(r => r.method === 'PUT')!.url).toBe('/admin/airports/7')
    expect(body.name).toBe('No Coordinates')
    expect(body.latitude).toBeUndefined()
    expect(body.longitude).toBeUndefined()
    expect(body.elevationFt).toBeUndefined()
  })

  it('saving keeps real coordinates and elevation', async () => {
    const user = userEvent.setup()
    renderRoutes('/airports/8/edit')
    await screen.findByDisplayValue('Heathrow')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await savedAirport()).toEqual(expect.objectContaining({ latitude: 51.47, longitude: -0.4543, elevationFt: 83 }))
  })

  it('an explicit 0 is saved as 0, not dropped', async () => {
    const user = userEvent.setup()
    const { container } = renderRoutes('/airports/7/edit')
    await screen.findByDisplayValue('No Coordinates')

    await user.type(container.querySelector<HTMLInputElement>('input[name="latitude"]')!, '0')
    await user.type(container.querySelector<HTMLInputElement>('input[name="elevationFt"]')!, '0')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const body = await savedAirport()
    expect(body.latitude).toBe(0)
    expect(body.elevationFt).toBe(0)
    expect(body.longitude).toBeUndefined()
  })

  it('after saving, the airport list shows the change without a reload', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes('/airports')
    await screen.findByText('Heathrow')

    await act(async () => {
      await router.navigate('/airports/8/edit')
    })
    const name = await screen.findByDisplayValue('Heathrow')
    await user.clear(name)
    await user.type(name, 'London Heathrow')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The form navigates back to /airports on success.
    expect(await screen.findByText('London Heathrow')).toBeInTheDocument()
    expect(screen.queryByText('Heathrow')).not.toBeInTheDocument()
  })
})
