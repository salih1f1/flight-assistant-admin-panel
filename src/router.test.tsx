import { isValidElement, type ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { router } from './router'
import { DataBrowserRoute } from '@/pages/data/DataBrowserPage'

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
})
