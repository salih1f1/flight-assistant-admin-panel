import type { apiClient } from '@/api/client'

/**
 * Stands in for apiClient.get with the contract every paged admin list follows:
 * PagedResult {items, total, page, pageSize}, Page defaulting to 1 and PageSize
 * to 50, and PageSize outside 1..200 rejected with a 400 (PagedRequestValidator).
 *
 * `tables` maps a list URL to every row it holds; any other URL rejects, so a
 * page calling an endpoint the test did not expect fails loudly.
 */
export function fakePagedGet(tables: Record<string, readonly unknown[]>) {
  const get = (url: string, config?: { params?: Record<string, unknown> }) => {
    const rows = tables[url]
    if (!rows) return Promise.reject(new Error(`unexpected GET ${url}`))
    const page = Number(config?.params?.Page ?? 1)
    const pageSize = Number(config?.params?.PageSize ?? 50)
    if (page < 1 || pageSize < 1 || pageSize > 200) {
      return Promise.reject(Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } }))
    }
    const start = (page - 1) * pageSize
    return Promise.resolve({
      data: { items: rows.slice(start, start + pageSize), total: rows.length, page, pageSize },
    })
  }
  return get as unknown as typeof apiClient.get
}
