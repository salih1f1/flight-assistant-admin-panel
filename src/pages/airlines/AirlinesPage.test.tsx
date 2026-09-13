import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type { Airline } from '@/types'
import { AirlinesPage } from './AirlinesPage'

// Mocked at the HTTP boundary, not at airlinesApi, so the test runs the real api
// module, hook, page and table against the response shape the API actually sends.
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }))

const AIRLINES: Airline[] = Array.from({ length: 692 }, (_, i) => ({
  id: i + 1,
  iata: null,
  icao: null,
  name: `Airline ${String(i + 1).padStart(3, '0')}`,
  countryCode: 'XX',
  allianceCode: null,
}))

/**
 * Mirrors GET /admin/airlines: PagedResult {items, total, page, pageSize},
 * Page defaults to 1, PageSize to 50, and PageSize outside 1..200 is a 400.
 */
function fakeGet(url: string, config?: { params?: Record<string, unknown> }) {
  if (url !== '/admin/airlines') return Promise.reject(new Error(`unexpected GET ${url}`))
  const page = Number(config?.params?.Page ?? 1)
  const pageSize = Number(config?.params?.PageSize ?? 50)
  if (page < 1 || pageSize < 1 || pageSize > 200) {
    return Promise.reject(Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } }))
  }
  const start = (page - 1) * pageSize
  return Promise.resolve({
    data: { items: AIRLINES.slice(start, start + pageSize), total: AIRLINES.length, page, pageSize },
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AirlinesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AirlinesPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(fakeGet as typeof apiClient.get)
  })

  it('lists the airlines on the first page the API returns', async () => {
    renderPage()

    expect(await screen.findByText('Airline 001')).toBeInTheDocument()
    expect(screen.getByText('Airline 050')).toBeInTheDocument()
    expect(screen.queryByText('Airline 051')).not.toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('shows the position and total from the API, not the number of rows on screen', async () => {
    renderPage()

    expect(await screen.findByText('Page 1 of 14 · 692 total')).toBeInTheDocument()
  })

  it('Next requests page 2 from the API and replaces the rows', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Airline 001')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Airline 051')).toBeInTheDocument()
    expect(screen.queryByText('Airline 001')).not.toBeInTheDocument()
    expect(screen.getByText('Page 2 of 14 · 692 total')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenLastCalledWith('/admin/airlines', { params: { Page: 2, PageSize: 50 } })
  })

  it('reaches the last airline and stops there', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Page 1 of 14 · 692 total')

    for (let page = 2; page <= 14; page++) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
      await screen.findByText(`Page ${page} of 14 · 692 total`)
    }

    expect(await screen.findByText('Airline 692')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
