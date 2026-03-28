import { useQuery } from '@tanstack/react-query'
import { refDataApi } from '@/api/refdata'

export function useCountries() {
  return useQuery({ queryKey: ['countries'], queryFn: refDataApi.getCountries })
}

export function useAlliances() {
  return useQuery({ queryKey: ['alliances'], queryFn: refDataApi.getAlliances })
}
