import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AdminProviderHeadroomDto } from '@/api/generated/model'
import { HeadroomSection } from './HeadroomSection'

const AERO_API: AdminProviderHeadroomDto = {
  provider: 'aeroapi',
  budgetState: 'Normal',
  spentUsd: 1.23,
  budgetUsd: 5,
  quotaRemaining: null,
  quotaLimit: null,
  observedUtc: null,
}

const AERO_DATA_BOX: AdminProviderHeadroomDto = {
  provider: 'aerodatabox',
  budgetState: null,
  spentUsd: null,
  budgetUsd: null,
  quotaRemaining: 1487,
  quotaLimit: 1505,
  observedUtc: '2026-09-20T09:00:00Z',
}

describe('HeadroomSection', () => {
  it('shows a metered provider budget state and spend against its budget', () => {
    render(<HeadroomSection headroom={[AERO_API]} />)

    expect(screen.getByText('Normal')).toBeInTheDocument()
    expect(screen.getByText('Spent $1.23 of $5.00 this month')).toBeInTheDocument()
  })

  it('shows a quota-based provider remaining quota and when it was observed', () => {
    render(<HeadroomSection headroom={[AERO_DATA_BOX]} />)

    expect(screen.getByText('Quota 1,487 of 1,505 left')).toBeInTheDocument()
    expect(screen.getByText(/Observed 2026-09-20 09:00 UTC/)).toBeInTheDocument()
  })

  /**
   * The rule the backend is careful about and the panel must not undo. AeroDataBox reports nothing
   * until this instance has actually called it, so a 0 here would show an exhausted plan on every
   * fresh deploy — a fault invented out of an absence.
   */
  describe('when a provider has reported nothing yet', () => {
    const unobserved: AdminProviderHeadroomDto = { ...AERO_DATA_BOX, quotaRemaining: null, quotaLimit: null, observedUtc: null }

    it('says the quota is unknown', () => {
      render(<HeadroomSection headroom={[unobserved]} />)
      expect(screen.getByText(/Quota unknown/)).toBeInTheDocument()
    })

    it('never renders it as zero', () => {
      render(<HeadroomSection headroom={[unobserved]} />)
      expect(screen.queryByText(/\b0 of\b/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Quota 0/)).not.toBeInTheDocument()
    })
  })

  // A failed usage read blanks the spend and the state while the budget survives, because the
  // budget is local configuration rather than something the failed call owns.
  it('renders an unknown spend as unknown rather than $0.00', () => {
    render(<HeadroomSection headroom={[{ ...AERO_API, budgetState: null, spentUsd: null }]} />)

    expect(screen.getByText('Spent unknown of $5.00 this month')).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
  })

  it('does not show a budget row for a provider that has no budget', () => {
    render(<HeadroomSection headroom={[AERO_DATA_BOX]} />)
    expect(screen.queryByText(/this month/)).not.toBeInTheDocument()
  })

  it('shows every provider it is given', () => {
    render(<HeadroomSection headroom={[AERO_API, AERO_DATA_BOX]} />)

    expect(screen.getByText('aeroapi')).toBeInTheDocument()
    expect(screen.getByText('aerodatabox')).toBeInTheDocument()
  })
})
