import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** Every column GET /admin/data/airports sends, in the order it sends them. */
const AIRPORT_COLUMNS = [
  'Id', 'Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt',
  'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue',
]

/** Hidden before airports had a list of its own: bookkeeping, and IsVerified beside the icon. */
const BOOKKEEPING = ['IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue']

const airport = (id: number, iata: string, name: string) => ({
  Id: id,
  Iata: iata,
  Icao: `EG${iata}`,
  Name: name,
  City: 'London',
  CountryCode: 'GB',
  Latitude: 51.4706,
  Longitude: -0.461941,
  ElevationFt: 83,
  IsVerified: false,
  VerifiedAt: null,
  VerifiedBy: null,
  VerificationSource: null,
  VerificationIssue: null,
})

const AIRPORTS = [airport(11, 'LHR', 'London Heathrow'), airport(12, 'LGW', 'London Gatwick')]

function install() {
  installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(404)
    if (req.url === '/admin/data/tables') return [{ slug: 'airports', displayName: 'Airports', rowCount: AIRPORTS.length }]
    if (req.url === '/admin/data/airports') return pagedResult(AIRPORTS, req.params)
    if (req.url === '/admin/verification-requests') return []
    throw httpError(404)
  })
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

beforeEach(install)

describe('The airports grid, as a list', () => {
  /**
   * The two codes, the name, and where it is: what an airport is found by. A coordinate pair and an
   * elevation are read once you have found it — they are never what you scan a list for, and three
   * numeric columns push the rest of the row sideways.
   */
  it('shows the codes, the name and the place, and not the coordinates', async () => {
    renderAt('/data/airports')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Iata', 'Icao', 'Name', 'City', 'CountryCode'])
  })

  it('brings every column back behind the toggle, in the order the API sends them', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Show 9 hidden columns' }))

    expect(dataHeaders()).toEqual(AIRPORT_COLUMNS)
  })

  it('hides them again, so the trimmed grid is a toggle away and not a one-way door', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Show 9 hidden columns' }))

    await user.click(screen.getByRole('button', { name: 'Hide 9 columns' }))

    expect(dataHeaders()).toEqual(['Iata', 'Icao', 'Name', 'City', 'CountryCode'])
  })
})

describe('Verifying an airport', () => {
  /*
   * Airports have a CHECKED_COLUMNS entry, so the dialog asks about the fields a source actually
   * checks rather than the grid's five. Trimming the grid must not narrow "verify this airport"
   * into confirming only what happens to be on screen — the same trap LoungesGridColumns guards.
   */
  it('asks about the columns the grid leaves off, not only the five it shows', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByRole('table')

    await user.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Verify' }))

    const dialog = within(screen.getByRole('dialog'))
    for (const name of ['Latitude', 'Longitude', 'ElevationFt'].filter(c => !BOOKKEEPING.includes(c))) {
      expect(dialog.getByText(name)).toBeInTheDocument()
    }
  })
})
