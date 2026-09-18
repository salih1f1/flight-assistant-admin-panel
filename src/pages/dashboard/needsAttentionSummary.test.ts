import { describe, expect, it } from 'vitest'
import { needsAttentionSummary } from './needsAttentionSummary'

// Shaped like VerificationNeedsAttentionDto: always all three types, zero-filled, as
// GET /admin/verification-needs-attention answers.
const counts = (overrides: Partial<Record<'Airport' | 'Airline' | 'Country', number>> = {}) => [
  { entityType: 'Airport', count: overrides.Airport ?? 0 },
  { entityType: 'Airline', count: overrides.Airline ?? 0 },
  { entityType: 'Country', count: overrides.Country ?? 0 },
]

describe('needsAttentionSummary', () => {
  it('adds up what every entity type has flagged', () => {
    expect(needsAttentionSummary(counts({ Airport: 3, Country: 12 }))).toBe('15 rows need attention')
  })

  it('reads as one row for a single flagged row', () => {
    expect(needsAttentionSummary(counts({ Airline: 1 }))).toBe('1 row needs attention')
  })

  it('has nothing to say when nothing is flagged', () => {
    expect(needsAttentionSummary(counts())).toBeUndefined()
  })

  it('has nothing to say about a report with no entries', () => {
    expect(needsAttentionSummary([])).toBeUndefined()
  })

  /** A count the API omits is not a count of zero-and-fine, but it is not a reason to raise the
   *  card either: there is no number to show and nothing to link to. */
  it('passes over a count the API left out', () => {
    expect(needsAttentionSummary([{ entityType: 'Airport' }, { entityType: 'Airline', count: 0 }])).toBeUndefined()
    expect(needsAttentionSummary([{ entityType: 'Airport' }, { entityType: 'Airline', count: 2 }])).toBe('2 rows need attention')
  })
})
