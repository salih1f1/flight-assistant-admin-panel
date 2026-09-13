import { apiClient } from './client'
import type { Airline, CreateAirlineRequest, PagedResult } from '@/types'

export const airlinesApi = {
  // The API validates PageSize to 1..200 and orders by name.
  list: (page: number, pageSize: number) =>
    apiClient
      .get<PagedResult<Airline>>('/admin/airlines', { params: { Page: page, PageSize: pageSize } })
      .then(r => r.data),
  getById: (id: number) => apiClient.get<Airline>(`/admin/airlines/${id}`).then(r => r.data),
  create: (data: CreateAirlineRequest) => apiClient.post<{ id: number }>('/admin/airlines', data).then(r => r.data),
  update: (id: number, data: CreateAirlineRequest) => apiClient.put(`/admin/airlines/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/airlines/${id}`),
}
