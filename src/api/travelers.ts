import { apiClient } from './client'
import type { AdminTraveler, PagedResult } from '@/types'

export const travelersApi = {
  list: (page: number, pageSize: number) =>
    apiClient
      .get<PagedResult<AdminTraveler>>('/admin/travelers', { params: { Page: page, PageSize: pageSize } })
      .then(r => r.data),
  getById: (id: string) => apiClient.get<AdminTraveler>(`/admin/travelers/${id}`).then(r => r.data),
  delete: (id: string) => apiClient.delete(`/admin/travelers/${id}`),
}
