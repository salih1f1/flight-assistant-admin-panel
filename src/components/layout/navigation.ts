import { Award, Globe, Plane, Settings, Sofa, Users, type LucideIcon } from 'lucide-react'

/**
 * A side menu entry. Lists open their raw grid at /data/{table}; `also` is where the entity's own
 * detail and create pages live (e.g. /travelers/{id}, /airlines/new), so the entry stays current there.
 */
export type NavItem = { label: string; to: string; also?: string }

export type NavGroup = { label: string; icon: LucideIcon; items: NavItem[] }

/** A raw table's grid, and optionally the path of the entity's own pages. */
const table = (label: string, slug: string, also?: string): NavItem => ({ label, to: `/data/${slug}`, also })

/**
 * Every page and every raw table in BrowsableTables (backend), grouped by domain, except the raw
 * admin audit log, which the Audit log page covers with its own filters. A table the API adds
 * later is still reachable at /data/{slug}, but only appears here once it's added.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Travelers',
    icon: Users,
    items: [
      table('Travelers', 'travelers', '/travelers'),
      table('Device Tokens', 'device-tokens'),
      table('Loyalty Memberships', 'traveler-loyalty-memberships'),
    ],
  },
  {
    label: 'Flights',
    icon: Plane,
    items: [
      table('Flights', 'flights', '/flights'),
      table('Traveler Flights', 'traveler-flights'),
      table('Flight Statuses', 'flight-statuses'),
      table('Flight Status Events', 'flight-status-events'),
    ],
  },
  {
    label: 'Lounges',
    icon: Sofa,
    items: [
      table('Lounges', 'lounges', '/lounges'),
      table('Lounge Providers', 'lounge-providers'),
      table('Provider Links', 'lounge-provider-links'),
    ],
  },
  {
    label: 'Loyalty',
    icon: Award,
    items: [
      table('Loyalty Programs', 'loyalty-programs', '/loyalty'),
      table('Program Kinds', 'loyalty-program-kinds'),
      table('Tiers', 'loyalty-tiers'),
    ],
  },
  {
    label: 'Reference data',
    icon: Globe,
    items: [
      table('Airlines', 'airlines', '/airlines'),
      table('Airports', 'airports', '/airports'),
      table('Alliances', 'alliances'),
      table('Countries', 'countries'),
    ],
  },
  {
    label: 'System',
    icon: Settings,
    items: [
      { label: 'Import', to: '/import' },
      { label: 'Audit log', to: '/audit' },
      { label: 'Tests', to: '/tests' },
      table('Seed Versions', 'seed-versions'),
    ],
  },
]

/** Whether `pathname` is this entry's page or below it (a record at /data/airlines/7), or under its `also` path. */
export function isCurrent(item: NavItem, pathname: string) {
  const within = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  return within(item.to) || (item.also !== undefined && within(item.also))
}
