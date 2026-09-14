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
      { label: 'Track a flight', to: '/flights/track' },
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

/**
 * The entry `pathname` belongs to: its page or below it (a record at /data/airlines/7), or under its
 * `also` path. When several match, the longest matching path wins, so /flights/track is Track a
 * flight rather than Flights, whose own pages sit under /flights.
 */
export function currentEntry(pathname: string): NavItem | undefined {
  let current: NavItem | undefined
  let longest = -1
  for (const item of NAV_GROUPS.flatMap(group => group.items)) {
    const length = Math.max(matchLength(item.to, pathname), item.also === undefined ? -1 : matchLength(item.also, pathname))
    if (length > longest) [current, longest] = [item, length]
  }
  return current
}

/** How much of `pathname` `path` covers: its length when `pathname` is `path` or below it, else -1. */
const matchLength = (path: string, pathname: string) =>
  pathname === path || pathname.startsWith(`${path}/`) ? path.length : -1
