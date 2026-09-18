/** The queue table, filtered to what is triggered but waiting — exactly what "N pending" counts. */
export const PENDING_QUEUE_LINK = `/data/verification-requests?${new URLSearchParams({ filter: 'Status:Pending' })}`

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long something queued at `requestedUtc` has been waiting, at the coarsest useful scale:
 * "12m", "3h 12m", "2d 4h". A zero trailing unit is dropped ("1h", not "1h 0m").
 *
 * Undefined for a missing or unreadable timestamp, so the caller omits the line rather than
 * rendering a wait it cannot work out. `now` is an argument, not `Date.now()`, so the wait a test
 * asserts on is the one it set up.
 */
export function formatWaited(requestedUtc: unknown, now: number): string | undefined {
  if (typeof requestedUtc !== 'string') return undefined
  const requestedMs = new Date(requestedUtc).getTime()
  if (Number.isNaN(requestedMs)) return undefined

  // A future timestamp is a clock disagreeing with the API's, not a negative wait.
  const waited = Math.max(0, now - requestedMs)
  if (waited < MINUTE) return 'less than a minute'
  if (waited < HOUR) return `${Math.floor(waited / MINUTE)}m`
  if (waited < DAY) return withRemainder(Math.floor(waited / HOUR), 'h', Math.floor((waited % HOUR) / MINUTE), 'm')
  return withRemainder(Math.floor(waited / DAY), 'd', Math.floor((waited % DAY) / HOUR), 'h')
}

const withRemainder = (whole: number, wholeUnit: string, rest: number, restUnit: string) =>
  rest === 0 ? `${whole}${wholeUnit}` : `${whole}${wholeUnit} ${rest}${restUnit}`
