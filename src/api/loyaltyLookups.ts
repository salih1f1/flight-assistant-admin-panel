import { useQuery } from '@tanstack/react-query'
import {
  adminGetBrowsableTableData,
  adminGetLoyaltyPrograms,
  getAdminGetBrowsableTableDataQueryKey,
  getAdminGetLoyaltyProgramsQueryKey,
} from './generated/admin'
import type { LoyaltyProgramDto } from './generated/model'

// The API's upper bound on PageSize (PagedRequestValidator).
const MAX_PAGE_SIZE = 200

export type LoyaltyProgramKind = { id: number; code: string; name: string }

/**
 * There is no GET /admin/loyalty/programs/{id}, so walk the list at the largest
 * page size the API allows until the program turns up or the list runs out.
 */
export async function findLoyaltyProgram(id: number, signal?: AbortSignal): Promise<LoyaltyProgramDto | null> {
  for (let page = 1; ; page++) {
    const result = await adminGetLoyaltyPrograms({ Page: page, PageSize: MAX_PAGE_SIZE }, undefined, signal)
    const match = result.items?.find(p => p.id === id)
    if (match) return match
    if (page * MAX_PAGE_SIZE >= (result.total ?? 0)) return null
  }
}

/**
 * Programs carry their kind only as a code, but saving one needs the kind's id.
 * The admin data browser is the only endpoint that exposes kind ids; its rows
 * are keyed by the entity's PascalCase property names.
 */
export async function listLoyaltyProgramKinds(signal?: AbortSignal): Promise<LoyaltyProgramKind[]> {
  const kinds: LoyaltyProgramKind[] = []
  for (let page = 1; ; page++) {
    const result = await adminGetBrowsableTableData('loyalty-program-kinds', { Page: page, PageSize: MAX_PAGE_SIZE }, undefined, signal)
    kinds.push(...(result.items ?? []).map(row => ({ id: Number(row.Id), code: String(row.Code), name: String(row.Name) })))
    if (page * MAX_PAGE_SIZE >= (result.total ?? 0)) return kinds
  }
}

/**
 * Filed under the generated list key, so invalidating the program list
 * (invalidateLoyaltyPrograms) also refreshes a looked-up program.
 */
export const loyaltyProgramQueryKey = (id: number) => [...getAdminGetLoyaltyProgramsQueryKey(), 'by-id', id] as const

export function useLoyaltyProgram(id: number | undefined) {
  return useQuery({
    queryKey: loyaltyProgramQueryKey(id ?? 0),
    queryFn: ({ signal }) => findLoyaltyProgram(id!, signal),
    enabled: id != null,
  })
}

export function useLoyaltyProgramKinds() {
  return useQuery({
    queryKey: [...getAdminGetBrowsableTableDataQueryKey('loyalty-program-kinds'), 'all'],
    queryFn: ({ signal }) => listLoyaltyProgramKinds(signal),
  })
}
