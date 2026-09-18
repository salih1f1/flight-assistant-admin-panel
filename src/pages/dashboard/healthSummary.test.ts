import { describe, expect, it } from 'vitest'
import type { AdminDataSourceDto } from '@/api/generated/model'
import { countsNeedingAttention } from './healthSummary'

const source = (status: string | null): AdminDataSourceDto => ({ key: status ?? 'none', status })

describe('countsNeedingAttention', () => {
  it('counts nothing when every source is fine', () => {
    expect(countsNeedingAttention([source('Ok'), source('Ok')])).toBe(0)
  })

  it('counts a degraded and an unhealthy source', () => {
    expect(countsNeedingAttention([source('Ok'), source('Degraded'), source('Unhealthy')])).toBe(2)
  })

  // "Nobody has looked yet" is the state this whole feature exists to surface, so it counts.
  it('counts an unobserved source', () => {
    expect(countsNeedingAttention([source('Unknown')])).toBe(1)
  })

  // A deliberate choice about this environment, not something to chase.
  it('does not count a source that is deliberately unconfigured', () => {
    expect(countsNeedingAttention([source('NotConfigured')])).toBe(0)
  })

  /** An unfamiliar state is not evidence that all is well. */
  it('counts a status this build does not recognise', () => {
    expect(countsNeedingAttention([source('SomethingNew'), source(null)])).toBe(2)
  })
})
