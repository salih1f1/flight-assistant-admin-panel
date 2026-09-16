/** Spec §3: the columns an automated check compares, for the table slugs that have outside sources. */
export const CHECKED_COLUMNS: Record<string, readonly string[]> = {
  airports: ['Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt'],
  airlines: ['Iata', 'Icao', 'Name', 'CountryCode'],
  countries: ['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion'],
}

/**
 * Table slugs mapped to the `entityType` value GET /admin/verification-sources and
 * POST /admin/verification-requests take. Only these three tables have an outside source that can
 * check them, so only they get the Verify dialog's "Against sources" mode.
 */
export const VERIFICATION_ENTITY_TYPES: Record<string, 'Airport' | 'Airline' | 'Country'> = {
  airports: 'Airport',
  airlines: 'Airline',
  countries: 'Country',
}
