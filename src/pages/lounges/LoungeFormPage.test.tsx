import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { renderWithProviders } from '@/test/renderWithProviders'
import { LoungeFormPage } from './LoungeFormPage'

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))

// Shaped like AdminLoungeDto. The API calls this field locationHint; there is no accessInfo.
const LOUNGE = {
  id: 12,
  airportId: 5,
  name: 'Galleries First',
  terminal: '5',
  locationHint: 'After security, near gate A10',
  hours: '05:00–22:00',
  isAirside: true,
  isDomesticOnly: false,
  isInternationalOnly: true,
  amenities: 'Showers',
}

function fakeGet(url: string) {
  if (url === `/admin/lounges/${LOUNGE.id}`) return Promise.resolve({ data: LOUNGE })
  return Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }))
}

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/lounges/new" element={<LoungeFormPage />} />
      <Route path="/lounges/:id/edit" element={<LoungeFormPage />} />
    </Routes>,
    { route },
  )
}

describe('LoungeFormPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset().mockImplementation(fakeGet as typeof apiClient.get)
    vi.mocked(apiClient.put).mockReset().mockResolvedValue({ data: undefined })
    vi.mocked(apiClient.post).mockReset().mockResolvedValue({ data: { id: 99 } })
  })

  it("fills Location hint from the lounge's locationHint", async () => {
    renderAt(`/lounges/${LOUNGE.id}/edit`)

    expect(await screen.findByLabelText('Location hint')).toHaveValue('After security, near gate A10')
  })

  it('saving an edit sends locationHint, not accessInfo', async () => {
    const user = userEvent.setup()
    renderAt(`/lounges/${LOUNGE.id}/edit`)
    const hint = await screen.findByLabelText('Location hint')
    await waitFor(() => expect(hint).toHaveValue('After security, near gate A10'))

    await user.clear(hint)
    await user.type(hint, 'Upstairs, gate B3')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        `/admin/lounges/${LOUNGE.id}`,
        expect.objectContaining({ name: 'Galleries First', locationHint: 'Upstairs, gate B3' }),
      ),
    )
    expect(vi.mocked(apiClient.put).mock.calls[0][1]).not.toHaveProperty('accessInfo')
  })

  it('creating a lounge sends locationHint', async () => {
    const user = userEvent.setup()
    renderAt('/lounges/new')

    await user.type(await screen.findByLabelText('Airport ID'), '5')
    await user.type(screen.getByLabelText('Name'), 'New Lounge')
    await user.type(screen.getByLabelText('Location hint'), 'Level 2')
    await user.click(screen.getByRole('button', { name: 'Create lounge' }))

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/admin/lounges',
        expect.objectContaining({ airportId: 5, name: 'New Lounge', locationHint: 'Level 2' }),
      ),
    )
  })
})
