import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { airportsApi } from '@/api/airports'
import type { CreateAirportRequest } from '@/types'

export const AIRPORTS_KEY = ['airports']

export function useAirports(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...AIRPORTS_KEY, 'list', page, pageSize],
    queryFn: () => airportsApi.list(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useAirport(id: number) {
  return useQuery({ queryKey: [...AIRPORTS_KEY, id], queryFn: () => airportsApi.getById(id) })
}

export function useCreateAirport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: airportsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: AIRPORTS_KEY }),
  })
}

export function useUpdateAirport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateAirportRequest }) => airportsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: AIRPORTS_KEY }),
  })
}

export function useDeleteAirport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: airportsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: AIRPORTS_KEY }),
  })
}
