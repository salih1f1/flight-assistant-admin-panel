import { describe, expect, it } from 'vitest'
import { recordKey, recordPath } from './records'

/**
 * Which column names one row of a table, and where that row opens (#120). A table whose key is not
 * `Id` needs an entry in KEY_COLUMNS; without one the grid renders no open action on any of its
 * rows, silently — nothing throws, the eye icon is simply never there.
 */
describe('recordKey', () => {
  it('assumes Id for a table with no entry of its own', () => {
    expect(recordKey('airports')).toBe('Id')
  })

  it('knows the tables keyed by something else', () => {
    expect(recordKey('countries')).toBe('Code')
    expect(recordKey('data-source-status')).toBe('Key')
  })

  it('has no single key for a table whose key spans several columns', () => {
    expect(recordKey('lounge-provider-links')).toBeUndefined()
  })
})

describe('recordPath', () => {
  it('opens a row at its record page', () => {
    expect(recordPath('airports', { Id: 7 })).toBe('/data/airports/7')
  })

  it('opens a row keyed by something other than Id', () => {
    expect(recordPath('data-source-status', { Key: 'aeroapi' })).toBe('/data/data-source-status/aeroapi')
  })

  it("sends a record with its own richer page there instead", () => {
    expect(recordPath('flights', { Id: 3 })).toBe('/flights/3')
  })

  it('opens nowhere when the key column holds no value', () => {
    expect(recordPath('data-source-status', { Key: null })).toBeUndefined()
  })
})
