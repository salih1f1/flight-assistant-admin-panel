import { describe, expect, it } from 'vitest'
import { verifiedPercent } from './verifiedPercent'

describe('verifiedPercent', () => {
  it('is the share of the two counts, rounded', () => {
    expect(verifiedPercent(540, 152)).toBe(78)
    expect(verifiedPercent(9000, 68)).toBe(99)
    expect(verifiedPercent(1, 1)).toBe(50)
  })

  it('is 100 only when every row is verified, and 0 only when none is', () => {
    expect(verifiedPercent(25, 0)).toBe(100)
    expect(verifiedPercent(0, 203)).toBe(0)
  })

  /** The whole point of a share on a card is that it can be trusted at a glance: "100% verified"
   *  next to a row that is not verified would be the one number here that lies. */
  it('never rounds up to 100 while a row is still unverified, or down to 0 while one is verified', () => {
    expect(verifiedPercent(9067, 1)).toBe(99)
    expect(verifiedPercent(999_999, 1)).toBe(99)
    expect(verifiedPercent(1, 9999)).toBe(1)
    expect(verifiedPercent(1, 999_999)).toBe(1)
  })

  it('has no share to state for a table with no rows', () => {
    expect(verifiedPercent(0, 0)).toBeUndefined()
  })

  /** travelers and flights: no IsVerified column, so the API sends null rather than zero. */
  it('has no share to state where the API sends no counts', () => {
    expect(verifiedPercent(null, null)).toBeUndefined()
    expect(verifiedPercent(undefined, undefined)).toBeUndefined()
    expect(verifiedPercent(540, null)).toBeUndefined()
    expect(verifiedPercent(null, 152)).toBeUndefined()
  })

  it('has no share to state for counts that cannot be one', () => {
    expect(verifiedPercent(-1, 10)).toBeUndefined()
    expect(verifiedPercent(10, -1)).toBeUndefined()
  })
})
