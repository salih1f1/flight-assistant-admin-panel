import { apiClient } from './client'
import type { AdminLounge, CreateLoungeRequest, PagedResult } from '@/types'

export const loungesApi = {
  list: (page: number, pageSize: number) =>
    apiClient
      .get<PagedResult<AdminLounge>>('/admin/lounges', { params: { Page: page, PageSize: pageSize } })
      .then(r => r.data),
  getById: (id: number) => apiClient.get<AdminLounge>(`/admin/lounges/${id}`).then(r => r.data),
  create: (data: CreateLoungeRequest) => apiClient.post<{ id: number }>('/admin/lounges', data).then(r => r.data),
  update: (id: number, data: Omit<CreateLoungeRequest, 'airportId'>) => apiClient.put(`/admin/lounges/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/lounges/${id}`),
}
