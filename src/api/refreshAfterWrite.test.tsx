import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { createQueryClient } from '@/api/queryClient'
import { AirlineForm } from '@/pages/airlines/AirlineFormPage'
import { AllianceAirlinesSection } from '@/pages/alliances/AllianceAirlinesSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const ALLIANCES = [{ id: 2, code: 'SA', name: 'Star Alliance' }]

/** Turkish Airlines, the airline being edited, and the alliance it is about to join. */
let airline = { id: 12, iata: 'TK', icao: 'THY', name: 'Turkish Airlines', countryCode: 'TR', allianceCode: null as string | null }

const members = () => (airline.allianceCode === 'SA'
  ? [{ id: 12, iata: 'TK', icao: 'THY', name: 'Turkish Airlines', countryCode: 'TR', loyaltyProgramName: null }]
  : [])

function api(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/refdata/alliances') return ALLIANCES
  if (req.method === 'GET' && req.url === '/admin/airlines/12') return airline
  if (req.method === 'GET' && req.url === '/admin/alliances/2/detail') return { id: 2, code: 'SA', name: 'Star Alliance', airlines: members() }
  if (req.method === 'PUT' && req.url === '/admin/airlines/12') {
    airline = { ...airline, ...(req.data as object) }
    return undefined
  }
  throw httpError(404)
}

beforeEach(() => {
  airline = { id: 12, iata: 'TK', icao: 'THY', name: 'Turkish Airlines', countryCode: 'TR', allianceCode: null }
  installFakeApi(api)
})

/**
 * The bug (#180): a write refreshed only the keys its own helper happened to name, so a view of
 * another entity the write reaches — an alliance's airlines, after an airline joined it — kept
 * serving the cache, and a browser reload was the only way to see the change.
 */
describe('what a write refreshes', () => {
  it("shows an airline on its alliance's page as soon as it joins, with no reload", async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          {/* Both open at once stands in for visiting one page and then the other: one cache,
              no remount, exactly what a reload would have to be doing the work for. */}
          <AirlineForm id={12} onDone={() => {}} />
          <AllianceAirlinesSection id="2" />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText(/No airlines are in this alliance/)
    await waitFor(() => expect(screen.getByLabelText('Alliance')).toHaveValue(''))

    await user.selectOptions(screen.getByLabelText('Alliance'), 'SA')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByTestId('alliance-airline-name')).toHaveTextContent('Turkish Airlines')
  })

  it('refreshes a query no write names, since the next cross-entity view is one forgotten key away', async () => {
    const queryClient = createQueryClient()
    let fetched = 0
    function Probe() {
      // A query nothing invalidates by name: the audit log and the dashboard counts are real ones.
      const { data } = useQuery({ queryKey: ['/admin/audit-log'], queryFn: () => ++fetched })
      const write = useMutation({ mutationFn: async () => undefined })
      return <button type="button" onClick={() => write.mutate()}>{`fetched ${data}`}</button>
    }

    render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>)
    await screen.findByRole('button', { name: 'fetched 1' })

    await userEvent.setup().click(screen.getByRole('button'))

    await screen.findByRole('button', { name: 'fetched 2' })
  })
})
