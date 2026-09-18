import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

vi.mock('@/auth/useAdminAuth', () => ({
  useAdminAuth: () => ({ logout: vi.fn(), account: { username: 'admin@example.com' } }),
}))

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '*', element: <Sidebar /> }], { initialEntries: [entry] })
  render(<RouterProvider router={router} />)
  return router
}

const menu = () => screen.getByRole('navigation', { name: 'Main' })
const groupButton = (name: string) => within(menu()).getByRole('button', { name })
const current = () => within(menu()).getAllByRole('link').filter(l => l.getAttribute('aria-current') === 'page').map(l => l.textContent)

// Every page and every raw table the API browses, by domain, except the raw audit log, which the
// Audit log page covers. There is no separate Data entry, and a list opens the raw grid.
const GROUPS: [string, [string, string][]][] = [
  ['Travelers', [['Travelers', '/data/travelers'], ['Device Tokens', '/data/device-tokens'], ['Loyalty Memberships', '/data/traveler-loyalty-memberships']]],
  ['Flights', [['Flights', '/data/flights'], ['Track a flight', '/flights/track'], ['Traveler Flights', '/data/traveler-flights'], ['Flight Statuses', '/data/flight-statuses'], ['Flight Status Events', '/data/flight-status-events']]],
  ['Lounges', [['Lounges', '/data/lounges'], ['Lounge Providers', '/data/lounge-providers'], ['Provider Links', '/data/lounge-provider-links']]],
  ['Loyalty', [['Loyalty Programs', '/data/loyalty-programs'], ['Program Kinds', '/data/loyalty-program-kinds'], ['Tiers', '/data/loyalty-tiers']]],
  ['Reference data', [['Airlines', '/data/airlines'], ['Airports', '/data/airports'], ['Alliances', '/data/alliances'], ['Countries', '/data/countries']]],
  ['System', [['System health', '/health'], ['Import', '/import'], ['Audit log', '/audit'], ['Verification Requests', '/data/verification-requests'], ['Tests', '/tests'], ['Seed Versions', '/data/seed-versions']]],
]

describe('Sidebar', () => {
  it('groups every page and raw table by domain, with Dashboard on its own', async () => {
    const user = userEvent.setup()
    renderAt('/')

    expect(within(menu()).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(within(menu()).getAllByRole('button').map(b => b.textContent)).toEqual(GROUPS.map(([group]) => group))

    for (const [group, items] of GROUPS) {
      await user.click(groupButton(group))
      const list = within(menu()).getByRole('list', { name: group })
      expect(within(list).getAllByRole('link').map(l => [l.textContent, l.getAttribute('href')])).toEqual(items)
    }
    expect(within(menu()).queryByRole('link', { name: 'Data' })).not.toBeInTheDocument()
  })

  it('opens only the group holding the current page', () => {
    renderAt('/data/flight-statuses')

    for (const [group] of GROUPS) {
      expect(groupButton(group)).toHaveAttribute('aria-expanded', String(group === 'Flights'))
    }
    expect(within(menu()).queryByRole('list', { name: 'Travelers' })).not.toBeInTheDocument()
    expect(current()).toEqual(['Flight Statuses'])
  })

  it.each(['/data/airlines', '/data/airlines/7', '/airlines/new'])('highlights Airlines on %s: its grid, records and create page', path => {
    renderAt(path)

    expect(groupButton('Reference data')).toHaveAttribute('aria-expanded', 'true')
    expect(current()).toEqual(['Airlines'])
  })

  it.each([['/flights/track', 'Track a flight'], ['/flights/42', 'Flights']])('highlights only the most specific entry on %s', (path, entry) => {
    renderAt(path)

    expect(groupButton('Flights')).toHaveAttribute('aria-expanded', 'true')
    expect(current()).toEqual([entry])
  })

  it("doesn't highlight a managed item on another table of its domain", () => {
    renderAt('/data/flight-status-events')

    expect(current()).toEqual(['Flight Status Events'])
  })

  it('highlights the audit log on its page', () => {
    renderAt('/audit')

    expect(groupButton('System')).toHaveAttribute('aria-expanded', 'true')
    expect(current()).toEqual(['Audit log'])
  })

  it('highlights Dashboard only on the dashboard', () => {
    renderAt('/')
    expect(current()).toEqual(['Dashboard'])
    for (const [group] of GROUPS) expect(groupButton(group)).toHaveAttribute('aria-expanded', 'false')
  })

  it('a group header closes and reopens its group', async () => {
    const user = userEvent.setup()
    renderAt('/travelers/00000000-0000-0000-0000-000000000001')
    expect(current()).toEqual(['Travelers'])

    await user.click(groupButton('Travelers'))
    expect(groupButton('Travelers')).toHaveAttribute('aria-expanded', 'false')
    expect(within(menu()).queryByRole('list', { name: 'Travelers' })).not.toBeInTheDocument()

    await user.click(groupButton('Travelers'))
    expect(groupButton('Travelers')).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu()).getByRole('list', { name: 'Travelers' })).toBeInTheDocument()
  })

  it('opens the group of a page reached from another group', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')

    await user.click(groupButton('Reference data'))
    await user.click(within(menu()).getByRole('link', { name: 'Alliances' }))

    expect(router.state.location.pathname).toBe('/data/alliances')
    expect(current()).toEqual(['Alliances'])
    expect(groupButton('Reference data')).toHaveAttribute('aria-expanded', 'true')
  })
})
