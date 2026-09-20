import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { AdminProviderMapDto } from '@/api/generated/model'
import { ProvidersPage } from './ProvidersPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const MAP: AdminProviderMapDto = {
  routes: [{
    job: 'flight-search-route',
    displayName: 'Route search',
    providers: ['aerodatabox'],
    effectiveProviders: ['aerodatabox'],
    options: ['aerodatabox', 'aeroapi'],
    isDefault: true,
    canChange: true,
    changedUtc: null,
    changedBy: null,
    reason: null,
  }],
  operations: [{
    trigger: 'Searching',
    operation: 'GET /flights/search — both airports, no flight number',
    providers: ['aerodatabox'],
    routingKey: 'flight-search-route',
    fixedReason: null,
    listPrice: 'AeroDataBox $0.00 (free tier)',
    note: null,
  }],
  headroom: [{
    provider: 'aerodatabox',
    budgetState: null,
    spentUsd: null,
    budgetUsd: null,
    quotaRemaining: 1487,
    quotaLimit: 1505,
    observedUtc: '2026-09-20T09:00:00Z',
  }],
}

let sent: SentRequest[]

function renderWith(handler: (req: SentRequest) => unknown) {
  ;({ sent } = installFakeApi(handler))
  return renderWithProviders(<ProvidersPage />)
}

describe('ProvidersPage', () => {
  beforeEach(() => { sent = [] })

  // One endpoint returns all three, so three spinners for one request would read as three requests.
  it('reads the whole page from a single request', async () => {
    renderWith(async () => MAP)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Routing' })).toBeInTheDocument())
    expect(sent.filter(r => r.method === 'GET')).toHaveLength(1)
  })

  it('renders all three sections', async () => {
    renderWith(async () => MAP)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Routing' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'What gets called when' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Headroom' })).toBeInTheDocument()
  })

  it('reports a failure to load rather than an empty page', async () => {
    renderWith(async () => { throw httpError(503, { title: 'AeroAPI is unavailable.', status: 503 }) })

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/Could not load the providers/)).toBeInTheDocument()
    expect(screen.getByText(/AeroAPI is unavailable/)).toBeInTheDocument()
  })

  /**
   * The guarantee this pins is the app's, not this page's: `createQueryClient`'s MutationCache
   * invalidates everything after any successful mutation (`refreshAfterWrite`, #180), so the page
   * re-reads rather than trusting the write's own reply — which matters here because that reply is
   * one route while the call map's switchable rows report the provider in force, so a map still
   * naming the old provider would read as if the change half-worked.
   *
   * It therefore does NOT prove anything about this component, and would keep passing if the page
   * were changed to trust the reply. That is worth stating rather than leaving implied: the sibling
   * assertion in JobsSection.test.tsx has the same shape and I confirmed by mutation that it passes
   * with its own invalidateQueries removed. Kept because the end-to-end behaviour is genuinely
   * wanted and cheap to assert; not kept as evidence that this file causes it.
   */
  it('re-reads the response after a change rather than trusting the write reply', async () => {
    const user = userEvent.setup()
    renderWith(async req => {
      if (req.method === 'PUT') return MAP.routes![0]
      return MAP
    })

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Provider for Route search' })).toBeInTheDocument())

    // Counted rather than asserted as an exact total: the harness may mount more than once, and a
    // hard number would pin how often the page renders instead of the behaviour under test.
    const before = sent.filter(r => r.method === 'GET' && r.url === '/admin/providers').length

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider for Route search' }), 'aeroapi')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const after = sent.filter(r => r.method === 'GET' && r.url === '/admin/providers').length
      expect(after).toBeGreaterThan(before)
    })
  })

  // The API sends a nullable array for each part; a null must not take the page down.
  it('renders with a part missing entirely', async () => {
    renderWith(async () => ({ routes: null, operations: null, headroom: null }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Routing' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Headroom' })).toBeInTheDocument()
  })
})
