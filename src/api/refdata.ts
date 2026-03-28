import { apiClient } from './client'
import type { Country, Alliance } from '@/types'

export const refDataApi = {
  getCountries: () => apiClient.get<Country[]>('/admin/countries').then(r => r.data),
  getAlliances: () => apiClient.get<Alliance[]>('/admin/alliances').then(r => r.data),
}
