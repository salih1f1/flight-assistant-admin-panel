import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { AllianceDetailPage } from './AllianceDetailPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const oneworld = {
  id: 3,
  code: 'OW',
  name: 'oneworld',
  airlines: [
    { id: 11, iata: 'AA', icao: 'AAL', name: 'American Airlines', countryCode: 'US' },
    { id: 12, iata: 'BA', icao: 'BAW', name: 'British Airways', countryCode: 'GB' },
  ],
}

const skyteam = { id: 4, code: 'ST', name: 'SkyTeam', airlines: [] }

function alliancesApi(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/alliances/3/detail') return oneworld
  if (req.method === 'GET' && req.url === '/admin/alliances/4/detail') return skyteam
  throw httpError(404)
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/alliances/:id', element: <AllianceDetailPage /> }],
    { initialEntries: [path] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('AllianceDetailPage', () => {
  beforeEach(() => {
    installFakeApi(alliancesApi)
  })

  it('names the alliance and its code', async () => {
    renderAt('/alliances/3')

    expect(await screen.findByText('oneworld')).toBeInTheDocument()
    expect(screen.getByText('OW')).toBeInTheDocument()
  })

  it('lists every airline in the alliance, in the order the API returned them', async () => {
    renderAt('/alliances/3')

    await screen.findByText('American Airlines')
    const names = screen.getAllByTestId('alliance-airline-name').map(n => n.textContent)
    expect(names).toEqual(['American Airlines', 'British Airways'])
  })

  it('shows each airline\'s codes and country', async () => {
    renderAt('/alliances/3')

    const row = (await screen.findByText('British Airways')).closest('tr')!
    expect(row).toHaveTextContent('BA')
    expect(row).toHaveTextContent('BAW')
    expect(row).toHaveTextContent('GB')
  })

  it('links each airline to its own record', async () => {
    renderAt('/alliances/3')

    const link = await screen.findByRole('link', { name: 'British Airways' })
    expect(link).toHaveAttribute('href', '/data/airlines/12')
  })

  it('says how many airlines are in the alliance', async () => {
    renderAt('/alliances/3')

    expect(await screen.findByText(/2 airlines/i)).toBeInTheDocument()
  })

  /**
   * An alliance nobody belongs to is a 200 with an empty list, not an error — the page has to
   * say so rather than render an empty table or an error state.
   */
  it('an alliance with no airlines says so instead of showing an empty table', async () => {
    renderAt('/alliances/4')

    expect(await screen.findByText(/no airlines/i)).toBeInTheDocument()
    expect(screen.queryByTestId('alliance-airline-name')).not.toBeInTheDocument()
  })

  /**
   * This page takes alliances out of the generic record view, which is where the raw columns and
   * the verify toggle live — so without this link, verifying an alliance is no longer reachable
   * in one click.
   */
  it('links back to the raw record, where verifying lives', async () => {
    renderAt('/alliances/3')

    const link = await screen.findByRole('link', { name: /raw record/i })
    expect(link).toHaveAttribute('href', '/data/alliances/3')
  })

  it('reports a failed load instead of rendering an empty page', async () => {
    renderAt('/alliances/999')

    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument())
  })
})
