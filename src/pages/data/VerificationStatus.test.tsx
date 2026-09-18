import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VerificationStatusBadge } from './VerificationStatus'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/**
 * The badge reads the stale window off GET /admin/health itself rather than taking it as a prop:
 * the data browser builds its cell renderers once and memoizes them, and a window arriving after
 * the first render would rebuild every column and remount the cells, dropping any revealed value.
 * Only `verification.staleAfterDays` is read, so the rest of the report is left out here.
 */
function installHealth(staleAfterDays: number | undefined) {
  installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/health') return { verification: { staleAfterDays } }
    throw httpError(404)
  })
}

// Comfortably past any window this could be run with, so the assertions don't decay with the
// calendar the way a date near the boundary would.
const LONG_AGO = '2019-01-01T08:30:00Z'

describe('VerificationStatusBadge', () => {
  beforeEach(() => installHealth(180))

  it('carries the issue text on hover (title) and to assistive tech (hidden text) for Needs attention', () => {
    renderWithProviders(<VerificationStatusBadge row={{ IsVerified: false, VerificationIssue: 'AeroAPI: duplicate IATA code' }} />)

    const badge = screen.getByText('Needs attention', { exact: false })
    expect(badge).toHaveAttribute('title', 'AeroAPI: duplicate IATA code')
    expect(screen.getByText(': AeroAPI: duplicate IATA code')).toBeInTheDocument()
  })

  it('carries no title or hidden text for Verified, which has no issue', () => {
    renderWithProviders(<VerificationStatusBadge row={{ IsVerified: true, VerificationSource: 'manual' }} />)

    const badge = screen.getByText('Verified · manual')
    expect(badge).not.toHaveAttribute('title')
    // Exact, not substring: proves there's no hidden ": {issue}" suffix riding along.
    expect(badge).toHaveTextContent(/^Verified · manual$/)
  })

  it('carries no title or hidden text for Unverified, which has no issue', () => {
    renderWithProviders(<VerificationStatusBadge row={{ IsVerified: false }} />)

    const badge = screen.getByText('Unverified')
    expect(badge).not.toHaveAttribute('title')
    expect(badge).toHaveTextContent(/^Unverified$/)
  })

  it('marks a row verified longer ago than the window as stale, naming the date and source on hover', async () => {
    renderWithProviders(<VerificationStatusBadge row={{ IsVerified: true, VerificationSource: 'ourairports', VerifiedAt: LONG_AGO }} />)

    const badge = await screen.findByText('Verified · stale', { exact: false })
    expect(badge).toHaveAttribute('title', 'Verified 2019-01-01 08:30 UTC by ourairports — older than the 180-day window')
    expect(screen.getByText(': Verified 2019-01-01 08:30 UTC by ourairports — older than the 180-day window')).toBeInTheDocument()
  })

  it('reads the window from the health report, not a constant of its own', async () => {
    installHealth(30)
    renderWithProviders(<VerificationStatusBadge row={{ IsVerified: true, VerifiedAt: LONG_AGO }} />)

    const badge = await screen.findByText('Verified · stale', { exact: false })
    expect(badge).toHaveAttribute('title', 'Verified 2019-01-01 08:30 UTC — older than the 30-day window')
  })

  /** A failed health read is "window unknown", which must read as the plain Verified badge this
   *  showed before staleness existed — never as a row silently called stale or fresh on a guess. */
  it('falls back to plain Verified when the window cannot be read', async () => {
    installFakeApi(() => { throw httpError(503) })
    renderWithProviders(<VerificationStatusBadge row={{ IsVerified: true, VerificationSource: 'manual', VerifiedAt: LONG_AGO }} />)

    expect(await screen.findByText('Verified · manual')).toBeInTheDocument()
    expect(screen.queryByText('Verified · stale', { exact: false })).not.toBeInTheDocument()
  })
})
