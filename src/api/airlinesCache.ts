import type { QueryClient } from '@tanstack/react-query'
import { getAdminGetAllAirlinesQueryKey, getAdminGetAirlineByIdQueryKey } from './generated/admin'

/**
 * Generated hooks key lists as ['/admin/airlines', params] and details as
 * ['/admin/airlines/{id}'], and generated mutations invalidate nothing. Call this
 * after a write so every page of the list, and the edited airline, refetch.
 */
export function invalidateAirlines(queryClient: QueryClient, id?: number) {
  void queryClient.invalidateQueries({ queryKey: getAdminGetAllAirlinesQueryKey() })
  if (id != null) void queryClient.invalidateQueries({ queryKey: getAdminGetAirlineByIdQueryKey(id) })
}
