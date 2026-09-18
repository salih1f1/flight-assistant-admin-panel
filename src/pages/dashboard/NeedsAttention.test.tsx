import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { NeedsAttentionSection } from './NeedsAttentionSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Mirrors VERIFICATION_ENTITY_TYPES's slug -> entityType map (src/pages/data/verificationChecks.ts).
const gridLink = (slug: string) => `/data/${slug}?${new URLSearchParams({ filter: 'VerificationIssue:*' })}`

// Shaped like VerificationNeedsAttentionDto (FlightAssistant.Contracts), as
// AdminVerificationEndpointTests.GetNeedsAttention_Returns200_WithAllThreeEntityTypes_InEnumOrder
// asserts it: always all three types, in enum order (Airport, Airline, Country), zero-filled
// rather than an omitted entry.
const counts = (overrides: Partial<Record<'Airport' | 'Airline' | 'Country', number>> = {}) => [
  { entityType: 'Airport', count: overrides.Airport ?? 0 },
  { entityType: 'Airline', count: overrides.Airline ?? 0 },
  { entityType: 'Country', count: overrides.Country ?? 0 },
]

let sent: SentRequest[]

function installApi(answer: () => unknown) {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/verification-needs-attention') return answer()
    throw httpError(404)
  }))
}

const section = async () => (await screen.findByRole('heading', { name: 'Needs attention' })).closest('section')!

describe('Dashboard needs-attention', () => {
  it('reads the counts from /admin/verification-needs-attention', async () => {
    installApi(() => counts())
    renderWithProviders(<NeedsAttentionSection />)
    await section()

    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: '/admin/verification-needs-attention' }))
  })

  it('shows all three types, including a zero count', async () => {
    installApi(() => counts({ Airport: 3, Country: 12 }))
    renderWithProviders(<NeedsAttentionSection />)
    const region = await section()

    expect(await within(region).findByText('Airports')).toBeInTheDocument()
    expect(within(region).getByText('3')).toBeInTheDocument()
    expect(within(region).getByText('Airlines')).toBeInTheDocument()
    expect(within(region).getByText('0')).toBeInTheDocument()
    expect(within(region).getByText('Countries')).toBeInTheDocument()
    expect(within(region).getByText('12')).toBeInTheDocument()
  })

  it('links a non-zero count to the grid, filtered to rows with an issue', async () => {
    installApi(() => counts({ Airport: 3, Airline: 5 }))
    renderWithProviders(<NeedsAttentionSection />)
    const region = await section()

    expect(await within(region).findByRole('link', { name: '3' })).toHaveAttribute('href', gridLink('airports'))
    expect(within(region).getByRole('link', { name: '5' })).toHaveAttribute('href', gridLink('airlines'))
  })

  it('does not link a zero count standing beside a flagged one', async () => {
    installApi(() => counts({ Airport: 3 }))
    renderWithProviders(<NeedsAttentionSection />)
    const region = await section()

    // Waits for the loaded state before asserting the absence of a link — otherwise this would
    // trivially pass during the loading state too, before any count is on screen.
    await within(region).findByText('Airports')
    expect(within(region).queryByRole('link', { name: '0' })).not.toBeInTheDocument()
  })

  it('heads the card with the total across the types when something is flagged', async () => {
    installApi(() => counts({ Airport: 3, Country: 12 }))
    renderWithProviders(<NeedsAttentionSection />)
    const region = await section()

    expect(await within(region).findByText('15 rows need attention')).toBeInTheDocument()
  })

  /** The point of the card is that a glance tells an operator whether to stop on it, so the healthy
   *  state says one line rather than three big zeros that read like the alarming state. */
  it('says nothing needs attention, with no counts to read, when every count is zero', async () => {
    installApi(() => counts())
    renderWithProviders(<NeedsAttentionSection />)
    const region = await section()

    expect(await within(region).findByText('Nothing needs attention')).toBeInTheDocument()
    expect(within(region).queryByText('Airports')).not.toBeInTheDocument()
    expect(within(region).queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the API failure', async () => {
    installApi(() => { throw httpError(500, { title: 'An unexpected error occurred.', status: 500 }) })
    renderWithProviders(<NeedsAttentionSection />)
    const region = await section()

    expect(await within(region).findByRole('alert')).toHaveTextContent('Could not load needs-attention counts: An unexpected error occurred.')
  })
})
