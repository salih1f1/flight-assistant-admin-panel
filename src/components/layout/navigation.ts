import { Award, Globe, Plane, Settings, Sofa, Users, type LucideIcon } from 'lucide-react'

/**
 * A side menu entry. `table` is the slug of its raw table (GET /admin/data/{table}) when the
 * entry is a management page that also has one: the entry then stays current on /data/{table},
 * and both views get Manage | Raw data tabs (ViewTabs).
 */
export type NavItem = { label: string; to: string; table?: string }

export type NavGroup = { label: string; icon: LucideIcon; items: NavItem[] }

/** A raw table with no management page of its own. */
const rawTable = (label: string, slug: string): NavItem => ({ label, to: `/data/${slug}` })

/**
 * Every page and every raw table in BrowsableTables (backend), grouped by domain. A table the
 * API adds later is still reachable at /data/{slug}, but only appears here once it's added.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Travelers',
    icon: Users,
    items: [
      { label: 'Travelers', to: '/travelers', table: 'travelers' },
      rawTable('Device Tokens', 'device-tokens'),
      rawTable('Loyalty Memberships', 'traveler-loyalty-memberships'),
    ],
  },
  {
    label: 'Flights',
    icon: Plane,
    items: [
      { label: 'Flights', to: '/flights', table: 'flights' },
      rawTable('Traveler Flights', 'traveler-flights'),
      rawTable('Flight Statuses', 'flight-statuses'),
      rawTable('Flight Status Events', 'flight-status-events'),
    ],
  },
  {
    label: 'Lounges',
    icon: Sofa,
    items: [
      { label: 'Lounges', to: '/lounges', table: 'lounges' },
      rawTable('Lounge Providers', 'lounge-providers'),
      rawTable('Provider Links', 'lounge-provider-links'),
    ],
  },
  {
    label: 'Loyalty',
    icon: Award,
    items: [
      { label: 'Loyalty Programs', to: '/loyalty', table: 'loyalty-programs' },
      rawTable('Program Kinds', 'loyalty-program-kinds'),
      rawTable('Tiers', 'loyalty-tiers'),
    ],
  },
  {
    label: 'Reference data',
    icon: Globe,
    items: [
      { label: 'Airlines', to: '/airlines', table: 'airlines' },
      { label: 'Airports', to: '/airports', table: 'airports' },
      rawTable('Alliances', 'alliances'),
      { label: 'Countries', to: '/countries', table: 'countries' },
    ],
  },
  {
    label: 'System',
    icon: Settings,
    items: [
      { label: 'Import', to: '/import' },
      { label: 'Audit log', to: '/audit', table: 'admin-audit-log' },
      { label: 'Tests', to: '/tests' },
      rawTable('Seed Versions', 'seed-versions'),
    ],
  },
]

/** Whether `pathname` is this entry's page, one of its sub-pages (e.g. /airlines/7/edit), or its raw table. */
export function isCurrent(item: NavItem, pathname: string) {
  const within = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  return within(item.to) || (item.table !== undefined && within(`/data/${item.table}`))
}

/** The management page entry whose raw table is `table`, if there is one. */
export function managedItemFor(table: string) {
  return NAV_GROUPS.flatMap(group => group.items).find(item => item.table === table)
}
