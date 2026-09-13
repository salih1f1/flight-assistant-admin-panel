import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { CountriesPage } from './CountriesPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like CountryAdminDto. GET /admin/refdata/countries returns a plain
// array, not a PagedResult.
const COUNTRIES = [
  { code: 'DE', name: 'Germany', alpha3: 'DEU', numericCode: 276, region: 'Europe', subregion: 'Western Europe', isEU: true, isSchengen: true, isEEA: true },
  { code: 'GB', name: 'United Kingdom', alpha3: 'GBR', numericCode: 826, region: 'Europe', subregion: 'Northern Europe', isEU: false, isSchengen: false, isEEA: false },
]

let sent: SentRequest[]

describe('CountriesPage', () => {
  beforeEach(() => {
    // Only the route the API really maps answers; anything else is a 404, as on the server.
    ;({ sent } = installFakeApi(req => {
      if (req.method === 'GET' && req.url === '/admin/refdata/countries') return COUNTRIES
      throw httpError(404)
    }))
  })

  it('lists the countries from /admin/refdata/countries', async () => {
    renderWithProviders(<CountriesPage />)

    expect(await screen.findByText('Germany')).toBeInTheDocument()
    expect(screen.getByText('United Kingdom')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: '/admin/refdata/countries' }))
  })

  it("shows each country's memberships", async () => {
    renderWithProviders(<CountriesPage />)

    const germany = (await screen.findByText('Germany')).closest('tr')!
    expect(germany).toHaveTextContent('EUSchengenEEA')
    expect(screen.getByText('United Kingdom').closest('tr')).not.toHaveTextContent(/EU|Schengen|EEA/)
  })

  it('shows why the list failed to load instead of "No results."', async () => {
    installFakeApi(() => {
      throw httpError(500)
    })
    renderWithProviders(<CountriesPage />)

    expect(await screen.findByText('Could not load: Request failed with status code 500')).toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })
})
