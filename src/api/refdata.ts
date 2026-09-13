import { apiClient } from './client'
import type { Country, Alliance } from '@/types'

// Both live under /admin/refdata (AdminRefDataEndpoints), not directly under /admin,
// and return plain arrays rather than a PagedResult.
export const refDataApi = {
  getCountries: () => apiClient.get<Country[]>('/admin/refdata/countries').then(r => r.data),
  getAlliances: () => apiClient.get<Alliance[]>('/admin/refdata/alliances').then(r => r.data),
}
