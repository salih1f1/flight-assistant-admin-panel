import type { AdminAuditDto } from '@/api/generated/model'

// Entity types (CLR names, as audit rows carry them) the panel has a page for.
const ENTITY_PAGES: Record<string, (id: string) => string> = {
  Traveler: id => `/travelers/${id}`,
  Flight: id => `/flights/${id}`,
  Airline: id => `/airlines/${id}/edit`,
  Airport: id => `/airports/${id}/edit`,
  Lounge: id => `/lounges/${id}/edit`,
  LoyaltyProgram: id => `/loyalty/${id}/edit`,
}

type AuditEntity = Pick<AdminAuditDto, 'entityType' | 'entityId'>

/**
 * "Airline 7". A create of an entity with a store-generated key has no id yet when its audit row
 * is written, so it reads "Airport (pending id)".
 */
export const auditEntityLabel = ({ entityType, entityId }: AuditEntity) =>
  `${entityType ?? 'Unknown'} ${entityId ?? '(pending id)'}`

/** The panel page for an audit row's entity, or undefined when there is none (or no id yet). */
export function auditEntityPage({ entityType, entityId }: AuditEntity): string | undefined {
  const page = entityType ? ENTITY_PAGES[entityType] : undefined
  return page && entityId ? page(entityId) : undefined
}
