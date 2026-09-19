import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, rawRows, type SentRequest } from '@/test/fakeApi'
import { AirlineFormPage } from './AirlineFormPage'
import { DataBrowserPage } from '@/pages/data/DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

type AirlineRow = { id: number; iata: string | null; icao: string | null; name: string; countryCode: string; allianceCode: string | null }

let airlines: AirlineRow[]
let alliances: { code: string; name: string }[]
let sent: SentRequest[]

/** An in-memory /admin/airlines: list, get, create and update change what later reads return. */
function airlinesApi(req: SentRequest) {
  // The alliance select's options.
  if (req.method === 'GET' && req.url === '/admin/refdata/alliances') return alliances
  // The grid the form returns to: the same records, as GET /admin/data/airlines rows.
  if (req.method === 'GET' && req.url === '/admin/data/tables') return []
  if (req.method === 'GET' && req.url === '/admin/data/airlines') return pagedResult(rawRows(airlines), req.params)
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
      { path: '/data/:table', element: <DataBrowserPage /> },
      { path: '/airlines/new', element: <AirlineFormPage /> },
      { path: '/airlines/:id/edit', element: <AirlineFormPage /> },
    ],
    { initialEntries: [initialEntry] },
  )
  const queryClient = createTestQueryClient()
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
    alliances = [
      { code: 'SA', name: 'Star Alliance' },
      { code: 'OW', name: 'oneworld' },
      { code: 'ST', name: 'SkyTeam' },
    ]
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
    const router = renderRoutes('/data/airlines')
    await screen.findByText('British Airways')

    await act(async () => {
      await router.navigate('/airlines/5/edit')
    })
    const name = await screen.findByDisplayValue('British Airways')
    await user.clear(name)
    await user.type(name, 'BA Euroflyer')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The form navigates back to the /data/airlines grid on success.
    expect(await screen.findByText('BA Euroflyer')).toBeInTheDocument()
    expect(screen.queryByText('British Airways')).not.toBeInTheDocument()
  })

  describe('the alliance select (#96)', () => {
    it('offers every alliance the API lists, plus no alliance at all', async () => {
      renderRoutes('/airlines/new')
      const select = await screen.findByLabelText('Alliance')
      // The select renders before the list arrives, so wait for the API's options to appear.
      await screen.findByRole('option', { name: 'Star Alliance (SA)' })

      const options = within(select).getAllByRole('option').map(o => o.textContent)

      expect(options).toEqual(['No alliance', 'Star Alliance (SA)', 'oneworld (OW)', 'SkyTeam (ST)'])
    })

    it('is a select, not a free-text box, so an alliance cannot be typed', async () => {
      renderRoutes('/airlines/new')

      expect(await screen.findByLabelText('Alliance')).toHaveProperty('tagName', 'SELECT')
    })

    it("starts on the airline's stored alliance when editing", async () => {
      renderRoutes('/airlines/5/edit')

      await waitFor(() => expect(screen.getByLabelText('Alliance')).toHaveValue('OW'))
    })

    it('PUTs the alliance the admin picked', async () => {
      const user = userEvent.setup()
      renderRoutes('/airlines/5/edit')
      await waitFor(() => expect(screen.getByLabelText('Alliance')).toHaveValue('OW'))

      await user.selectOptions(screen.getByLabelText('Alliance'), 'SA')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() =>
        expect(sent).toContainEqual(
          expect.objectContaining({
            method: 'PUT',
            url: '/admin/airlines/5',
            data: expect.objectContaining({ allianceCode: 'SA' }),
          }),
        ),
      )
    })

    it('leaves allianceCode unset when "No alliance" is chosen', async () => {
      const user = userEvent.setup()
      renderRoutes('/airlines/5/edit')
      await waitFor(() => expect(screen.getByLabelText('Alliance')).toHaveValue('OW'))

      await user.selectOptions(screen.getByLabelText('Alliance'), '')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(sent.some(r => r.method === 'PUT')).toBe(true))
      const put = sent.find(r => r.method === 'PUT')!
      expect((put.data as Record<string, unknown>).allianceCode).toBeUndefined()
    })

    it('says so rather than showing an empty select when the alliance list fails', async () => {
      ;({ sent } = installFakeApi(req => {
        if (req.method === 'GET' && req.url === '/admin/refdata/alliances') throw httpError(503)
        return airlinesApi(req)
      }))
      renderRoutes('/airlines/new')

      expect(await screen.findByText(/could not load alliances/i)).toBeInTheDocument()
    })

    /**
     * A select that silently omitted an unknown stored code would blank that airline's alliance
     * the moment an admin saved an unrelated field, which is a worse failure than the one #96 fixes.
     */
    it("keeps an airline's alliance code that the API no longer lists, and warns about it", async () => {
      airlines = [{ id: 7, iata: 'LH', icao: 'DLH', name: 'Lufthansa', countryCode: 'DE', allianceCode: 'LEGACY' }]
      renderRoutes('/airlines/7/edit')

      await waitFor(() => expect(screen.getByLabelText('Alliance')).toHaveValue('LEGACY'))
      expect(screen.getByText(/isn't in the alliances list/i)).toBeInTheDocument()
    })

    /**
     * A failed list is "we don't know what the alliances are", not "this airline has none". The
     * select must still hold the stored code, or saving an unrelated field would clear it — and
     * it must not claim the code is unlisted, which a failed load is no evidence of.
     */
    it("keeps the airline's alliance when the list can't be loaded, without calling it unlisted", async () => {
      const user = userEvent.setup()
      ;({ sent } = installFakeApi(req => {
        if (req.method === 'GET' && req.url === '/admin/refdata/alliances') throw httpError(503)
        return airlinesApi(req)
      }))
      renderRoutes('/airlines/5/edit')

      await waitFor(() => expect(screen.getByLabelText('Alliance')).toHaveValue('OW'))
      expect(screen.queryByText(/isn't in the alliances list/i)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() =>
        expect(sent).toContainEqual(
          expect.objectContaining({
            method: 'PUT',
            url: '/admin/airlines/5',
            data: expect.objectContaining({ allianceCode: 'OW' }),
          }),
        ),
      )
    })
  })
})
