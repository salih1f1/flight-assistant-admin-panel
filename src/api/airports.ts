import { apiClient } from './client'
import type { Airport, CreateAirportRequest } from '@/types'

export const airportsApi = {
  getAll: () => apiClient.get<Airport[]>('/admin/airports').then(r => r.data),
  getById: (id: number) => apiClient.get<Airport>(`/admin/airports/${id}`).then(r => r.data),
  create: (data: CreateAirportRequest) => apiClient.post<{ id: number }>('/admin/airports', data).then(r => r.data),
  update: (id: number, data: CreateAirportRequest) => apiClient.put(`/admin/airports/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/airports/${id}`),
}
