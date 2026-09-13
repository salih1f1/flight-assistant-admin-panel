import { apiClient } from './client'
import type { AdminFlight, PagedResult } from '@/types'

export const flightsApi = {
  list: (page: number, pageSize: number) =>
    apiClient
      .get<PagedResult<AdminFlight>>('/admin/flights', { params: { Page: page, PageSize: pageSize } })
      .then(r => r.data),
  getById: (id: number) => apiClient.get<AdminFlight>(`/admin/flights/${id}`).then(r => r.data),
  delete: (id: number) => apiClient.delete(`/admin/flights/${id}`),
  sync: (id: number) => apiClient.post(`/admin/flights/${id}/sync`).then(r => r.data),
}
