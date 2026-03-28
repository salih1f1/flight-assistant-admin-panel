import { apiClient } from './client'
import type { AdminLounge, CreateLoungeRequest } from '@/types'

export const loungesApi = {
  getAll: () => apiClient.get<AdminLounge[]>('/admin/lounges').then(r => r.data),
  getById: (id: number) => apiClient.get<AdminLounge>(`/admin/lounges/${id}`).then(r => r.data),
  create: (data: CreateLoungeRequest) => apiClient.post<{ id: number }>('/admin/lounges', data).then(r => r.data),
  update: (id: number, data: Omit<CreateLoungeRequest, 'airportId'>) => apiClient.put(`/admin/lounges/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/lounges/${id}`),
}
