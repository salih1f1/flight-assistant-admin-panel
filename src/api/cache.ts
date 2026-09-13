import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  getAdminGetAirlineByIdQueryKey,
  getAdminGetAirportByIdQueryKey,
  getAdminGetAllAirlinesQueryKey,
  getAdminGetAllAirportsQueryKey,
  getAdminGetAllFlightsQueryKey,
  getAdminGetAllLoungesQueryKey,
  getAdminGetAllTravelersQueryKey,
  getAdminGetLoungeByIdQueryKey,
  getAdminGetLoyaltyProgramsQueryKey,
} from './generated/admin'

/*
 * Generated hooks key a list as ['/admin/<things>', params] and a detail as
 * ['/admin/<things>/{id}'], and generated mutations invalidate nothing. Call the
 * helper for an entity after a write so every page of its list, and the edited
 * record, refetch.
 */

function invalidate(queryClient: QueryClient, listKey: QueryKey, detailKey?: QueryKey) {
  void queryClient.invalidateQueries({ queryKey: listKey })
  if (detailKey) void queryClient.invalidateQueries({ queryKey: detailKey })
}

export const invalidateAirlines = (queryClient: QueryClient, id?: number) =>
  invalidate(queryClient, getAdminGetAllAirlinesQueryKey(), id == null ? undefined : getAdminGetAirlineByIdQueryKey(id))

export const invalidateAirports = (queryClient: QueryClient, id?: number) =>
  invalidate(queryClient, getAdminGetAllAirportsQueryKey(), id == null ? undefined : getAdminGetAirportByIdQueryKey(id))

export const invalidateLounges = (queryClient: QueryClient, id?: number) =>
  invalidate(queryClient, getAdminGetAllLoungesQueryKey(), id == null ? undefined : getAdminGetLoungeByIdQueryKey(id))

// The panel has no flight or traveler detail page, so only the lists need refreshing.
export const invalidateFlights = (queryClient: QueryClient) => invalidate(queryClient, getAdminGetAllFlightsQueryKey())

export const invalidateTravelers = (queryClient: QueryClient) => invalidate(queryClient, getAdminGetAllTravelersQueryKey())

// There is no loyalty detail endpoint; the form's program lookup (loyaltyLookups)
// is keyed under the list key, so the list invalidation refreshes it too.
export const invalidateLoyaltyPrograms = (queryClient: QueryClient) =>
  invalidate(queryClient, getAdminGetLoyaltyProgramsQueryKey())
