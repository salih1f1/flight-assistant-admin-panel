import { describe, expect, it } from 'vitest'
import { roleClaimVerdict } from './roleClaimVerdict'

describe('roleClaimVerdict', () => {
  /** The normal state. Saying "everything is fine" over the bottom of every page is
   *  chrome, not a diagnostic, so there is nothing to render. */
  it('has nothing to say when the access token grants admin', () => {
    expect(
      roleClaimVerdict({ idTokenRoles: ['Admin'], accessTokenRoles: ['admin'] }),
    ).toBeNull()
    expect(roleClaimVerdict({ accessTokenRoles: ['reader', 'admin'] })).toBeNull()
  })

  /** Reading the access token is asynchronous: speaking before it is read would flash the
   *  overlay on every load of an account that turns out to be fine. */
  it('has nothing to say while the access token is still being read', () => {
    expect(roleClaimVerdict(null)).toBeNull()
  })

  /** The failure this overlay exists for: id token "Admin", access token "admin". */
  it('reports a mismatch between the roles and the role the API compares', () => {
    const verdict = roleClaimVerdict({ idTokenRoles: ['Admin'], accessTokenRoles: ['Admin'] })

    expect(verdict?.severity).toBe('error')
    expect(verdict?.message).toContain('["Admin"]')
    expect(verdict?.message).toContain('admin')
  })

  it('reports an access token carrying no roles claim at all', () => {
    const verdict = roleClaimVerdict({ idTokenRoles: ['Admin'], accessTokenRoles: undefined })

    expect(verdict?.severity).toBe('error')
    expect(verdict?.message).toContain('roles')
  })

  /** An empty array is a roles claim that grants nothing, not a missing one. */
  it('reports a roles claim that grants nothing', () => {
    expect(roleClaimVerdict({ accessTokenRoles: [] })?.severity).toBe('error')
  })

  it('reports an access token that could not be acquired, with the reason', () => {
    const verdict = roleClaimVerdict({ error: 'interaction_required' })

    expect(verdict?.severity).toBe('warning')
    expect(verdict?.message).toContain('interaction_required')
  })

  /** An error is about the token, not about the roles: it must not be reported as a
   *  mismatch just because no roles came back with it. */
  it('prefers the acquisition error over anything the missing roles would imply', () => {
    expect(roleClaimVerdict({ error: 'network error', accessTokenRoles: undefined })?.severity).toBe(
      'warning',
    )
  })
})
