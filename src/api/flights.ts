import { apiClient } from './client'
import type { AdminFlight } from '@/types'

export const flightsApi = {
  getAll: () => apiClient.get<AdminFlight[]>('/admin/flights').then(r => r.data),
  getById: (id: number) => apiClient.get<AdminFlight>(`/admin/flights/${id}`).then(r => r.data),
  delete: (id: number) => apiClient.delete(`/admin/flights/${id}`),
  sync: (id: number) => apiClient.post(`/admin/flights/${id}/sync`).then(r => r.data),
}
