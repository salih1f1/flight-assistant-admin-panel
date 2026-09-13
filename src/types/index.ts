export interface AdminTraveler {
  id: string
  email: string
  displayName: string | null
  countryCode: string | null
  nationalityCountryCode: string | null
  residenceCountryCode: string | null
  createdUtc: string
}

export interface AdminFlight {
  id: number
  airlineId: number
  flightNumber: string
  departureAirportId: number
  arrivalAirportId: number
  serviceDate: string
  scheduledDepartureUtc: string
  scheduledArrivalUtc: string
  estimatedDepartureUtc: string | null
  estimatedArrivalUtc: string | null
  actualDepartureUtc: string | null
  actualArrivalUtc: string | null
  equipmentAircraftIcao: string | null
  externalId: string | null
}

export interface Airline {
  id: number
  iata: string | null
  icao: string | null
  name: string
  countryCode: string
  allianceCode: string | null
}

export interface Airport {
  id: number
  iata: string
  icao: string | null
  name: string
  city: string
  countryCode: string
  latitude: number | null
  longitude: number | null
  elevationFt: number | null
}

export interface Country {
  code: string
  name: string
  alpha3: string | null
  numericCode: number | null
  region: string | null
  subregion: string | null
  isEU: boolean | null
  isSchengen: boolean | null
  isEEA: boolean | null
}

export interface Alliance {
  code: string
  name: string
}

export interface LoyaltyTier {
  id: number
  code: string
  name: string
  rank: number
  allianceCode: string | null
  allianceTierCode: string | null
}

export interface LoyaltyProgram {
  id: number
  code: string
  name: string
  kind: string
  airlineId: number | null
  allianceCode: string | null
  tiers: LoyaltyTier[]
}

export interface LoyaltyProgramKind {
  id: number
  code: string
  name: string
}

export interface AdminLounge {
  id: number
  airportId: number
  name: string
  terminal: string | null
  locationHint: string | null
  hours: string | null
  isAirside: boolean
  isDomesticOnly: boolean
  isInternationalOnly: boolean
  amenities: string | null
}

/**
 * Envelope returned by every paged admin list (/admin/airlines, /admin/airports, …).
 * `total` counts all matching rows, not the ones in `items`.
 */
export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// Request types
export interface CreateAirlineRequest {
  iata?: string
  icao?: string
  name: string
  countryCode: string
  allianceCode?: string
}

export interface CreateAirportRequest {
  iata: string
  icao?: string
  name: string
  city: string
  countryCode: string
  latitude?: number
  longitude?: number
  elevationFt?: number
}

export interface CreateLoyaltyProgramRequest {
  code: string
  name: string
  kindId: number
  airlineId?: number
  allianceCode?: string
}

export interface CreateLoungeRequest {
  airportId: number
  name: string
  terminal?: string
  locationHint?: string
  hours?: string
  isAirside: boolean
  isDomesticOnly: boolean
  isInternationalOnly: boolean
  amenities?: string
}
