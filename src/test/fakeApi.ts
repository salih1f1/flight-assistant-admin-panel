import type { AxiosRequestConfig } from 'axios'
import { vi } from 'vitest'
import { apiClient } from '@/api/client'

export type SentRequest = {
  method: string
  url: string
  params?: Record<string, unknown>
  data?: unknown
}

/** An axios-shaped error, as the panel sees a non-2xx response. */
export function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } })
}

/**
 * Fakes the API at the apiClient boundary, however the code under test calls it:
 * the hand-written modules use apiClient.get/post/put/delete, the orval-generated
 * client uses apiClient.request. Each call becomes one SentRequest, is recorded in
 * `sent`, and is answered by `handler` (throw httpError(...) for a failure). Tests
 * assert on what was sent rather than on which method sent it, so they hold while
 * pages move from the hand-written client to the generated one.
 *
 * The test file must mock '@/api/client' with get, post, put, delete and request.
 */
export function installFakeApi(handler: (req: SentRequest) => unknown) {
  const sent: SentRequest[] = []
  const respond = async (req: SentRequest) => {
    sent.push(req)
    return { data: await handler(req) }
  }
  const client = vi.mocked(apiClient)

  client.get.mockReset().mockImplementation(((url: string, config?: AxiosRequestConfig) =>
    respond({ method: 'GET', url, params: config?.params })) as never)
  client.delete.mockReset().mockImplementation(((url: string, config?: AxiosRequestConfig) =>
    respond({ method: 'DELETE', url, params: config?.params })) as never)
  client.post.mockReset().mockImplementation(((url: string, data?: unknown, config?: AxiosRequestConfig) =>
    respond({ method: 'POST', url, data, params: config?.params })) as never)
  client.put.mockReset().mockImplementation(((url: string, data?: unknown, config?: AxiosRequestConfig) =>
    respond({ method: 'PUT', url, data, params: config?.params })) as never)
  client.request.mockReset().mockImplementation(((config: AxiosRequestConfig) =>
    respond({ method: (config.method ?? 'GET').toUpperCase(), url: config.url ?? '', params: config.params, data: config.data })) as never)

  return { sent }
}

/**
 * A paged admin list response: PagedResult {items, total, page, pageSize}, Page
 * defaulting to 1 and PageSize to 50, PageSize outside 1..200 a 400.
 */
export function pagedResult(rows: readonly unknown[], params?: Record<string, unknown>) {
  const page = Number(params?.Page ?? 1)
  const pageSize = Number(params?.PageSize ?? 50)
  if (page < 1 || pageSize < 1 || pageSize > 200) throw httpError(400)
  const start = (page - 1) * pageSize
  return { items: rows.slice(start, start + pageSize), total: rows.length, page, pageSize }
}
