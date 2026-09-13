import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { flightsApi } from '@/api/flights'

export const FLIGHTS_KEY = ['flights']

export function useFlights(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...FLIGHTS_KEY, 'list', page, pageSize],
    queryFn: () => flightsApi.list(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useFlight(id: number) {
  return useQuery({ queryKey: [...FLIGHTS_KEY, id], queryFn: () => flightsApi.getById(id) })
}

export function useDeleteFlight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: flightsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: FLIGHTS_KEY }),
  })
}

export function useSyncFlight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: flightsApi.sync,
    onSuccess: () => qc.invalidateQueries({ queryKey: FLIGHTS_KEY }),
  })
}
