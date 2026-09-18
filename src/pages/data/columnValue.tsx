import type { ReactNode } from 'react'
import {
  AirlineName, AirportName, FlightName, LoyaltyProgramName, LoyaltyTierName, TravelerName,
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
const REFERENCES: Record<string, (value: unknown, row: Row, compact: boolean) => ReactNode> = {
  AirlineId: value => <AirlineName id={asId(value)} />,
  // An airport is the one reference with a short form everyone reads, so a grid gets the code and
  // a record page the whole name. See AirportName.
  AirportId: (value, _row, compact) => <AirportName id={asId(value)} compact={compact} />,
  DepartureAirportId: (value, _row, compact) => <AirportName id={asId(value)} compact={compact} />,
  ArrivalAirportId: (value, _row, compact) => <AirportName id={asId(value)} compact={compact} />,
  ProgramId: value => <LoyaltyProgramName id={asId(value)} />,
  // The only place the API names a tier is inside its program, so this one reads its row's sibling
  // column rather than its own value alone.
  TierId: (value, row) => <LoyaltyTierName programId={asId(row.ProgramId)} tierId={asId(value)} />,
  TravelerId: value => <TravelerName id={typeof value === 'string' ? value : null} />,
  FlightId: value => <FlightName id={asId(value)} />,
}

/**
 * What a column is called on screen, where the API's name is about how the value is stored rather
 * than what it now says. A column resolved to a name holds no id, so heading it `AirportId`
 * contradicts the `LHR` underneath it. Only the header changes: sorting, filtering and CSV export
 * all keep sending the API's own column name.
 */
const COLUMN_LABELS: Record<string, string> = {
  AirlineId: 'Airline',
  AirportId: 'Airport',
  ProgramId: 'Program',
}

/** The heading for a column, which is the API's name for it unless the panel has a better one. */
export const columnLabel = (column: string) => lookup(COLUMN_LABELS, column) ?? column

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
 * `compact` is the grid asking for the short form of a reference that has one, a column's width
 * rather than a page's. Every reference that shortens keeps the long form in its own `title`.
 */
export function columnValue(
  column: string,
  value: unknown,
  row: Row,
  { compact = false }: { compact?: boolean } = {},
): { node: ReactNode; title?: string } | undefined {
  const reference = lookup(REFERENCES, column)
  if (reference) return { node: reference(value, row, compact) }
  if (isTimestampColumn(column) && typeof value === 'string' && ISO_INSTANT.test(value)) {
    return { node: `${formatUtcMinute(value)} UTC`, title: value }
  }
  return undefined
}
