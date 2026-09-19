import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Combobox, type ComboboxOption } from './combobox'
import { Label } from './label'

const PROGRAMS: ComboboxOption[] = [
  { value: '3', label: 'Executive Club (EXEC_CLUB)', keywords: 'EXEC_CLUB' },
  { value: '4', label: 'Miles & More (MILES)', keywords: 'MILES' },
  { value: '5', label: 'Priority Pass (PP)', keywords: 'PP' },
]

/** A Combobox wired to state, the way a form field uses it. */
function Harness({ options = PROGRAMS, disabled = false }: { options?: ComboboxOption[]; disabled?: boolean }) {
  const [value, setValue] = useState('')
  return (
    <div>
      <Label htmlFor="program">Program</Label>
      <Combobox
        id="program"
        value={value}
        onChange={setValue}
        options={options}
        placeholder="Choose a program…"
        searchLabel="Filter programs"
        searchPlaceholder="e.g. exec, miles, PP"
        disabled={disabled}
      />
      <p>Chosen: {value || 'nothing'}</p>
    </div>
  )
}

const trigger = () => screen.getByRole('combobox', { name: 'Program' })
const optionLabels = () => screen.getAllByRole('option').map(o => o.textContent)
const search = () => screen.getByRole('textbox', { name: 'Filter programs' })

describe('Combobox', () => {
  it('shows the placeholder until something is chosen, then that option', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(trigger()).toHaveTextContent('Choose a program…')

    await user.click(trigger())
    await user.click(screen.getByRole('option', { name: 'Miles & More (MILES)' }))

    expect(trigger()).toHaveTextContent('Miles & More (MILES)')
    expect(screen.getByText('Chosen: 4')).toBeInTheDocument()
  })

  it('offers every option when it opens', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(trigger())

    expect(optionLabels()).toEqual(['Executive Club (EXEC_CLUB)', 'Miles & More (MILES)', 'Priority Pass (PP)'])
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })

  it('narrows the list to what is typed into the dropdown itself, by label or by keyword', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())

    await user.type(search(), 'miles')
    expect(optionLabels()).toEqual(['Miles & More (MILES)'])

    await user.clear(search())
    await user.type(search(), 'pp')
    expect(optionLabels()).toEqual(['Priority Pass (PP)'])
  })

  it('picks the highlighted option with the keyboard', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())

    await user.type(search(), 'exec')
    await user.keyboard('{Enter}')

    expect(screen.getByText('Chosen: 3')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('walks the list with the arrow keys, following the active option', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())

    await user.keyboard('{ArrowDown}{ArrowDown}')
    const active = document.getElementById(search().getAttribute('aria-activedescendant') ?? '')
    expect(active).toHaveTextContent('Priority Pass (PP)')

    await user.keyboard('{Enter}')
    expect(screen.getByText('Chosen: 5')).toBeInTheDocument()
  })

  it('highlights the first match again once the typing narrows the list', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())

    // Third in the full list, but the only match is first in the narrowed one.
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.type(search(), 'exec')
    await user.keyboard('{Enter}')

    expect(screen.getByText('Chosen: 3')).toBeInTheDocument()
  })

  it('closes on Escape without choosing anything, leaving focus on the field', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByText('Chosen: nothing')).toBeInTheDocument()
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('closes when the click lands outside it', async () => {
    const user = userEvent.setup()
    render(<div><Harness /><button type="button">Elsewhere</button></div>)
    await user.click(trigger())

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('says so when nothing matches, rather than showing an empty list', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())

    await user.type(search(), 'lufthansa')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No match for "lufthansa".')).toBeInTheDocument()
  })

  it('forgets what was typed the next time it opens', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(trigger())
    await user.type(search(), 'miles')

    await user.keyboard('{Escape}')
    await user.click(trigger())

    expect(search()).toHaveValue('')
    expect(optionLabels()).toHaveLength(3)
  })

  it('takes a label of its own where no visible label names it', async () => {
    const user = userEvent.setup()
    render(
      <Combobox id="columns" value="" onChange={() => {}} options={PROGRAMS} ariaLabel="Filter column" searchLabel="Search columns" />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Filter column' }))

    expect(screen.getByRole('textbox', { name: 'Search columns' })).toBeInTheDocument()
  })

  it('stays shut while it is disabled', async () => {
    const user = userEvent.setup()
    render(<Harness disabled />)

    await user.click(trigger())

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger()).toBeDisabled()
  })
})
