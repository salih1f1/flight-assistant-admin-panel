import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { AzureBudgetDto } from '@/api/generated/model'
import { AzureSpendSection } from './AzureSpendSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** As GET /admin/usage/azure sends it, with the fields a test doesn't care about filled in. */
const budget = (overrides: Partial<AzureBudgetDto> = {}): AzureBudgetDto => ({
  state: 'Ok',
  budgetName: 'monthly',
  budgetAmount: 50,
  currentSpendAmount: 12.34,
  currency: 'USD',
  periodStartUtc: '2026-09-01T00:00:00Z',
  periodEndUtc: '2026-09-30T23:59:59Z',
  // Always null: neither Cost Management endpoint reports a freshness timestamp.
  dataAsOfUtc: null,
  message: null,
  ...overrides,
})

function renderWith(answer: () => unknown) {
  installFakeApi(async req => {
    if (req.method === 'GET' && req.url === '/admin/usage/azure') return answer()
    throw new Error(`unexpected ${req.method} ${req.url}`)
  })
  return renderWithProviders(<AzureSpendSection />)
}

describe('AzureSpendSection', () => {
  it('shows spend against the budget', async () => {
    renderWith(() => budget())

    expect(await screen.findByText(/\$12\.34 of \$50\.00/)).toBeInTheDocument()
  })

  // The billing currency is a property of the account. Formatting EUR as dollars would misstate
  // the figure by a meaningful factor.
  it('formats amounts in the reported currency, not dollars', async () => {
    renderWith(() => budget({ currency: 'EUR', budgetAmount: 40, currentSpendAmount: 9.5 }))

    const gauge = await screen.findByText(/9\.50.*40\.00/)
    expect(gauge).toBeInTheDocument()
    expect(gauge.textContent).not.toContain('$')
  })

  // This sits directly under the near-live AeroAPI gauge. Two cost figures side by side invite the
  // reader to assume they mean the same kind of thing, and they do not.
  it('says Azure reports on a delay', async () => {
    renderWith(() => budget())

    expect(await screen.findByText(/delay/i)).toBeInTheDocument()
  })

  // dataAsOfUtc is always null — neither Azure endpoint reports one. Anything claiming a precise
  // age would be inventing it.
  it('never claims a precise age for the figures', async () => {
    renderWith(() => budget())
    await screen.findByText(/of \$50\.00/)

    expect(screen.queryByText(/as of \d/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/updated \d/i)).not.toBeInTheDocument()
  })

  // The rule the whole feature rests on: being refused must never look like spending nothing.
  it('names the role when not authorized, and draws no gauge', async () => {
    renderWith(() => budget({
      state: 'NotAuthorized', budgetAmount: null, currentSpendAmount: null, currency: null,
      message: 'Grant the API\'s managed identity the Cost Management Reader role on the subscription.',
    }))

    expect(await screen.findByText(/Cost Management Reader/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument()
  })

  it('renders a not-authorized subscription in gray, not red', async () => {
    renderWith(() => budget({
      state: 'NotAuthorized', budgetAmount: null, currentSpendAmount: null, currency: null,
      message: 'Grant the role.',
    }))

    expect(await screen.findByText(/not authorized/i)).toHaveClass('text-gray-500')
  })

  it('renders an unconfigured subscription in gray, not red', async () => {
    renderWith(() => budget({
      state: 'NotConfigured', budgetAmount: null, currentSpendAmount: null, currency: null,
      message: 'AzureCost:SubscriptionId is not set.',
    }))

    expect(await screen.findByText(/not configured/i)).toHaveClass('text-gray-500')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows spend but no gauge when no budget is defined', async () => {
    renderWith(() => budget({ state: 'NoBudget', budgetAmount: null, currentSpendAmount: 12.34 }))

    expect(await screen.findByText(/no budget/i)).toBeInTheDocument()
    expect(screen.getByText(/12\.34/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('reports an outage as unavailable, not as zero spend', async () => {
    renderWith(() => budget({
      state: 'Unavailable', budgetAmount: null, currentSpendAmount: null, currency: null,
      message: 'Azure Cost Management returned HTTP 503.',
    }))

    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  // An Azure budget can be quarterly or annual. Calling a quarterly budget "this month" would
  // misrepresent both the figure and how much of the period is left.
  it('names the real period rather than calling it this month', async () => {
    renderWith(() => budget({
      periodStartUtc: '2026-07-01T00:00:00Z', periodEndUtc: '2026-09-30T23:59:59Z',
    }))

    expect(await screen.findByText(/2026-07-01.*2026-09-30/)).toBeInTheDocument()
    expect(screen.queryByText(/this month/i)).not.toBeInTheDocument()
  })

  it('says when the API cannot be read at all', async () => {
    renderWith(() => { throw httpError(503, { title: 'Service unavailable.', status: 503 }) })

    expect(await screen.findByRole('alert')).toHaveTextContent(/Service unavailable/)
  })

  it('draws the gauge proportionally', async () => {
    renderWith(() => budget({ budgetAmount: 100, currentSpendAmount: 25 }))

    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  // A budget already overspent must not draw a bar past its own track.
  it('caps the gauge at full when spend is over budget', async () => {
    renderWith(() => budget({ budgetAmount: 50, currentSpendAmount: 75 }))

    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText(/over budget/i)).toBeInTheDocument()
  })
})
