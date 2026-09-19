import { useQuery } from '@tanstack/react-query'
import { adminGetAllAirlines, getAdminGetAllAirlinesQueryKey } from './generated/admin'
import type { AirlineAdminDto } from './generated/model'
import { MAX_PAGE_SIZE } from './rawTableLookups'

/**
 * Every airline, walked at the largest page size the API allows. GET /admin/airlines is paged and
 * takes no filter, so a form that lets an admin search airlines by name has to hold the list —
 * about seven hundred of them, four requests, cached for as long as the program list is.
 */
export async function listAllAirlines(signal?: AbortSignal): Promise<AirlineAdminDto[]> {
  const airlines: AirlineAdminDto[] = []
  for (let page = 1; ; page++) {
    const result = await adminGetAllAirlines({ Page: page, PageSize: MAX_PAGE_SIZE }, undefined, signal)
    airlines.push(...(result.items ?? []))
    if (page * MAX_PAGE_SIZE >= (result.total ?? 0)) return airlines
  }
}

/** Filed under the generated list key, so a write that invalidates airlines refreshes this too. */
export const allAirlinesQueryKey = () => [...getAdminGetAllAirlinesQueryKey(), 'all'] as const

export function useAirlines() {
  return useQuery({
    queryKey: allAirlinesQueryKey(),
    queryFn: ({ signal }) => listAllAirlines(signal),
  })
}

/** "British Airways (BA)", falling back to ICAO and then to the bare id. */
export const airlineLabel = (airline: AirlineAdminDto) => {
  const code = airline.iata ?? airline.icao
  return code ? `${airline.name ?? 'Unnamed'} (${code})` : (airline.name ?? `#${airline.id}`)
}
