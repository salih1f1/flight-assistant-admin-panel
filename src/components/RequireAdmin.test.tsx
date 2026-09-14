import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useAdminAuth } from '@/auth/useAdminAuth'
import { RequireAdmin } from './RequireAdmin'

type Auth = ReturnType<typeof useAdminAuth>

let auth: Auth
vi.mock('@/auth/useAdminAuth', () => ({ useAdminAuth: () => auth }))

const signedIn = (overrides: Partial<Auth>): Auth => ({
  isAuthenticated: true,
  isAdmin: false,
  isRoleResolved: true,
  account: { username: 'someone@example.com' } as Auth['account'],
  login: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn(),
  ...overrides,
})

function renderGate() {
  const router = createMemoryRouter([
    { element: <RequireAdmin />, children: [{ path: '/', element: <p>Admin app</p> }] },
  ])
  render(<RouterProvider router={router} />)
}

describe('RequireAdmin', () => {
  beforeEach(() => {
    auth = signedIn({})
  })

  it('on Access Denied, shows the signed-in account and signs out', async () => {
    const user = userEvent.setup()
    renderGate()

    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument()
    expect(screen.getByText('someone@example.com')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(auth.logout).toHaveBeenCalledTimes(1)
    expect(auth.login).not.toHaveBeenCalled()
    expect(screen.queryByText('Admin app')).not.toBeInTheDocument()
  })

  it('signed out, offers sign in and no Sign out', () => {
    auth = signedIn({ isAuthenticated: false, account: undefined })
    renderGate()

    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('while the role is being checked, shows neither the denial nor Sign out', () => {
    auth = signedIn({ isRoleResolved: false })
    renderGate()

    expect(screen.getByText('Checking permissions…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Access Denied' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('lets an admin into the app', () => {
    auth = signedIn({ isAdmin: true })
    renderGate()

    expect(screen.getByText('Admin app')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Access Denied' })).not.toBeInTheDocument()
  })
})
