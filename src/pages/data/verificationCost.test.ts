import { describe, expect, it } from 'vitest'
import { costLine, formatUsd } from './verificationCost'

describe('formatUsd', () => {
  it('formats a whole dollar amount with 2 decimals', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(5)).toBe('$5.00')
  })

  it('extends past 2 decimals for a sub-cent amount', () => {
    expect(formatUsd(0.015)).toBe('$0.015')
    expect(formatUsd(0.0015)).toBe('$0.0015')
  })
})

describe('costLine', () => {
  it('multiplies the row count by the per-row cost', () => {
    expect(costLine(12, 0.015)).toBe('12 × $0.015 = $0.18')
  })

  it('shows $0.00 for a free source', () => {
    expect(costLine(3, 0)).toBe('3 × $0.00 = $0.00')
  })

  it('appends the month figure when given', () => {
    expect(costLine(12, 0.015, { spentUsd: 2.1, budgetUsd: 5 })).toBe('12 × $0.015 = $0.18 · this month $2.10 of $5.00')
  })

  it('omits the month figure when not given', () => {
    expect(costLine(12, 0.015)).not.toContain('this month')
  })
})
