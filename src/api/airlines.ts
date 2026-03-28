import { apiClient } from './client'
import type { Airline, CreateAirlineRequest } from '@/types'

export const airlinesApi = {
  getAll: () => apiClient.get<Airline[]>('/admin/airlines').then(r => r.data),
  getById: (id: number) => apiClient.get<Airline>(`/admin/airlines/${id}`).then(r => r.data),
  create: (data: CreateAirlineRequest) => apiClient.post<{ id: number }>('/admin/airlines', data).then(r => r.data),
  update: (id: number, data: CreateAirlineRequest) => apiClient.put(`/admin/airlines/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/airlines/${id}`),
}
