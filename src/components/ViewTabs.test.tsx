import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ViewTabs } from './ViewTabs'

function renderAt(path: string, table: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ViewTabs table={table} />
    </MemoryRouter>,
  )
}

const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Views' })).getByRole('link', { name })

describe('ViewTabs', () => {
  it('on a management page, links to its raw table with Manage current', () => {
    renderAt('/loyalty', 'loyalty-programs')

    expect(tab('Manage')).toHaveAttribute('href', '/loyalty')
    expect(tab('Manage')).toHaveAttribute('aria-current', 'page')
    expect(tab('Raw data')).toHaveAttribute('href', '/data/loyalty-programs')
    expect(tab('Raw data')).not.toHaveAttribute('aria-current')
  })

  it('on a raw table, links back to its management page with Raw data current', () => {
    renderAt('/data/admin-audit-log', 'admin-audit-log')

    expect(tab('Manage')).toHaveAttribute('href', '/audit')
    expect(tab('Manage')).not.toHaveAttribute('aria-current')
    expect(tab('Raw data')).toHaveAttribute('aria-current', 'page')
  })

  it('renders nothing for a table with no management page', () => {
    const { container } = renderAt('/data/alliances', 'alliances')

    expect(container).toBeEmptyDOMElement()
  })
})
