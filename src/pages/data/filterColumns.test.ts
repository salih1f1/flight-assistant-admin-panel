import { describe, expect, it } from 'vitest'
import { filterColumns, filterControl } from './filterColumns'

describe('filterColumns', () => {
  const published = [
    { name: 'Status', kind: 'Enum', values: ['Pending', 'Error'] },
    { name: 'RequestedUtc', kind: 'Date', values: null },
  ]

  it('takes the published columns, in their published order', () => {
    expect(filterColumns(published, ['RequestedUtc', 'Status'], undefined)).toEqual([
      { name: 'Status', kind: 'Enum', values: ['Pending', 'Error'] },
      { name: 'RequestedUtc', kind: 'Date', values: null },
    ])
  })

  /** An API predating the metadata, or a listing still loading: the names the rows themselves
   *  carry, with no kind — which is how the filter behaved before kinds existed. */
  it('falls back to the inferred names, claiming no kind for them', () => {
    expect(filterColumns(undefined, ['Id', 'DisplayName'], undefined)).toEqual([
      { name: 'Id' },
      { name: 'DisplayName' },
    ])
    expect(filterColumns([], ['Id'], undefined)).toEqual([{ name: 'Id' }])
  })

  /** The applied column must stay pickable even when the current page has no rows to name it and
   *  no metadata arrived — otherwise the form silently shows a different column than the one the
   *  URL is filtering on. */
  it('offers the applied column when neither source names it', () => {
    expect(filterColumns(undefined, ['Id'], 'DisplayName')).toEqual([
      { name: 'DisplayName' },
      { name: 'Id' },
    ])
    expect(filterColumns(published, ['Id'], 'Status')).toEqual(published)
  })

  it('drops a published entry with no name, which nothing could filter on', () => {
    expect(filterColumns([{ name: null, kind: 'Text', values: null }, ...published], [], undefined)).toEqual(published)
  })
})

describe('filterControl', () => {
  it('picks a control per published kind', () => {
    expect(filterControl('Enum')).toBe('enum')
    expect(filterControl('Bool')).toBe('bool')
    expect(filterControl('Date')).toBe('date')
    expect(filterControl('Text')).toBe('text')
    expect(filterControl('Number')).toBe('text')
    expect(filterControl('Guid')).toBe('text')
  })

  /** The API says outright that it cannot filter this column, so the form must not offer one. */
  it('offers nothing for a column the API cannot filter', () => {
    expect(filterControl('Unsupported')).toBe('none')
  })

  /** An unknown kind is the fallback case, not a broken one: a kind added to the API later must
   *  leave the free-text box working rather than disabling the filter. */
  it('falls back to free text for an unknown or absent kind', () => {
    expect(filterControl(undefined)).toBe('text')
    expect(filterControl(null)).toBe('text')
    expect(filterControl('SomethingNew')).toBe('text')
  })
})
