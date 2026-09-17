import { describe, expect, it } from 'vitest'
import { syncResultMessage } from './syncOutcome'

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
