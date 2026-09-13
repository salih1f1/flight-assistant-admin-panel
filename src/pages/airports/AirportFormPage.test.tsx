import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AirportFormPage } from './AirportFormPage'

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))

// Shaped like AirportAdminDto.
const AIRPORTS: Record<string, object> = {
  '/admin/airports/7': { id: 7, iata: 'XXA', icao: null, name: 'No Coordinates', city: 'Nowhere', countryCode: 'GB', latitude: null, longitude: null, elevationFt: null },
  '/admin/airports/8': { id: 8, iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', countryCode: 'GB', latitude: 51.47, longitude: -0.4543, elevationFt: 83 },
}

function fakeGet(url: string) {
  if (AIRPORTS[url]) return Promise.resolve({ data: AIRPORTS[url] })
  return Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }))
}

function renderEdit(id: number) {
  return renderWithProviders(
    <Routes>
      <Route path="/airports/:id/edit" element={<AirportFormPage />} />
    </Routes>,
    { route: `/airports/${id}/edit` },
  )
}

/** The body of the one PUT the form sent. */
async function savedAirport() {
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1))
  return vi.mocked(apiClient.put).mock.calls[0][1] as Record<string, unknown>
}

describe('AirportFormPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(fakeGet as typeof apiClient.get)
    vi.mocked(apiClient.put).mockReset().mockResolvedValue({ data: undefined })
    vi.mocked(apiClient.post).mockReset().mockResolvedValue({ data: { id: 99 } })
  })

  it('saving an airport without coordinates does not turn them into 0,0', async () => {
    const user = userEvent.setup()
    renderEdit(7)
    await screen.findByDisplayValue('No Coordinates')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const body = await savedAirport()
    expect(body.name).toBe('No Coordinates')
    expect(body.latitude).toBeUndefined()
    expect(body.longitude).toBeUndefined()
    expect(body.elevationFt).toBeUndefined()
  })

  it('saving keeps real coordinates and elevation', async () => {
    const user = userEvent.setup()
    renderEdit(8)
    await screen.findByDisplayValue('Heathrow')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await savedAirport()).toEqual(expect.objectContaining({ latitude: 51.47, longitude: -0.4543, elevationFt: 83 }))
  })

  it('an explicit 0 is saved as 0, not dropped', async () => {
    const user = userEvent.setup()
    const { container } = renderEdit(7)
    await screen.findByDisplayValue('No Coordinates')

    await user.type(container.querySelector<HTMLInputElement>('input[name="latitude"]')!, '0')
    await user.type(container.querySelector<HTMLInputElement>('input[name="elevationFt"]')!, '0')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const body = await savedAirport()
    expect(body.latitude).toBe(0)
    expect(body.elevationFt).toBe(0)
    expect(body.longitude).toBeUndefined()
  })
})
