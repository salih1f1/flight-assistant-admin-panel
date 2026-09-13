import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { loyaltyApi } from '@/api/loyalty'
import type { CreateLoyaltyProgramRequest } from '@/types'

export const LOYALTY_KEY = ['loyalty-programs']

export function useLoyaltyPrograms(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...LOYALTY_KEY, 'list', page, pageSize],
    queryFn: () => loyaltyApi.list(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useLoyaltyProgram(id: number | undefined) {
  return useQuery({
    queryKey: [...LOYALTY_KEY, id],
    queryFn: () => loyaltyApi.findById(id!),
    enabled: id != null,
  })
}

export function useLoyaltyProgramKinds() {
  return useQuery({ queryKey: ['loyalty-program-kinds'], queryFn: loyaltyApi.listKinds })
}

export function useCreateLoyaltyProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: loyaltyApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: LOYALTY_KEY }),
  })
}

export function useUpdateLoyaltyProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateLoyaltyProgramRequest }) => loyaltyApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: LOYALTY_KEY }),
  })
}

export function useDeleteLoyaltyProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: loyaltyApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: LOYALTY_KEY }),
  })
}
