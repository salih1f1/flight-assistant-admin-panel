import { describe, expect, it } from 'vitest'
import { SYNC_LEGEND, syncRowTone } from './syncRowTone'

describe('syncRowTone', () => {
  it.each([
    ['Fast', 'green'],
    ['Live', 'blue'],
    ['Schedule', 'gray'],
  ])('tints a %s row %s', (mode, colour) => {
    expect(syncRowTone({ SyncMode: mode })).toContain(colour)
  })

  it.each([['Stopped'], [null], [undefined]])('leaves a %s row uncoloured', mode => {
    expect(syncRowTone({ SyncMode: mode })).toBe('')
  })

  // A flight the airline has dropped from its schedule is the one state worth interrupting for,
  // so it wins over the mode — including over Stopped, which is otherwise uncoloured.
  it('marks a flight missing from the schedule red, whatever its mode', () => {
    for (const mode of ['Fast', 'Live', 'Schedule', 'Stopped', null]) {
      expect(syncRowTone({ SyncMode: mode, ScheduleMissingSinceUtc: '2026-09-18T06:00:00Z' })).toContain('red')
    }
  })

  it('ignores an empty ScheduleMissingSinceUtc rather than reading it as missing', () => {
    expect(syncRowTone({ SyncMode: 'Fast', ScheduleMissingSinceUtc: null })).toContain('green')
    expect(syncRowTone({ SyncMode: 'Fast', ScheduleMissingSinceUtc: '' })).toContain('green')
  })

  it('leaves a row alone when the table has no sync columns at all', () => {
    expect(syncRowTone({ Id: 1, Name: 'British Airways' })).toBe('')
  })

  // The backend renders enum columns as names (#392). A number would mean that regressed, and
  // guessing a mode from it would paint rows on a wrong reading rather than showing nothing.
  it('does not tint a row whose mode arrived as a number', () => {
    expect(syncRowTone({ SyncMode: 0 })).toBe('')
  })
})

describe('SYNC_LEGEND', () => {
  it('names every state that can colour a row, and nothing that cannot', () => {
    expect(SYNC_LEGEND.map(entry => entry.label)).toEqual(['Fast', 'Live', 'Schedule', 'Not in schedule'])
  })

  it('gives each entry the same tone the rows use', () => {
    expect(SYNC_LEGEND.find(e => e.label === 'Fast')!.tone).toBe(syncRowTone({ SyncMode: 'Fast' }))
    expect(SYNC_LEGEND.find(e => e.label === 'Not in schedule')!.tone)
      .toBe(syncRowTone({ SyncMode: 'Live', ScheduleMissingSinceUtc: '2026-09-18T06:00:00Z' }))
  })
})
