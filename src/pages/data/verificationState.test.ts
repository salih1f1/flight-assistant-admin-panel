import { describe, expect, it } from 'vitest'
import { verificationState } from './verificationState'

describe('verificationState', () => {
  it('is Verified, with the source appended, when IsVerified is true and VerificationSource is set', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: 'manual' }))
      .toEqual({ label: 'Verified · manual', tone: 'border-transparent bg-green-100 text-green-800' })
  })

  it('is Verified, with no suffix, when IsVerified is true and VerificationSource is empty', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: null }))
      .toEqual({ label: 'Verified', tone: 'border-transparent bg-green-100 text-green-800' })
  })

  it('is Needs attention, carrying the issue text, when unverified with a VerificationIssue', () => {
    expect(verificationState({ IsVerified: false, VerificationIssue: 'AeroAPI: duplicate IATA code' }))
      .toEqual({ label: 'Needs attention', tone: 'border-transparent bg-amber-100 text-amber-800', issue: 'AeroAPI: duplicate IATA code' })
  })

  it('is Unverified when IsVerified is not true and there is no issue', () => {
    expect(verificationState({ IsVerified: false })).toEqual({ label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
    expect(verificationState({})).toEqual({ label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
  })

  it('treats a whitespace-only or empty VerificationSource as no source', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: '   ' }))
      .toEqual({ label: 'Verified', tone: 'border-transparent bg-green-100 text-green-800' })
    expect(verificationState({ IsVerified: true, VerificationSource: '' }))
      .toEqual({ label: 'Verified', tone: 'border-transparent bg-green-100 text-green-800' })
  })

  it('treats a whitespace-only or empty VerificationIssue as no issue, falling back to Unverified', () => {
    expect(verificationState({ IsVerified: false, VerificationIssue: '   ' }))
      .toEqual({ label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
    expect(verificationState({ IsVerified: false, VerificationIssue: '' }))
      .toEqual({ label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
  })

  it('gives each state a distinct tone: green for Verified, amber for Needs attention, gray for Unverified', () => {
    expect(verificationState({ IsVerified: true }).tone).toBe('border-transparent bg-green-100 text-green-800')
    expect(verificationState({ IsVerified: false, VerificationIssue: 'x' }).tone).toBe('border-transparent bg-amber-100 text-amber-800')
    expect(verificationState({ IsVerified: false }).tone).toBe('border-transparent bg-gray-100 text-gray-700')
  })
})
