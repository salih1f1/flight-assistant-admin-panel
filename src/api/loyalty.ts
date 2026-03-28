import { apiClient } from './client'
import type { LoyaltyProgram, CreateLoyaltyProgramRequest } from '@/types'

export const loyaltyApi = {
  getAll: () => apiClient.get<LoyaltyProgram[]>('/admin/loyalty/programs').then(r => r.data),
  create: (data: CreateLoyaltyProgramRequest) => apiClient.post<{ id: number }>('/admin/loyalty/programs', data).then(r => r.data),
  update: (id: number, data: CreateLoyaltyProgramRequest) => apiClient.put(`/admin/loyalty/programs/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/loyalty/programs/${id}`),
}
