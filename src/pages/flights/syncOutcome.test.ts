import { describe, expect, it } from 'vitest'
import { isFirstSyncQueued, syncResultMessage } from './syncOutcome'

const result = (over: Partial<Parameters<typeof syncResultMessage>[0]> = {}) => ({
  outcome: 'NoChange',
  lastSyncedUtc: '2026-09-17T20:31:05Z',
  nextSyncDueUtc: null,
  syncMode: 'Live',
  scheduleMissingSinceUtc: null,
  ...over,
})

describe('syncResultMessage', () => {
  it.each([
    ['StatusUpdated', 'New status recorded.'],
    ['NoChange', 'Checked, nothing changed.'],
    ['NoDataYet', 'AeroAPI has no live data for this flight yet.'],
    ['ScheduleUpdated', 'The scheduled times changed and were updated.'],
    ['NotInSchedule', "This flight is no longer in the airline's schedule."],
    ['NotTracked', "No traveler tracks this flight, so it isn't synced."],
  ])('says what %s means', (outcome, message) => {
    expect(syncResultMessage(result({ outcome }))).toBe(message)
  })

  it('adds the next sync time when there is one', () => {
    expect(syncResultMessage(result({ nextSyncDueUtc: '2026-09-17T20:41:05Z' })))
      .toBe('Checked, nothing changed. Next sync 2026-09-17 20:41 UTC.')
  })

  it('leaves the next sync out when the flight has no plan', () => {
    expect(syncResultMessage(result({ outcome: 'NotTracked', nextSyncDueUtc: null })))
      .toBe("No traveler tracks this flight, so it isn't synced.")
  })

  // An outcome this panel doesn't know — a backend that has moved ahead — must still say
  // something. A blank line would read as "nothing happened", which is a claim, not an absence.
  it('names an outcome it does not recognise rather than going blank', () => {
    const message = syncResultMessage(result({ outcome: 'SomethingNewer' }))
    expect(message).not.toBe('')
    expect(message).toContain('SomethingNewer')
  })

  it('still says something when the outcome is missing entirely', () => {
    expect(syncResultMessage(result({ outcome: null })).length).toBeGreaterThan(0)
  })
})

describe('isFirstSyncQueued', () => {
  const NOW = Date.parse('2026-09-20T09:51:00Z')

  it('is queued when the flight has never synced and its first sync is already due', () => {
    expect(isFirstSyncQueued(null, '2026-09-20T09:51:00Z', NOW)).toBe(true)
  })

  // Tracking makes the flight due immediately, so the due time is a moment in the recent past.
  it('is still queued a minute after the first sync came due', () => {
    expect(isFirstSyncQueued(null, '2026-09-20T09:50:00Z', NOW)).toBe(true)
  })

  it('is not queued once the flight has synced at least once', () => {
    expect(isFirstSyncQueued('2026-09-20T09:41:00Z', '2026-09-20T09:51:00Z', NOW)).toBe(false)
  })

  it('is not queued while the first sync is still in the future', () => {
    expect(isFirstSyncQueued(null, '2026-09-20T09:52:00Z', NOW)).toBe(false)
  })

  // Past the overdue threshold "the background sync may not be running" is the truer statement,
  // and two claims about the same silence would contradict each other.
  it('stands down once the sync is overdue', () => {
    expect(isFirstSyncQueued(null, '2026-09-20T09:40:00Z', NOW)).toBe(false)
  })

  it('is not queued when the flight has no sync plan at all', () => {
    expect(isFirstSyncQueued(null, null, NOW)).toBe(false)
  })
})
