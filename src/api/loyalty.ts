import { apiClient } from './client'
import type { LoyaltyProgram, LoyaltyProgramKind, CreateLoyaltyProgramRequest, PagedResult } from '@/types'

// The API's upper bound on PageSize (PagedRequestValidator).
const MAX_PAGE_SIZE = 200

// Rows from the admin data browser are keyed by the entity's PascalCase property names.
type KindRow = { Id: number; Code: string; Name: string }

const list = (page: number, pageSize: number) =>
  apiClient
    .get<PagedResult<LoyaltyProgram>>('/admin/loyalty/programs', { params: { Page: page, PageSize: pageSize } })
    .then(r => r.data)

export const loyaltyApi = {
  list,
  // There is no GET /admin/loyalty/programs/{id}, so walk the list at the largest
  // page size the API allows until the program turns up or the list runs out.
  findById: async (id: number): Promise<LoyaltyProgram | null> => {
    for (let page = 1; ; page++) {
      const result = await list(page, MAX_PAGE_SIZE)
      const match = result.items.find(p => p.id === id)
      if (match) return match
      if (page * MAX_PAGE_SIZE >= result.total) return null
    }
  },
  // Programs carry their kind only as a code, but saving one needs the kind's id.
  // The admin data browser is the only endpoint that exposes kind ids.
  listKinds: async (): Promise<LoyaltyProgramKind[]> => {
    const kinds: LoyaltyProgramKind[] = []
    for (let page = 1; ; page++) {
      const { data } = await apiClient.get<PagedResult<KindRow>>('/admin/data/loyalty-program-kinds', {
        params: { Page: page, PageSize: MAX_PAGE_SIZE },
      })
      kinds.push(...data.items.map(r => ({ id: r.Id, code: r.Code, name: r.Name })))
      if (page * MAX_PAGE_SIZE >= data.total) return kinds
    }
  },
  create: (data: CreateLoyaltyProgramRequest) => apiClient.post<{ id: number }>('/admin/loyalty/programs', data).then(r => r.data),
  update: (id: number, data: CreateLoyaltyProgramRequest) => apiClient.put(`/admin/loyalty/programs/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/loyalty/programs/${id}`),
}
