import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { fakePagedGet } from '@/test/fakePagedGet'
import { renderWithProviders } from '@/test/renderWithProviders'
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

describe('AirlinesPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(fakePagedGet({ '/admin/airlines': AIRLINES }))
  })

  it('lists the airlines on the first page the API returns', async () => {
    renderWithProviders(<AirlinesPage />)

    expect(await screen.findByText('Airline 001')).toBeInTheDocument()
    expect(screen.getByText('Airline 050')).toBeInTheDocument()
    expect(screen.queryByText('Airline 051')).not.toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('shows the position and total from the API, not the number of rows on screen', async () => {
    renderWithProviders(<AirlinesPage />)

    expect(await screen.findByText('Page 1 of 14 · 692 total')).toBeInTheDocument()
  })

  it('shows why the list failed to load instead of "No results."', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Request failed with status code 500'))
    renderWithProviders(<AirlinesPage />)

    expect(await screen.findByText('Could not load: Request failed with status code 500')).toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('Next requests page 2 from the API and replaces the rows', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AirlinesPage />)
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
    renderWithProviders(<AirlinesPage />)
    await screen.findByText('Page 1 of 14 · 692 total')

    for (let page = 2; page <= 14; page++) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
      await screen.findByText(`Page ${page} of 14 · 692 total`)
    }

    expect(await screen.findByText('Airline 692')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
