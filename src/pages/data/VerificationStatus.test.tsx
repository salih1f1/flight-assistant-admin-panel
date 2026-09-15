import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerificationStatusBadge } from './VerificationStatus'

describe('VerificationStatusBadge', () => {
  it('carries the issue text on hover (title) and to assistive tech (hidden text) for Needs attention', () => {
    render(<VerificationStatusBadge row={{ IsVerified: false, VerificationIssue: 'AeroAPI: duplicate IATA code' }} />)

    const badge = screen.getByText('Needs attention', { exact: false })
    expect(badge).toHaveAttribute('title', 'AeroAPI: duplicate IATA code')
    expect(screen.getByText(': AeroAPI: duplicate IATA code')).toBeInTheDocument()
  })

  it('carries no title or hidden text for Verified, which has no issue', () => {
    render(<VerificationStatusBadge row={{ IsVerified: true, VerificationSource: 'manual' }} />)

    const badge = screen.getByText('Verified · manual')
    expect(badge).not.toHaveAttribute('title')
    // Exact, not substring: proves there's no hidden ": {issue}" suffix riding along.
    expect(badge).toHaveTextContent(/^Verified · manual$/)
  })

  it('carries no title or hidden text for Unverified, which has no issue', () => {
    render(<VerificationStatusBadge row={{ IsVerified: false }} />)

    const badge = screen.getByText('Unverified')
    expect(badge).not.toHaveAttribute('title')
    expect(badge).toHaveTextContent(/^Unverified$/)
  })
})
