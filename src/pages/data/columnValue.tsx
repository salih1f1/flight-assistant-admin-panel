import type { ReactNode } from 'react'
import {
  AirlineName, AirportCode, AirportName, AllianceName, FlightName, LoungeName, LoungeProviderName,
  LoyaltyProgramKindName, LoyaltyProgramName, LoyaltyTierName, TravelerName,
} from '@/components/ReferenceNames'
import { formatUtcMinute } from '@/lib/formatUtc'
import { lookup } from './records'

/*
 * What a raw table's value means, for the two views that show raw rows: the grid and the record
 * page. Rows arrive as the API stores them — a column holding another record's key is a bare id,
 * and a timestamp is an ISO string down to the microsecond — so a row of a join table like
 * traveler-flights is a wall of guids that says nothing about the traveler or the flight it joins.
 *
 * Both callers keep their own handling of null, masked and long values; this only answers
 * "is there a better way to show this column?", and returns undefined when there isn't.
 */

type Row = Record<string, unknown>

const asId = (value: unknown) => (typeof value === 'number' ? value : null)

/**
 * Columns holding another record's key, by the name every table gives them, shown as that
 * record's name and linked to it. A table's own key column is deliberately absent: `Id` is the
 * value an admin copies, filters on and pastes into a bug report, so it stays as it is.
 */
const REFERENCES: Record<string, (value: unknown, row: Row) => ReactNode> = {
  AirlineId: value => <AirlineName id={asId(value)} />,
  AirportId: value => <AirportName id={asId(value)} />,
  DepartureAirportId: value => <AirportName id={asId(value)} />,
  ArrivalAirportId: value => <AirportName id={asId(value)} />,
  ProgramId: value => <LoyaltyProgramName id={asId(value)} />,
  // The only place the API names a tier is inside its program, so this one reads its row's sibling
  // column rather than its own value alone.
  TierId: (value, row) => <LoyaltyTierName programId={asId(row.ProgramId)} tierId={asId(value)} />,
  KindId: value => <LoyaltyProgramKindName id={asId(value)} />,
  TravelerId: value => <TravelerName id={typeof value === 'string' ? value : null} />,
  FlightId: value => <FlightName id={asId(value)} />,
  LoungeId: value => <LoungeName id={asId(value)} />,
  // ProviderId belongs to one table, the lounge/provider join, and means a lounge provider there.
  ProviderId: value => <LoungeProviderName id={asId(value)} />,
  // The one reference the API stores as a code rather than an id (programs, tiers and airlines all
  // carry it), which is why it is named rather than linked: see AllianceName.
  AllianceCode: value => <AllianceName code={typeof value === 'string' ? value : null} />,
}

/**
 * How a column reads where a name would not fit: an airport becomes the three letters a route is
 * made of, with the full name on hover. Only the grid asks for this — the record page has room to
 * spell everything out, and shows the same columns through REFERENCES above.
 */
const COMPACT_REFERENCES: Record<string, (value: unknown, row: Row) => ReactNode> = {
  AirportId: value => <AirportCode id={asId(value)} />,
  DepartureAirportId: value => <AirportCode id={asId(value)} />,
  ArrivalAirportId: value => <AirportCode id={asId(value)} />,
}

// An ISO instant, which is the only thing these columns ever hold. Checked rather than handed to
// Date.parse, which reads '16' as a year and would turn a stray number into a timestamp.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Whether a column holds an instant: the API names every one of them …Utc or …At. */
const isTimestampColumn = (column: string) => column.endsWith('Utc') || column.endsWith('At')

/**
 * How one column of a raw row is worth showing, or undefined when the raw value already is:
 * a referenced record by name, an instant to the minute in UTC. The full value rides along as
 * `title`, so a timestamp's seconds are a hover away and nothing the API sent is lost.
 *
 * `compact` is for a caller with a column's width rather than a field's — the grid — and changes
 * only the columns that have a shorter true name; everything else reads the same either way.
 */
export function columnValue(
  column: string,
  value: unknown,
  row: Row,
  compact = false,
): { node: ReactNode; title?: string } | undefined {
  const reference = (compact ? lookup(COMPACT_REFERENCES, column) : undefined) ?? lookup(REFERENCES, column)
  if (reference) return { node: reference(value, row) }
  if (isTimestampColumn(column) && typeof value === 'string' && ISO_INSTANT.test(value)) {
    return { node: `${formatUtcMinute(value)} UTC`, title: value }
  }
  return undefined
}

/**
 * What a column is headed and labelled, where the value under it is a record rather than the id or
 * code the API stores. Shared by the grid's header — which is also its sort control, and still
 * sorts by the raw column name, so "Airline ↑" orders by AirlineId — and the record page's field
 * labels, so a field never reads "KindId" over a value naming a kind.
 */
const COLUMN_LABELS: Record<string, string> = {
  AirlineId: 'Airline',
  AirportId: 'Airport',
  DepartureAirportId: 'From',
  ArrivalAirportId: 'To',
  KindId: 'Kind',
  AllianceCode: 'Alliance',
  TravelerId: 'Traveler',
  FlightId: 'Flight',
  LoungeId: 'Lounge',
  ProviderId: 'Provider',
}

/** What a column is called on screen: its label where it has one, otherwise the API's own name. */
export const columnLabel = (column: string) => lookup(COLUMN_LABELS, column) ?? column
