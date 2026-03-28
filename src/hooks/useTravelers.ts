import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { travelersApi } from '@/api/travelers'

export const TRAVELERS_KEY = ['travelers']

export function useTravelers() {
  return useQuery({ queryKey: TRAVELERS_KEY, queryFn: travelersApi.getAll })
}

export function useTraveler(id: string) {
  return useQuery({ queryKey: [...TRAVELERS_KEY, id], queryFn: () => travelersApi.getById(id) })
}

export function useDeleteTraveler() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: travelersApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: TRAVELERS_KEY }),
  })
}
