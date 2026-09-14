import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AirlinesPage } from './AirlinesPage'

// Mocked at the HTTP boundary, so the test runs the real generated client, hooks, page and table.
vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like AirlineAdminDto.
const makeAirlines = () =>
  Array.from({ length: 692 }, (_, i) => ({
    id: i + 1,
    iata: null,
    icao: null,
    name: `Airline ${String(i + 1).padStart(3, '0')}`,
    countryCode: 'XX',
    allianceCode: null,
  }))

let airlines: ReturnType<typeof makeAirlines>
let sent: SentRequest[]

describe('AirlinesPage', () => {
  beforeEach(() => {
    airlines = makeAirlines()
    ;({ sent } = installFakeApi(req => {
      if (req.method === 'GET' && req.url === '/admin/airlines') return pagedResult(airlines, req.params)
      const byId = req.url.match(/^\/admin\/airlines\/(\d+)$/)
      if (req.method === 'DELETE' && byId) {
        airlines = airlines.filter(a => a.id !== Number(byId[1]))
        return undefined
      }
      throw httpError(404)
    }))
  })

  it('lists the airlines on the first page the API returns', async () => {
    renderWithProviders(<AirlinesPage />)

    expect(await screen.findByText('Airline 001')).toBeInTheDocument()
    expect(screen.getByText('Airline 050')).toBeInTheDocument()
    expect(screen.queryByText('Airline 051')).not.toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('links to the airlines raw table from the Manage | Raw data tabs', async () => {
    renderWithProviders(<AirlinesPage />)
    await screen.findByText('Airline 001')

    const views = screen.getByRole('navigation', { name: 'Views' })
    expect(within(views).getByRole('link', { name: 'Raw data' })).toHaveAttribute('href', '/data/airlines')
  })

  it('shows the position and total from the API, not the number of rows on screen', async () => {
    renderWithProviders(<AirlinesPage />)

    expect(await screen.findByText('Page 1 of 14 · 692 total')).toBeInTheDocument()
  })

  it('shows why the list failed to load instead of "No results."', async () => {
    installFakeApi(() => {
      throw httpError(500)
    })
    renderWithProviders(<AirlinesPage />)

    expect(await screen.findByText('Could not load: Request failed with status code 500')).toBeInTheDocument()
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument()
  })

  it('Next requests page 2 from the API and replaces the rows', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AirlinesPage />)
    await screen.findByText('Airline 001')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Airline 051')).toBeInTheDocument()
    expect(screen.queryByText('Airline 001')).not.toBeInTheDocument()
    expect(screen.getByText('Page 2 of 14 · 692 total')).toBeInTheDocument()
    expect(sent[sent.length - 1]).toEqual(
      expect.objectContaining({ method: 'GET', url: '/admin/airlines', params: { Page: 2, PageSize: 50 } }),
    )
  })

  it('reaches the last airline and stops there', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AirlinesPage />)
    await screen.findByText('Page 1 of 14 · 692 total')

    for (let page = 2; page <= 14; page++) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
      await screen.findByText(`Page ${page} of 14 · 692 total`)
    }

    expect(await screen.findByText('Airline 692')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('deleting an airline sends DELETE and drops it from the list without a reload', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AirlinesPage />)
    const row = (await screen.findByText('Airline 001')).closest('tr')!

    // The row's actions are icon buttons: edit, then delete.
    await user.click(within(row).getAllByRole('button')[1])
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Airline 001')).not.toBeInTheDocument())
    expect(screen.getByText('Page 1 of 14 · 691 total')).toBeInTheDocument()
    expect(sent).toContainEqual(expect.objectContaining({ method: 'DELETE', url: '/admin/airlines/1' }))
  })
})
