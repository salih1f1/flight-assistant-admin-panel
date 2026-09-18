import { describe, expect, it } from 'vitest'
import { apiClient } from './client'

/**
 * How the client puts a repeated query parameter on the wire (#146).
 *
 * The API takes several filters as the same parameter given more than once —
 * `?filter=Country:TR&filter=Name:air` (backend #479). Axios's default for an array value is
 * `filter[]=Country:TR&filter[]=Name:air`, and `filter[]` is simply a different parameter name as
 * far as ASP.NET Core's binding is concerned: the server ignores it and returns the table
 * **unfiltered**. Nothing errors — the grid would quietly show rows nobody asked for, which is the
 * worst shape this bug could take, so it is pinned here rather than left to integration.
 */
describe('apiClient query serialization', () => {
  it('repeats an array parameter under the same name, with no brackets', () => {
    const uri = apiClient.getUri({
      url: '/admin/data/airlines',
      params: { Page: 1, filter: ['Country:TR', 'Name:air'] },
    })

    expect(uri).toContain('filter=Country:TR')
    expect(uri).toContain('filter=Name:air')
    expect(uri).not.toContain('filter[]')
    expect(uri).not.toContain('filter%5B%5D')
  })

  it('leaves a single value alone', () => {
    const uri = apiClient.getUri({ url: '/admin/data/airlines', params: { filter: 'Country:TR' } })

    expect(uri).toContain('filter=Country:TR')
  })
})
