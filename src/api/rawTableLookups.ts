import { adminGetBrowsableTableData, getAdminGetBrowsableTableDataQueryKey } from './generated/admin'

/** The API's upper bound on PageSize (PagedRequestValidator). */
export const MAX_PAGE_SIZE = 200

/**
 * Every row of a browsable table, walked at the largest page size the API allows. For the
 * entities the admin API exposes nowhere else: lounge providers and loyalty program kinds have
 * neither a by-id route nor a list endpoint, so the data browser's own rows are the only place
 * their names and ids can be read. Rows are keyed by the entity's PascalCase property names.
 */
export async function listRawTable(slug: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let page = 1; ; page++) {
    const result = await adminGetBrowsableTableData(slug, { Page: page, PageSize: MAX_PAGE_SIZE }, undefined, signal)
    rows.push(...(result.items ?? []))
    if (page * MAX_PAGE_SIZE >= (result.total ?? 0)) return rows
  }
}

/**
 * Where a whole-table lookup is filed: under the generated key for that table's rows, so
 * invalidateRawTables — which every write that reaches a table calls — refreshes it too.
 */
export const rawTableQueryKey = (slug: string) => [...getAdminGetBrowsableTableDataQueryKey(slug), 'all'] as const
