import { describe, expect, it } from 'vitest'
import { needsAttention, verificationState } from './verificationState'

describe('verificationState', () => {
  it('is Verified, with the source appended, when IsVerified is true and VerificationSource is set', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: 'manual' }))
      .toEqual({ kind: 'verified', label: 'Verified · manual', tone: 'border-transparent bg-green-100 text-green-800' })
  })

  it('is Verified, with no suffix, when IsVerified is true and VerificationSource is empty', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: null }))
      .toEqual({ kind: 'verified', label: 'Verified', tone: 'border-transparent bg-green-100 text-green-800' })
  })

  it('is Needs attention, carrying the issue text, when unverified with a VerificationIssue', () => {
    expect(verificationState({ IsVerified: false, VerificationIssue: 'AeroAPI: duplicate IATA code' }))
      .toEqual({ kind: 'attention', label: 'Needs attention', tone: 'border-transparent bg-amber-100 text-amber-800', issue: 'AeroAPI: duplicate IATA code' })
  })

  it('is Unverified when IsVerified is not true and there is no issue', () => {
    expect(verificationState({ IsVerified: false })).toEqual({ kind: 'unverified', label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
    expect(verificationState({})).toEqual({ kind: 'unverified', label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
  })

  it('treats a whitespace-only or empty VerificationSource as no source', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: '   ' }))
      .toEqual({ kind: 'verified', label: 'Verified', tone: 'border-transparent bg-green-100 text-green-800' })
    expect(verificationState({ IsVerified: true, VerificationSource: '' }))
      .toEqual({ kind: 'verified', label: 'Verified', tone: 'border-transparent bg-green-100 text-green-800' })
  })

  it('treats a whitespace-only or empty VerificationIssue as no issue, falling back to Unverified', () => {
    expect(verificationState({ IsVerified: false, VerificationIssue: '   ' }))
      .toEqual({ kind: 'unverified', label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
    expect(verificationState({ IsVerified: false, VerificationIssue: '' }))
      .toEqual({ kind: 'unverified', label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' })
  })

  /** `kind` is what callers switch on — the grid picks its icon by it, and needsAttention below is
   *  defined in terms of it — because `label` varies per row: it carries the source. */
  it('gives each state its own kind, independent of the label the row happens to read', () => {
    expect(verificationState({ IsVerified: true, VerificationSource: 'ourairports' }).kind).toBe('verified')
    expect(verificationState({ IsVerified: true, VerificationSource: null }).kind).toBe('verified')
    expect(verificationState({ IsVerified: false, VerificationIssue: 'x' }).kind).toBe('attention')
    expect(verificationState({ IsVerified: false }).kind).toBe('unverified')
    expect(verificationState({ IsVerified: true, VerifiedAt: '2019-01-01T00:00:00Z' }, { staleAfterDays: 180, now: NOW }).kind)
      .toBe('stale')
  })

  it('needs attention only in the attention kind, never in a stale or plainly unverified row', () => {
    expect(needsAttention({ IsVerified: false, VerificationIssue: 'x' })).toBe(true)
    expect(needsAttention({ IsVerified: false })).toBe(false)
    expect(needsAttention({ IsVerified: true, VerificationSource: 'manual' })).toBe(false)
    // Stale is still verified: it must never be swept in with the rows a check found something wrong with.
    expect(needsAttention({ IsVerified: true, VerifiedAt: '2019-01-01T00:00:00Z' })).toBe(false)
  })

  it('gives each state a distinct tone: green for Verified, amber for Needs attention, gray for Unverified', () => {
    expect(verificationState({ IsVerified: true }).tone).toBe('border-transparent bg-green-100 text-green-800')
    expect(verificationState({ IsVerified: false, VerificationIssue: 'x' }).tone).toBe('border-transparent bg-amber-100 text-amber-800')
    expect(verificationState({ IsVerified: false }).tone).toBe('border-transparent bg-gray-100 text-gray-700')
  })

  // ── Stale (#87) ──────────────────────────────────────────────────────────
  //
  // The window and the clock are arguments, never read inside: the window comes from
  // /admin/health at the call site, and a hardcoded `new Date()` would make every assertion
  // below drift with the calendar.

  const NOW = new Date('2026-09-18T12:00:00Z')
  const VERIFIED = 'border-transparent bg-green-100 text-green-800'
  const STALE = 'border-transparent bg-amber-50 text-amber-700'

  it('is Verified · stale when the verification is older than the window, naming the source and date on hover', () => {
    expect(verificationState(
      { IsVerified: true, VerificationSource: 'ourairports', VerifiedAt: '2026-01-02T08:30:00Z' },
      { staleAfterDays: 180, now: NOW },
    )).toEqual({
      kind: 'stale',
      label: 'Verified · stale',
      tone: STALE,
      staleNote: 'Verified 2026-01-02 08:30 UTC by ourairports — older than the 180-day window',
    })
  })

  it('names no source on hover when the row has none', () => {
    expect(verificationState(
      { IsVerified: true, VerifiedAt: '2026-01-02T08:30:00Z' },
      { staleAfterDays: 180, now: NOW },
    ).staleNote).toBe('Verified 2026-01-02 08:30 UTC — older than the 180-day window')
  })

  it('is plain Verified while the verification is still inside the window', () => {
    expect(verificationState(
      { IsVerified: true, VerificationSource: 'manual', VerifiedAt: '2026-09-01T00:00:00Z' },
      { staleAfterDays: 180, now: NOW },
    )).toEqual({ kind: 'verified', label: 'Verified · manual', tone: VERIFIED })
  })

  /** Matches FlightTrackedVerificationEventHandler.NeedsVerification, which queues a row only once
   *  VerifiedAt is strictly before nowUtc.AddDays(-staleAfterDays) — the panel must not call a row
   *  stale while the backend still considers it good. */
  it('is not stale at exactly the window, only past it', () => {
    const exactly = new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString()
    expect(verificationState({ IsVerified: true, VerifiedAt: exactly }, { staleAfterDays: 180, now: NOW }).label)
      .toBe('Verified')

    const aMinuteOlder = new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000 - 60_000).toISOString()
    expect(verificationState({ IsVerified: true, VerifiedAt: aMinuteOlder }, { staleAfterDays: 180, now: NOW }).label)
      .toBe('Verified · stale')
  })

  it('stays plain Verified when no window is known, however old the verification', () => {
    const row = { IsVerified: true, VerificationSource: 'manual', VerifiedAt: '2019-01-01T00:00:00Z' }
    expect(verificationState(row).label).toBe('Verified · manual')
    expect(verificationState(row, { now: NOW }).label).toBe('Verified · manual')
    expect(verificationState(row, { staleAfterDays: null, now: NOW }).label).toBe('Verified · manual')
  })

  it('stays plain Verified when VerifiedAt is missing or unreadable, rather than guessing', () => {
    expect(verificationState({ IsVerified: true }, { staleAfterDays: 180, now: NOW }).label).toBe('Verified')
    expect(verificationState({ IsVerified: true, VerifiedAt: null }, { staleAfterDays: 180, now: NOW }).label).toBe('Verified')
    expect(verificationState({ IsVerified: true, VerifiedAt: 'not a date' }, { staleAfterDays: 180, now: NOW }).label).toBe('Verified')
  })

  /** Staleness is about a verified row. An unverified one already reads as Needs attention or
   *  Unverified, and neither says anything a date could improve on. */
  it('leaves an unverified row alone, however old its last verification', () => {
    expect(verificationState(
      { IsVerified: false, VerificationIssue: 'AeroAPI: duplicate IATA code', VerifiedAt: '2019-01-01T00:00:00Z' },
      { staleAfterDays: 180, now: NOW },
    ).label).toBe('Needs attention')

    expect(verificationState(
      { IsVerified: false, VerifiedAt: '2019-01-01T00:00:00Z' },
      { staleAfterDays: 180, now: NOW },
    ).label).toBe('Unverified')
  })

  it('gives stale its own tone, lighter than Needs attention: a stale row is not a failed check', () => {
    expect(STALE).not.toBe('border-transparent bg-amber-100 text-amber-800')
    expect(verificationState({ IsVerified: true, VerifiedAt: '2019-01-01T00:00:00Z' }, { staleAfterDays: 180, now: NOW }).tone)
      .toBe(STALE)
  })
})
