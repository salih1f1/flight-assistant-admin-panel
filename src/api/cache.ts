import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  getAdminGetAirlineByIdQueryKey,
  getAdminGetAirportByIdQueryKey,
  getAdminGetAllAirlinesQueryKey,
  getAdminGetAllAirportsQueryKey,
  getAdminGetAllLoungesQueryKey,
  getAdminGetBrowsableTableDataQueryKey,
  getAdminGetLoungeByIdQueryKey,
  getAdminGetLoyaltyProgramsQueryKey,
} from './generated/admin'

/*
 * Generated hooks key a list as ['/admin/<things>', params] and a detail as
 * ['/admin/<things>/{id}'], and generated mutations invalidate nothing. Call the
 * helper for an entity after a write so every page of its list, its raw table (the
 * grid the panel lists it in), and the edited record refetch.
 */

function invalidate(queryClient: QueryClient, ...keys: (QueryKey | undefined)[]) {
  for (const queryKey of keys) if (queryKey) void queryClient.invalidateQueries({ queryKey })
}

const rawTable = (slug: string) => getAdminGetBrowsableTableDataQueryKey(slug)

export const invalidateAirlines = (queryClient: QueryClient, id?: number) =>
  invalidate(queryClient, getAdminGetAllAirlinesQueryKey(), rawTable('airlines'), id == null ? undefined : getAdminGetAirlineByIdQueryKey(id))

export const invalidateAirports = (queryClient: QueryClient, id?: number) =>
  invalidate(queryClient, getAdminGetAllAirportsQueryKey(), rawTable('airports'), id == null ? undefined : getAdminGetAirportByIdQueryKey(id))

export const invalidateLounges = (queryClient: QueryClient, id?: number) =>
  invalidate(queryClient, getAdminGetAllLoungesQueryKey(), rawTable('lounges'), id == null ? undefined : getAdminGetLoungeByIdQueryKey(id))

// There is no loyalty detail endpoint; the form's program lookup (loyaltyLookups)
// is keyed under the list key, so the list invalidation refreshes it too.
export const invalidateLoyaltyPrograms = (queryClient: QueryClient) =>
  invalidate(queryClient, getAdminGetLoyaltyProgramsQueryKey(), rawTable('loyalty-programs'))

/**
 * Every raw table, on every page. For a write whose effects reach other tables: deleting a
 * traveler removes their device tokens and tracked flights, and a sync records status events.
 */
export const invalidateRawTables = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('/admin/data/') })
