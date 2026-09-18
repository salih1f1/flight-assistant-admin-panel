import { describe, expect, it } from 'vitest'
import { filterLabel, parseFilter, withFilter, withoutColumn, withoutFilter } from './appliedFilters'

describe('parseFilter', () => {
  it('splits on the first colon only, so a value keeps its own', () => {
    expect(parseFilter('CreatedUtc:2026-09-01T12:30:00Z'))
      .toEqual({ column: 'CreatedUtc', value: '2026-09-01T12:30:00Z' })
  })

  it('reads a criterion with no colon as a column and an empty value', () => {
    expect(parseFilter('DisplayName')).toEqual({ column: 'DisplayName', value: '' })
  })
})

describe('filterLabel', () => {
  it('reads a plain criterion as column and value', () => {
    expect(filterLabel('Country:TR')).toBe('Country: TR')
  })

  it('spells out a ">=" value the way the comparison picker words it', () => {
    expect(filterLabel('CreatedUtc:>=2026-09-01')).toBe('CreatedUtc: on or after 2026-09-01')
  })

  it('keeps a value that merely contains ">=" intact', () => {
    expect(filterLabel('Name:a>=b')).toBe('Name: a>=b')
  })
})

describe('withFilter', () => {
  it('appends a new criterion', () => {
    expect(withFilter(['Country:TR'], 'Name:air')).toEqual(['Country:TR', 'Name:air'])
  })

  it('keeps a second criterion on the same column: they AND', () => {
    expect(withFilter(['Name:air'], 'Name:tur')).toEqual(['Name:air', 'Name:tur'])
  })

  it('does not add a criterion that is already applied', () => {
    expect(withFilter(['Country:TR'], 'Country:TR')).toEqual(['Country:TR'])
  })
})

describe('withoutFilter', () => {
  it('removes exactly the criterion named, leaving the rest', () => {
    expect(withoutFilter(['Country:TR', 'Name:air'], 'Country:TR')).toEqual(['Name:air'])
  })

  it('removes only the criterion named, not another on the same column', () => {
    expect(withoutFilter(['Name:air', 'Name:tur'], 'Name:air')).toEqual(['Name:tur'])
  })
})

describe('withoutColumn', () => {
  it('removes every criterion on that column and nothing else', () => {
    expect(withoutColumn(['IsVerified:true', 'Country:TR'], 'IsVerified')).toEqual(['Country:TR'])
  })

  it('leaves a column whose name merely starts the same', () => {
    expect(withoutColumn(['IsVerifiedAt:x'], 'IsVerified')).toEqual(['IsVerifiedAt:x'])
  })
})
