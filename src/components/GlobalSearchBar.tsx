import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { BookOpen, Map as MapIcon, Search, Swords } from 'lucide-react'
import { usePlaybooks } from '../hooks/usePlaybooks'
import { useMatchSearch } from '../hooks/useMatchSearch'
import { useGameContent } from '../hooks/useGameContent'
import { PLAYBOOKS_CHANGED_EVENT } from '../lib/playbookImport'

type ResultType = 'playbook' | 'match' | 'map'

interface SearchItem {
  type: ResultType
  id: string
  label: string
  sub: string
  route: string
  keywords: string
}

const GROUPS: { type: ResultType; label: string; icon: React.ElementType }[] = [
  { type: 'playbook', label: 'Playbooks', icon: BookOpen },
  { type: 'match', label: 'Matches', icon: Swords },
  { type: 'map', label: 'Maps', icon: MapIcon },
]

const MAX_RESULTS = 6

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export default function GlobalSearchBar() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const { playbooks, reload: reloadPlaybooks } = usePlaybooks()
  const { matches } = useMatchSearch()
  const { registry } = useGameContent()

  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    window.addEventListener(PLAYBOOKS_CHANGED_EVENT, reloadPlaybooks)
    return () => window.removeEventListener(PLAYBOOKS_CHANGED_EVENT, reloadPlaybooks)
  }, [reloadPlaybooks])

  // Debounce typing → query.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 100)
    return () => clearTimeout(t)
  }, [input])

  // `/` (outside inputs) or ⌘K / Ctrl+K focuses the search from anywhere.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)
      if (!modK && !slash) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const fuse = useMemo(() => {
    const items: SearchItem[] = [
      ...playbooks.map(p => ({
        type: 'playbook' as const,
        id: p.id,
        label: p.title,
        sub: [p.map, p.agent, p.side].filter(Boolean).join(' · '),
        route: `/playbook/${p.slug}`,
        keywords: [p.title, p.map, p.agent].filter(Boolean).join(' '),
      })),
      ...matches.map(m => {
        const date = new Date(m.match_date)
        const short = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        return {
          type: 'match' as const,
          id: m.id,
          label: `${m.map} · ${m.agent}`,
          sub: `${m.score} ${m.result} · ${short}`,
          route: `/review/${m.match_id}`,
          keywords: `${m.map} ${m.agent} ${m.score} ${short} ${m.match_date.slice(0, 10)}`,
        }
      }),
      ...(registry ? [...registry.maps.byId.values()] : []).map(map => ({
        type: 'map' as const,
        id: map.uuid,
        label: map.name,
        sub: 'Map',
        route: `/playbook?map=${encodeURIComponent(map.name)}`,
        keywords: map.name,
      })),
    ]
    return new Fuse(items, {
      keys: [
        { name: 'label', weight: 2 },
        { name: 'keywords', weight: 1 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    })
  }, [playbooks, matches, registry])

  // Best MAX_RESULTS hits overall, then grouped for display in a fixed order.
  const grouped = useMemo(() => {
    if (!query) return []
    const hits = fuse.search(query, { limit: MAX_RESULTS }).map(r => r.item)
    return GROUPS.map(g => ({ ...g, items: hits.filter(h => h.type === g.type) })).filter(g => g.items.length)
  }, [fuse, query])

  const flat = grouped.flatMap(g => g.items)
  const open = focused && input.trim().length > 0

  const close = () => {
    setInput('')
    setQuery('')
    inputRef.current?.blur()
  }

  const go = (item: SearchItem) => {
    navigate(item.route)
    close()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => Math.min(i + 1, Math.max(0, flat.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flat[selected]
      if (item) go(item)
    }
  }

  return (
    <div className="relative w-full max-w-xs">
      <div className="flex items-center gap-2 bg-bg-card border border-bg-elevated rounded-full px-3 py-1.5 focus-within:border-val-cyan/50 transition-colors">
        <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => {
            setInput(e.target.value)
            setSelected(0)
          }}
          onFocus={() => setFocused(true)}
          // Delay so a result click lands before the dropdown unmounts.
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder="Search maps, agents, or date..."
          className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          aria-label="Global search"
        />
        <kbd className="hidden md:inline font-stats text-[10px] text-text-muted border border-bg-elevated rounded px-1">/</kbd>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-80 max-w-[90vw] bg-bg-elevated border border-bg-card rounded-lg shadow-xl overflow-hidden">
          {flat.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-muted text-center">{query ? 'No results' : 'Searching…'}</div>
          ) : (
            grouped.map(group => (
              <div key={group.type} className="py-1">
                <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-widest text-text-muted">{group.label}</div>
                {group.items.map(item => {
                  const index = flat.indexOf(item)
                  const Icon = group.icon
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => go(item)}
                      onMouseEnter={() => setSelected(index)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${
                        index === selected ? 'bg-bg-card' : 'hover:bg-bg-card/60'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 text-val-cyan shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text-primary truncate">{item.label}</div>
                        <div className="text-[11px] text-text-muted truncate">{item.sub}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
