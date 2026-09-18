import { describe, expect, it } from 'vitest'
import { formatWaited, PENDING_QUEUE_LINK } from './pendingVerifications'

const NOW = new Date('2026-09-18T12:00:00Z').getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('PENDING_QUEUE_LINK', () => {
  it('points at the queue table, filtered to what is waiting', () => {
    expect(PENDING_QUEUE_LINK).toBe('/data/verification-requests?filter=Status%3APending')
  })
})

describe('formatWaited', () => {
  it('counts minutes under an hour', () => {
    expect(formatWaited(ago(12 * MINUTE), NOW)).toBe('12m')
    expect(formatWaited(ago(59 * MINUTE), NOW)).toBe('59m')
  })

  it('counts hours and minutes under a day', () => {
    expect(formatWaited(ago(3 * HOUR + 12 * MINUTE), NOW)).toBe('3h 12m')
    expect(formatWaited(ago(23 * HOUR + 59 * MINUTE), NOW)).toBe('23h 59m')
  })

  it('counts days and hours beyond a day', () => {
    expect(formatWaited(ago(2 * DAY + 4 * HOUR), NOW)).toBe('2d 4h')
    expect(formatWaited(ago(40 * DAY + 30 * MINUTE), NOW)).toBe('40d')
  })

  it('drops a zero trailing unit rather than reading "1h 0m"', () => {
    expect(formatWaited(ago(HOUR), NOW)).toBe('1h')
    expect(formatWaited(ago(3 * DAY), NOW)).toBe('3d')
  })

  /** The queue is polled on an interval, so a request younger than a minute has not been waiting
   *  in any sense worth a number; "0m" would read as a stuck one. */
  it('says less than a minute below a minute, and for a clock that disagrees', () => {
    expect(formatWaited(ago(45_000), NOW)).toBe('less than a minute')
    expect(formatWaited(ago(0), NOW)).toBe('less than a minute')
    expect(formatWaited(new Date(NOW + 5 * MINUTE).toISOString(), NOW)).toBe('less than a minute')
  })

  it('has nothing to say about a missing or unreadable timestamp', () => {
    expect(formatWaited(undefined, NOW)).toBeUndefined()
    expect(formatWaited(null, NOW)).toBeUndefined()
    expect(formatWaited('not a date', NOW)).toBeUndefined()
    expect(formatWaited(42, NOW)).toBeUndefined()
  })
})
