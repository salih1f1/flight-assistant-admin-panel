import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { loungesApi } from '@/api/lounges'
import type { CreateLoungeRequest } from '@/types'

export const LOUNGES_KEY = ['lounges']

export function useLounges(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...LOUNGES_KEY, 'list', page, pageSize],
    queryFn: () => loungesApi.list(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useLounge(id: number | undefined) {
  return useQuery({ queryKey: [...LOUNGES_KEY, id], queryFn: () => loungesApi.getById(id!), enabled: id != null })
}

export function useCreateLounge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: loungesApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: LOUNGES_KEY }),
  })
}

export function useUpdateLounge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: CreateLoungeRequest & { id: number }) =>
      loungesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: LOUNGES_KEY }),
  })
}

export function useDeleteLounge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: loungesApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: LOUNGES_KEY }),
  })
}
