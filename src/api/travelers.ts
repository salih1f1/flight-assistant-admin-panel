import { apiClient } from './client'
import type { AdminTraveler } from '@/types'

export const travelersApi = {
  getAll: () => apiClient.get<AdminTraveler[]>('/admin/travelers').then(r => r.data),
  getById: (id: string) => apiClient.get<AdminTraveler>(`/admin/travelers/${id}`).then(r => r.data),
  delete: (id: string) => apiClient.delete(`/admin/travelers/${id}`),
}
