import { isValidElement, type ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { router } from './router'
import { DataBrowserRoute } from '@/pages/data/DataBrowserPage'
import { RedirectToRecord } from '@/pages/data/RecordPage'

vi.mock('@/auth/msalConfig', () => ({
  msalInstance: {},
  loginRequest: { scopes: [] },
  apiRequest: { scopes: [] },
}))

/** The route for a path, wherever it sits in the nesting. */
function findRoute(routes: RouteObject[], path: string): RouteObject | undefined {
  for (const route of routes) {
    if (route.path === path) return route
    const nested = route.children && findRoute(route.children, path)
    if (nested) return nested
  }
  return undefined
}

describe('router', () => {
  it('mounts the data grid keyed by table, so switching tables remounts instead of updating', () => {
    const route = findRoute(router.routes, '/data/:table')

    expect(route).toBeDefined()
    expect(isValidElement(route!.element)).toBe(true)
    // Not the bare page: re-pointing one instance at another table is what froze the panel (#123).
    expect((route!.element as ReactElement).type).toBe(DataBrowserRoute)
  })

  /**
   * The alliance's airlines live on its record page now (#174), so /alliances/:id has no page of
   * its own left. The route stays as a redirect: it is what the "Airlines in this alliance" link
   * pointed at, and anyone who bookmarked an alliance still lands on the alliance.
   */
  it('sends the old alliance detail path to the alliance record', () => {
    const route = findRoute(router.routes, '/alliances/:id')

    expect(route).toBeDefined()
    const element = route!.element as ReactElement<{ table: string; mode?: string }>
    expect(element.type).toBe(RedirectToRecord)
    expect(element.props.table).toBe('alliances')
    // No mode: the alliance opens as it normally does, not in the form.
    expect(element.props.mode).toBeUndefined()
  })

  /**
   * RedirectToRecord takes the mode as a prop now, so "opens in Edit" is spelled at the route
   * rather than baked into the component. Nothing else pins that: RecordPage's own tests mount
   * the component directly, and would keep passing with the prop dropped here.
   */
  it.each([
    ['/airlines/:id/edit', 'airlines'],
    ['/airports/:id/edit', 'airports'],
    ['/loyalty/:id/edit', 'loyalty-programs'],
    ['/lounges/:id/edit', 'lounges'],
  ])('sends %s to the record opened in Edit', (path, table) => {
    const route = findRoute(router.routes, path)

    expect(route).toBeDefined()
    const element = route!.element as ReactElement<{ table: string; mode?: string }>
    expect(element.type).toBe(RedirectToRecord)
    expect(element.props).toMatchObject({ table, mode: 'edit' })
  })
})
