import { apiClient } from './client'
import type { Airport, CreateAirportRequest, PagedResult } from '@/types'

export const airportsApi = {
  list: (page: number, pageSize: number) =>
    apiClient
      .get<PagedResult<Airport>>('/admin/airports', { params: { Page: page, PageSize: pageSize } })
      .then(r => r.data),
  getById: (id: number) => apiClient.get<Airport>(`/admin/airports/${id}`).then(r => r.data),
  create: (data: CreateAirportRequest) => apiClient.post<{ id: number }>('/admin/airports', data).then(r => r.data),
  update: (id: number, data: CreateAirportRequest) => apiClient.put(`/admin/airports/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/airports/${id}`),
}
