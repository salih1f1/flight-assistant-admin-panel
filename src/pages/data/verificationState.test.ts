import { describe, expect, it } from 'vitest'
import { verificationState } from './verificationState'

describe('verificationState', () => {
  it('is Verified, with the source appended, when IsVerified is true and VerificationSource is set', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: 'manual' }))
      .toEqual({ label: 'Verified · manual', variant: 'default' })
  })

  it('is Verified, with no suffix, when IsVerified is true and VerificationSource is empty', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: null }))
      .toEqual({ label: 'Verified', variant: 'default' })
  })

  it('is Needs attention, carrying the issue text, when unverified with a VerificationIssue', () => {
    expect(verificationState({ IsVerified: false, VerificationIssue: 'AeroAPI: duplicate IATA code' }))
      .toEqual({ label: 'Needs attention', variant: 'destructive', issue: 'AeroAPI: duplicate IATA code' })
  })

  it('is Unverified when IsVerified is not true and there is no issue', () => {
    expect(verificationState({ IsVerified: false })).toEqual({ label: 'Unverified', variant: 'secondary' })
    expect(verificationState({})).toEqual({ label: 'Unverified', variant: 'secondary' })
  })

  it('treats a whitespace-only or empty VerificationSource as no source', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: '   ' })).toEqual({ label: 'Verified', variant: 'default' })
    expect(verificationState({ IsVerified: true, VerificationSource: '' })).toEqual({ label: 'Verified', variant: 'default' })
  })

  it('treats a whitespace-only or empty VerificationIssue as no issue, falling back to Unverified', () => {
    expect(verificationState({ IsVerified: false, VerificationIssue: '   ' })).toEqual({ label: 'Unverified', variant: 'secondary' })
    expect(verificationState({ IsVerified: false, VerificationIssue: '' })).toEqual({ label: 'Unverified', variant: 'secondary' })
  })
})
