import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoleClaimDiagnostic } from './RoleClaimDiagnostic'

vi.mock('./msalConfig', () => ({ apiRequest: { scopes: ['api://flight-assistant/.default'] } }))

let accounts: { idTokenClaims?: Record<string, unknown> }[] = []
let acquireTokenSilent = vi.fn()

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts, instance: { acquireTokenSilent } }),
}))

/** An unsigned JWT carrying the claims the diagnostic reads. The panel decodes rather than
 *  verifies, so an unsigned token exercises the real path through `decodeJwtPayload`. */
function accessToken(claims: Record<string, unknown>) {
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${payload}.signature`
}

const overlay = () => screen.findByText(/roles claim diagnostic/i)

describe('RoleClaimDiagnostic', () => {
  beforeEach(() => {
    accounts = [{ idTokenClaims: { roles: ['Admin'] } }]
    acquireTokenSilent = vi
      .fn()
      .mockResolvedValue({ accessToken: accessToken({ roles: ['admin'] }) })
  })

  /** The normal state: the id token says "Admin", the access token says "admin", and the
   *  API will authorise. Nothing to explain, so nothing over the bottom of the page. */
  it('stays out of the way when the access token grants admin', async () => {
    render(<RoleClaimDiagnostic />)
    await waitFor(() => expect(acquireTokenSilent).toHaveBeenCalled())

    await expect(overlay()).rejects.toThrow()
  })

  it('appears when the access token roles do not match the role the API compares', async () => {
    acquireTokenSilent = vi
      .fn()
      .mockResolvedValue({ accessToken: accessToken({ roles: ['Admin'] }) })
    render(<RoleClaimDiagnostic />)

    expect(await overlay()).toBeInTheDocument()
    expect(screen.getByText(/Mismatch/)).toBeInTheDocument()
  })

  it('appears when the access token carries no roles claim', async () => {
    acquireTokenSilent = vi.fn().mockResolvedValue({ accessToken: accessToken({ aud: 'api-id' }) })
    render(<RoleClaimDiagnostic />)

    expect(await screen.findByText(/No `roles` claim/)).toBeInTheDocument()
  })

  it('appears when the access token could not be acquired', async () => {
    acquireTokenSilent = vi.fn().mockRejectedValue(new Error('interaction_required'))
    render(<RoleClaimDiagnostic />)

    expect(await screen.findByText(/interaction_required/)).toBeInTheDocument()
  })

  it('renders nothing at all when no one is signed in', async () => {
    accounts = []
    render(<RoleClaimDiagnostic />)

    expect(acquireTokenSilent).not.toHaveBeenCalled()
    await expect(overlay()).rejects.toThrow()
  })
})
