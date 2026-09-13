import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { renderWithProviders } from '@/test/renderWithProviders'
import { CountriesPage } from './CountriesPage'

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }))

// Shaped like CountryAdminDto. GET /admin/refdata/countries returns a plain
// array, not a PagedResult.
const COUNTRIES = [
  { code: 'DE', name: 'Germany', alpha3: 'DEU', numericCode: 276, region: 'Europe', subregion: 'Western Europe', isEU: true, isSchengen: true, isEEA: true },
  { code: 'GB', name: 'United Kingdom', alpha3: 'GBR', numericCode: 826, region: 'Europe', subregion: 'Northern Europe', isEU: false, isSchengen: false, isEEA: false },
]

/** Only the route the API really maps answers; anything else is a 404, as on the server. */
function fakeGet(url: string) {
  if (url === '/admin/refdata/countries') return Promise.resolve({ data: COUNTRIES })
  return Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }))
}

describe('CountriesPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(fakeGet as typeof apiClient.get)
  })

  it('lists the countries from /admin/refdata/countries', async () => {
    renderWithProviders(<CountriesPage />)

    expect(await screen.findByText('Germany')).toBeInTheDocument()
    expect(screen.getByText('United Kingdom')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/admin/refdata/countries')
  })

  it('shows why the list failed to load instead of "No results."', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Request failed with status code 500'))
    renderWithProviders(<CountriesPage />)

    expect(await screen.findByText('Could not load: Request failed with status code 500')).toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })
})
