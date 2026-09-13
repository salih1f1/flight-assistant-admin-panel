import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Dashboard } from './Dashboard'

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), request: vi.fn() },
}))

// A different total per list, so a tile wired to the wrong endpoint shows the wrong number.
const TILES = [
  { label: 'Travelers', url: '/admin/travelers', total: 11 },
  { label: 'Flights', url: '/admin/flights', total: 12 },
  { label: 'Airlines', url: '/admin/airlines', total: 13 },
  { label: 'Airports', url: '/admin/airports', total: 14 },
  { label: 'Loyalty Programs', url: '/admin/loyalty/programs', total: 15 },
  { label: 'Lounges', url: '/admin/lounges', total: 16 },
]

let sent: SentRequest[]

describe('Dashboard', () => {
  beforeEach(() => {
    ;({ sent } = installFakeApi(req => {
      const tile = TILES.find(t => req.method === 'GET' && t.url === req.url)
      if (!tile) throw httpError(404)
      return pagedResult(Array.from({ length: tile.total }, (_, i) => ({ id: i + 1 })), req.params)
    }))
  })

  it.each(TILES)('the $label tile shows the total from $url', async ({ label, url, total }) => {
    renderWithProviders(<Dashboard />)

    // The tile is the card holding the label: label -> header -> card.
    const card = screen.getByText(label).parentElement!.parentElement!
    expect(await within(card).findByText(String(total))).toBeInTheDocument()
    // Only the total is needed, so one row is enough.
    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url, params: { Page: 1, PageSize: 1 } }))
  })
})
