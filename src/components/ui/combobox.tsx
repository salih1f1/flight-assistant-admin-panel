import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ComboboxOption = {
  value: string
  label: string
  /** Extra text the search matches on, for what the label doesn't spell out (a code, say). */
  keywords?: string
}

type ComboboxProps = {
  /** The id a <Label htmlFor> points at: the field itself, so the label names it and focuses it. */
  id: string
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  /** Shown on the field while nothing is chosen. */
  placeholder?: string
  /** Names the field where no visible <Label> does — a picker standing on its own in a toolbar. */
  ariaLabel?: string
  /** Names the search box inside the panel — what this list is filtered by. */
  searchLabel?: string
  searchPlaceholder?: string
  /** Shown in place of the list when there is nothing to choose from at all (still loading, or failed). */
  emptyMessage?: string
  disabled?: boolean
  className?: string
}

/**
 * A select you can type into: the field opens a panel holding a search box and the list it
 * narrows, which a native <select> can't do — a browser's own type-ahead only matches the start
 * of an option's label, so a code buried mid-label ("EXEC_CLUB", "PP") can't be typed towards.
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  ariaLabel,
  searchLabel = 'Search',
  searchPlaceholder,
  emptyMessage,
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = `${useId()}-list`

  const selected = options.find(o => o.value === value)
  const shown = matching(options, query)
  const optionId = (index: number) => `${listId}-option-${index}`

  const show = () => {
    setQuery('')
    // Opening onto the chosen option, so the list starts where the last answer left it.
    setActive(Math.max(0, options.findIndex(o => o.value === value)))
    setOpen(true)
  }

  // Closing always hands focus back to the field, so the keyboard never lands nowhere.
  const hide = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const pick = (option: ComboboxOption) => {
    onChange(option.value)
    hide()
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // A click anywhere else is an answer of "not now" — the panel is an overlay, not a mode.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Escape belongs to the open panel, not to whatever is behind it. Radix's dialog watches for it
  // on `document` in the capture phase, so a handler on the search box would fire too late and the
  // dialog would close with the dropdown. `window` captures one step earlier, ahead of that.
  useEffect(() => {
    if (!open) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Consuming it here is what keeps it from the dialog; preventDefault as well would be belt
      // and braces, and a break proved either one alone does the whole job.
      event.stopPropagation()
      hide()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [open])

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(current => clamp(current + step, shown.length))
      return
    }
    if (event.key === 'Enter') {
      // Enter picks an option; it must not reach the form around us and submit it.
      event.preventDefault()
      const option = shown[active]
      if (option) pick(option)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            show()
          }
        }}
        className={cn(TRIGGER_CLASS, !selected && 'text-gray-400')}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        // At least as wide as the field, but free to grow to the longest option: a narrow picker
        // in a toolbar row would otherwise truncate names a native select sized itself around.
        <div className="absolute z-50 mt-1 w-max min-w-full max-w-96 rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <input
              ref={inputRef}
              type="text"
              aria-label={searchLabel}
              aria-controls={listId}
              aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
              placeholder={searchPlaceholder}
              value={query}
              onChange={event => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={onSearchKeyDown}
              className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>

          {options.length === 0 && emptyMessage ? (
            <p className="px-3 py-2 text-xs text-gray-500">{emptyMessage}</p>
          ) : shown.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">{`No match for "${query}".`}</p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-60 overflow-auto p-1">
              {shown.map((option, index) => (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.value === value}
                  // The panel keeps its focus on the search box: a press on an option must not steal it.
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => pick(option)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                    index === active && 'bg-gray-100',
                  )}
                >
                  <Check className={cn('h-4 w-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{option.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** The options whose label or keywords contain what was typed, ignoring case; all of them when nothing was. */
function matching(options: ComboboxOption[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter(o => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(needle))
}

/** Arrow keys stop at the ends of the list rather than wrapping past them. */
function clamp(index: number, length: number) {
  if (length === 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

// Matches the native selects elsewhere on the forms, so a searchable field doesn't look foreign.
const TRIGGER_CLASS =
  'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm ' +
  'ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400'
