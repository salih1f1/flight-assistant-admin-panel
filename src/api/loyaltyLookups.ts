import { useQuery } from '@tanstack/react-query'
import { adminGetLoyaltyPrograms, getAdminGetLoyaltyProgramsQueryKey } from './generated/admin'
import type { LoyaltyProgramDto } from './generated/model'
import { listRawTable, MAX_PAGE_SIZE, rawTableQueryKey } from './rawTableLookups'

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
  const rows = await listRawTable('loyalty-program-kinds', signal)
  return rows.map(row => ({ id: Number(row.Id), code: String(row.Code), name: String(row.Name) }))
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
    queryKey: rawTableQueryKey('loyalty-program-kinds'),
    queryFn: ({ signal }) => listLoyaltyProgramKinds(signal),
  })
}

/**
 * Every loyalty program, with its tiers — what a program/tier picker needs, and the
 * only way to get it: the list endpoint is paged, so this walks it at the largest
 * page size the API allows. Filed under the generated list key, like
 * {@link loyaltyProgramQueryKey}, so invalidateLoyaltyPrograms refreshes it too.
 */
export async function listLoyaltyPrograms(signal?: AbortSignal): Promise<LoyaltyProgramDto[]> {
  const programs: LoyaltyProgramDto[] = []
  for (let page = 1; ; page++) {
    const result = await adminGetLoyaltyPrograms({ Page: page, PageSize: MAX_PAGE_SIZE }, undefined, signal)
    programs.push(...(result.items ?? []))
    if (page * MAX_PAGE_SIZE >= (result.total ?? 0)) return programs
  }
}

export function useLoyaltyPrograms() {
  return useQuery({
    queryKey: [...getAdminGetLoyaltyProgramsQueryKey(), 'all'],
    queryFn: ({ signal }) => listLoyaltyPrograms(signal),
  })
}
