import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useMatchSearch } from '../hooks/useMatchSearch'
import type { Match } from '../lib/types'

interface MatchSearchPanelProps {
  isOpen: boolean
  onClose: () => void
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days >= 7) return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (days >= 1) return `${days}d ago`
  if (hours >= 1) return `${hours}h ago`
  if (minutes >= 1) return `${minutes}m ago`
  return 'just now'
}

export default function MatchSearchPanel({ isOpen, onClose }: MatchSearchPanelProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { filtered } = useMatchSearch()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => filtered(query), [filtered, query])

  const activeMatchId = useMemo(() => {
    const match = location.pathname.match(/^\/review\/(.+)$/)
    return match ? match[1] : null
  }, [location.pathname])

  // Auto-focus input + reset selection when panel opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0)
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const openMatch = (m: Match) => {
    navigate(`/review/${m.match_id}`)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const m = results[selectedIndex]
      if (m) openMatch(m)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className={`flex-shrink-0 bg-bg-card border-r border-bg-elevated transition-[width,opacity] duration-200 overflow-hidden ${
        isOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0'
      }`}
      aria-hidden={!isOpen}
    >
      <div className="w-[280px] h-screen flex flex-col">
        <div className="p-3 border-b border-bg-elevated">
          <div className="flex items-center gap-2 bg-bg-elevated border border-bg-card rounded-lg px-2.5 py-2 focus-within:border-val-cyan/40">
            <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search matches…"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-text-muted">
              {query ? 'No matches found.' : 'No matches yet.'}
            </div>
          ) : (
            <div>
              {results.map((m, i) => {
                const isActive = activeMatchId === m.match_id
                const isSelected = i === selectedIndex
                const resultColor =
                  m.result === 'W' ? 'text-val-green' :
                  m.result === 'L' ? 'text-val-red' :
                  'text-val-yellow'
                return (
                  <button
                    key={m.id}
                    onClick={() => openMatch(m)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                      isActive
                        ? 'border-val-cyan bg-bg-elevated/60'
                        : isSelected
                          ? 'border-val-cyan/60 bg-bg-elevated/40'
                          : 'border-transparent hover:bg-bg-elevated/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-text-primary truncate">
                        {m.map} · <span className="text-text-secondary">{m.agent}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`font-stats text-xs ${resultColor}`}>{m.score}</span>
                        <span className={`text-[10px] font-bold ${resultColor}`}>{m.result}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {relativeDate(m.match_date)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
