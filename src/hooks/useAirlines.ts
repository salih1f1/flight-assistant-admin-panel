import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { airlinesApi } from '@/api/airlines'
import type { CreateAirlineRequest } from '@/types'

export const AIRLINES_KEY = ['airlines']

export function useAirlines(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...AIRLINES_KEY, 'list', page, pageSize],
    queryFn: () => airlinesApi.list(page, pageSize),
    // Keep the current page on screen while the next one loads, rather than
    // dropping back to the full-page loading state on every click.
    placeholderData: keepPreviousData,
  })
}

export function useAirline(id: number) {
  return useQuery({ queryKey: [...AIRLINES_KEY, id], queryFn: () => airlinesApi.getById(id) })
}

export function useCreateAirline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: airlinesApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: AIRLINES_KEY }),
  })
}

export function useUpdateAirline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateAirlineRequest }) => airlinesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: AIRLINES_KEY }),
  })
}

export function useDeleteAirline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: airlinesApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: AIRLINES_KEY }),
  })
}
