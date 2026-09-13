import type { AxiosRequestConfig } from 'axios'
import { vi } from 'vitest'
import { apiClient } from '@/api/client'

export type SentRequest = {
  method: string
  url: string
  params?: Record<string, unknown>
  data?: unknown
}

/** An axios-shaped error, as the panel sees a non-2xx response; `data` is the response body. */
export function httpError(status: number, data?: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } })
}

/**
 * Fakes the API at the apiClient boundary. The orval-generated client sends every
 * call through apiClient.request; each call becomes one SentRequest, is recorded
 * in `sent`, and is answered by `handler` (throw httpError(...) for a failure).
 *
 * The test file must mock '@/api/client' with { apiClient: { request: vi.fn() } }.
 */
export function installFakeApi(handler: (req: SentRequest) => unknown) {
  const sent: SentRequest[] = []
  vi.mocked(apiClient.request).mockReset().mockImplementation((async (config: AxiosRequestConfig) => {
    const req = { method: (config.method ?? 'GET').toUpperCase(), url: config.url ?? '', params: config.params, data: config.data }
    sent.push(req)
    return { data: await handler(req) }
  }) as never)

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
