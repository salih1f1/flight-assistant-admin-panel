import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { AdminProviderOperationDto } from '@/api/generated/model'
import { CallMapSection } from './CallMapSection'

const operation = (overrides: Partial<AdminProviderOperationDto> = {}): AdminProviderOperationDto => ({
  trigger: 'Searching',
  operation: 'GET /flights/search — both airports, no flight number',
  providers: ['aerodatabox'],
  routingKey: 'flight-search-route',
  fixedReason: null,
  listPrice: 'AeroDataBox $0.00 (free tier, 2 calls per search)',
  note: null,
  ...overrides,
})

describe('CallMapSection', () => {
  it('groups rows under their trigger, in the order the API sent them', () => {
    render(<CallMapSection operations={[
      operation({ trigger: 'Tracking a flight', operation: 'POST /flights', providers: [], routingKey: null, fixedReason: 'Tracking itself calls no provider.' }),
      operation({ trigger: 'Searching' }),
      operation({ trigger: 'Verification', operation: 'Airline checks', providers: ['aeroapi'], routingKey: 'verification-airline' }),
    ]} />)

    const headings = screen.getAllByRole('cell').filter(cell => /^(Tracking a flight|Searching|Verification)$/.test(cell.textContent ?? ''))
    // Authored order, not alphabetical — the map is written in the order an operator walks it.
    expect(headings.map(h => h.textContent)).toEqual(['Tracking a flight', 'Searching', 'Verification'])
  })

  // The fixed rows are where the interesting constraints live, so they are shown with their reason
  // rather than omitted — a map of only the adjustable half does not answer "what gets called when".
  it('shows a fixed row with the reason it is fixed', () => {
    render(<CallMapSection operations={[operation({
      operation: 'GET /flights/search — anchored on a flight number',
      routingKey: null,
      fixedReason: 'AeroDataBox resolves a marketing number to its operator (6E4120 -> TK 1028), so routing this there could change which flight a traveler tracks.',
      providers: ['aeroapi'],
    })]} />)

    expect(screen.getByText(/could change which flight a traveler tracks/)).toBeInTheDocument()
    expect(screen.queryByText('Switchable above')).not.toBeInTheDocument()
  })

  it('marks a switchable row as switchable', () => {
    render(<CallMapSection operations={[operation()]} />)
    expect(screen.getByText('Switchable above')).toBeInTheDocument()
  })

  // The one consequence an operator cannot infer from the row itself, and it bites at exactly the
  // moment they would reach for this switch.
  it('shows the note on a row that carries one', () => {
    render(<CallMapSection operations={[operation({
      note: 'Routing this to AeroAPI puts it back behind AeroApiFlightSearchBudgetDecorator, which refuses from SoftLimit (80% of AeroApi:MonthlyBudgetUsd) onward.',
    })]} />)

    expect(screen.getByText(/refuses from SoftLimit/)).toBeInTheDocument()
  })

  it('says a row calls no provider directly rather than leaving it blank', () => {
    render(<CallMapSection operations={[operation({
      operation: 'POST /flights',
      providers: [],
      routingKey: null,
      fixedReason: 'Tracking itself calls no provider.',
    })]} />)

    expect(screen.getByText('none directly')).toBeInTheDocument()
  })

  it('renders several providers in call order', () => {
    render(<CallMapSection operations={[operation({ providers: ['ourairports', 'aeroapi'], routingKey: 'verification-airport' })]} />)
    expect(screen.getByText('ourairports → aeroapi')).toBeInTheDocument()
  })

  it('shows each row list price', () => {
    render(<CallMapSection operations={[operation()]} />)
    const row = screen.getByText(/both airports, no flight number/).closest('tr')!
    expect(within(row).getByText(/free tier, 2 calls per search/)).toBeInTheDocument()
  })
})
