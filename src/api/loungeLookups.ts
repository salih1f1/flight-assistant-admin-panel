import { useQuery } from '@tanstack/react-query'
import { listRawTable, rawTableQueryKey } from './rawTableLookups'

const TABLE = 'lounge-providers'

export type LoungeProvider = { id: number; code: string | null; name: string | null }

/**
 * Every lounge provider. There is no GET /admin/lounge-providers/{id} and no list endpoint —
 * the only routes the API has for them are verify, import and CSV export — so the browsable
 * table is where a provider's name comes from, read once for whoever asks.
 */
export function useLoungeProviders() {
  return useQuery({
    queryKey: rawTableQueryKey(TABLE),
    queryFn: ({ signal }) => listRawTable(TABLE, signal).then(rows => rows.map((row): LoungeProvider => ({
      id: Number(row.Id),
      code: row.Code == null ? null : String(row.Code),
      name: row.Name == null ? null : String(row.Name),
    }))),
  })
}

/** One provider by id, out of that one list: null once the list is in and holds no such id. */
export function useLoungeProvider(id: number | null | undefined) {
  const { data, isSuccess } = useLoungeProviders()
  return { data: data?.find(provider => provider.id === id) ?? null, isSuccess }
}
