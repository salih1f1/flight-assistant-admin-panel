import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TableSkeleton } from './TableSkeleton'

/** How many placeholder cells each placeholder row holds. */
const grid = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-skeleton-row]')].map(row => row.querySelectorAll('[data-skeleton-cell]').length)

describe('TableSkeleton', () => {
  it('holds the grid open with as many placeholder rows and columns as it is given', () => {
    const { container } = render(<TableSkeleton columns={4} rows={3} label="Loading rows…" />)

    expect(grid(container)).toEqual([4, 4, 4])
  })

  it('says what is loading, and keeps the empty cells out of the reading', () => {
    render(<TableSkeleton columns={2} rows={1} label="Loading rows…" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading rows…')
    // The placeholders are decoration: a screen reader hears the label, not two dozen blank cells.
    expect(screen.queryAllByRole('cell')).toHaveLength(0)
  })
})
