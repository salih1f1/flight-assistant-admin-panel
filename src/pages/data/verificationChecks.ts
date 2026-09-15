/** Spec §3: the columns an automated check compares, for the table slugs that have outside sources. */
export const CHECKED_COLUMNS: Record<string, readonly string[]> = {
  airports: ['Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt'],
  airlines: ['Iata', 'Icao', 'Name', 'CountryCode'],
  countries: ['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion'],
}
