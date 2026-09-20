import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { AdminProviderRouteDto } from '@/api/generated/model'
import { RoutingSection } from './RoutingSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** One route as GET /admin/providers sends it, with the fields a test doesn't care about filled in. */
const route = (overrides: Partial<AdminProviderRouteDto> = {}): AdminProviderRouteDto => ({
  job: 'flight-search-route',
  displayName: 'Route search',
  providers: ['aerodatabox'],
  effectiveProviders: ['aerodatabox'],
  options: ['aerodatabox', 'aeroapi'],
  isDefault: false,
  canChange: true,
  changedUtc: '2026-09-20T09:00:00Z',
  changedBy: 'Ada',
  reason: 'quota restored',
  ...overrides,
})

let sent: SentRequest[]

function renderWith(routes: AdminProviderRouteDto[], onSave?: (req: SentRequest) => unknown) {
  ;({ sent } = installFakeApi(async req => {
    if (req.method === 'GET' && req.url === '/admin/providers') return { routes, operations: [], headroom: [] }
    if (req.method === 'PUT' && req.url.startsWith('/admin/providers/')) {
      return onSave ? onSave(req) : routes[0]
    }
    throw new Error(`unexpected ${req.method} ${req.url}`)
  }))
  return renderWithProviders(<RoutingSection routes={routes} />)
}

describe('RoutingSection', () => {
  beforeEach(() => { sent = [] })

  it('shows the provider actually in force', () => {
    renderWith([route()])
    expect(screen.getByRole('combobox', { name: 'Provider for Route search' })).toHaveValue('aerodatabox')
  })

  // The defect the backend's effectiveProviders/providers split exists to prevent: on the rollback
  // path a stored row says aerodatabox while every search goes to AeroAPI, and a page that showed
  // only the stored value would report a provider nothing is using.
  describe('when configuration overrides the stored choice', () => {
    const overridden = route({ providers: ['aerodatabox'], effectiveProviders: ['aeroapi'], canChange: false })

    it('reports the effective provider, not the stored one', () => {
      renderWith([overridden])
      expect(screen.getByRole('combobox', { name: 'Provider for Route search' })).toHaveValue('aeroapi')
    })

    it('says the stored choice is overridden, naming it', () => {
      renderWith([overridden])
      expect(screen.getByText(/Configuration overrides the stored choice of aerodatabox/)).toBeInTheDocument()
    })
  })

  // JobsSection's rule: a barred control is disabled and explained, never hidden. A missing control
  // leaves an operator hunting for a feature that is present but off-limits.
  it('disables the control and explains why when configuration bars a change', () => {
    renderWith([route({ canChange: false })])

    expect(screen.getByRole('combobox', { name: 'Provider for Route search' })).toBeDisabled()
    expect(screen.getByText(/configures no alternative for this job/)).toBeInTheDocument()
  })

  it('asks for a reason before sending, and sends the chosen provider with it', async () => {
    const user = userEvent.setup()
    renderWith([route()])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider for Route search' }), 'aeroapi')
    // Nothing is sent by choosing: the reason is asked before the write, because the audit row
    // carries it.
    expect(sent.filter(r => r.method === 'PUT')).toHaveLength(0)
    expect(screen.getByText('Change to aeroapi')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Reason (optional)'), 'budget is tight')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(sent.filter(r => r.method === 'PUT')).toHaveLength(1))
    const put = sent.find(r => r.method === 'PUT')!
    expect(put.url).toBe('/admin/providers/flight-search-route')
    expect(put.data).toEqual({ providers: ['aeroapi'], reason: 'budget is tight' })
  })

  it('sends a null reason when none is given, rather than an empty string', async () => {
    const user = userEvent.setup()
    renderWith([route()])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider for Route search' }), 'aeroapi')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(sent.filter(r => r.method === 'PUT')).toHaveLength(1))
    expect(sent.find(r => r.method === 'PUT')!.data).toEqual({ providers: ['aeroapi'], reason: null })
  })

  it('abandons a staged change on cancel without sending anything', async () => {
    const user = userEvent.setup()
    renderWith([route()])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider for Route search' }), 'aeroapi')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(sent.filter(r => r.method === 'PUT')).toHaveLength(0)
    expect(screen.getByRole('combobox', { name: 'Provider for Route search' })).toHaveValue('aerodatabox')
  })

  /**
   * A refusal is not a state change. The staged change stays open with the message rendered
   * verbatim, following JobsSection: the operator can fix the reason and retry, or cancel, without
   * re-navigating the control. A 409 here means configuration barred it; a 400 names the provider
   * it would not accept.
   */
  describe('when the write is refused', () => {
    const refuse = () => {
      throw httpError(409, { title: "'flight-search-route' cannot be changed: this environment configures no alternative provider for it.", status: 409 })
    }

    it('shows the refusal verbatim', async () => {
      const user = userEvent.setup()
      renderWith([route()], refuse)

      await user.selectOptions(screen.getByRole('combobox', { name: 'Provider for Route search' }), 'aeroapi')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(screen.getByText(/configures no alternative provider for it/)).toBeInTheDocument())
    })

    it('leaves the change staged so it can be retried', async () => {
      const user = userEvent.setup()
      renderWith([route()], refuse)

      await user.selectOptions(screen.getByRole('combobox', { name: 'Provider for Route search' }), 'aeroapi')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(screen.getByText(/configures no alternative/)).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
      expect(screen.getByText('Change to aeroapi')).toBeInTheDocument()
    })

    it('never adopts the refused value — cancelling returns the control to what the API believes', async () => {
      const user = userEvent.setup()
      renderWith([route()], refuse)

      await user.selectOptions(screen.getByRole('combobox', { name: 'Provider for Route search' }), 'aeroapi')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      await waitFor(() => expect(screen.getByText(/configures no alternative/)).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByRole('combobox', { name: 'Provider for Route search' })).toHaveValue('aerodatabox')
    })
  })

  it('says so when a value came from configuration rather than an operator', () => {
    renderWith([route({ isDefault: true, changedUtc: null, changedBy: null, reason: null })])
    expect(screen.getByText(/nobody has changed this/)).toBeInTheDocument()
  })

  it('shows who last changed it, when, and why', () => {
    renderWith([route()])
    expect(screen.getByText('by Ada')).toBeInTheDocument()
    expect(screen.getByText('quota restored')).toBeInTheDocument()
  })
})
