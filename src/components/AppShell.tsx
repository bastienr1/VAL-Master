import { useState, useEffect, useRef, useMemo } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { List, BarChart3, BookOpen, Tag, LogOut, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { signOut, useSession } from '../lib/auth'
import { useLoadLatest } from '../hooks/useLoadLatest'
import { MatchSearchPanelContext } from '../hooks/useMatchSearchPanel'
import MatchSearchPanel from './MatchSearchPanel'
import TopNavModeBar from './TopNavModeBar'
import GlobalSearchBar from './GlobalSearchBar'

interface AppShellProps {
  children: React.ReactNode
}

function AccountMenu() {
  const navigate = useNavigate()
  const { user } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-9 h-9 rounded-full bg-bg-elevated border border-bg-elevated hover:border-val-cyan/40 flex items-center justify-center text-sm font-medium text-text-primary transition-colors"
        title={user?.email ?? 'Account'}
        aria-label="Account menu"
      >
        {(user?.email?.[0] ?? '?').toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-bg-elevated border border-bg-card rounded-lg shadow-xl overflow-hidden">
          {user?.email && (
            <div className="px-3 py-2 text-[11px] text-text-muted border-b border-bg-card truncate">{user.email}</div>
          )}
          <button
            onClick={() => {
              setOpen(false)
              navigate('/settings')
            }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-bg-card transition-colors text-text-primary"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            Settings
          </button>
          <button
            onClick={() => {
              setOpen(false)
              signOut()
            }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-bg-card transition-colors text-val-red"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function TopBar() {
  const { sync, syncing, player } = useLoadLatest()

  return (
    <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-bg-elevated">
      <div className="flex items-center gap-6 min-w-0">
        <span className="font-heading text-lg font-bold tracking-wider whitespace-nowrap">
          VAL <span className="text-val-red">MASTER</span>
        </span>
        <TopNavModeBar />
      </div>
      <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
        <GlobalSearchBar />
        <button
          onClick={sync}
          disabled={syncing || !player}
          title={!player ? 'Set your Riot ID in Settings first' : undefined}
          className="flex items-center gap-2 px-3 py-1.5 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">Load Latest</span>
        </button>
        <AccountMenu />
      </div>
    </header>
  )
}

export default function AppShell({ children }: AppShellProps) {
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string | undefined>(undefined)

  // Tab-key handler — toggle search panel from anywhere outside an input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const target = e.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      setSearchQuery(undefined)
      setSearchOpen(o => !o)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const searchPanel = useMemo(
    () => ({
      open: (query?: string) => {
        setSearchQuery(query)
        setSearchOpen(true)
      },
    }),
    [],
  )

  // Match Library is the homepage — no rail, but it shares the top bar
  if (location.pathname === '/') {
    return (
      <MatchSearchPanelContext.Provider value={searchPanel}>
        <TopBar />
        {children}
      </MatchSearchPanelContext.Provider>
    )
  }

  const railLinkClass = ({ isActive }: { isActive: boolean }) =>
    `w-8 h-8 rounded-md flex items-center justify-center border transition-colors ${
      isActive
        ? 'bg-bg-elevated border-val-cyan text-val-cyan'
        : 'border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-elevated/50'
    }`

  return (
    <MatchSearchPanelContext.Provider value={searchPanel}>
      <div className="min-h-screen flex flex-row bg-bg-primary text-text-primary">
        {/* Icon rail */}
        <aside className="w-14 flex-shrink-0 bg-bg-secondary border-r border-bg-elevated flex flex-col items-center py-3 gap-3.5 sticky top-0 h-screen z-40">
          <div className="w-[30px] h-[30px] rounded-md bg-val-red flex items-center justify-center text-white text-xs font-medium tracking-wide">
            VM
          </div>
          <div className="flex flex-col gap-1 items-center">
            <NavLink to="/" end className={railLinkClass} title="Matches">
              <List className="w-4 h-4" />
            </NavLink>
            <NavLink to="/analytics" className={railLinkClass} title="Insights">
              <BarChart3 className="w-4 h-4" />
            </NavLink>
            <NavLink to="/playbook" className={railLinkClass} title="Playbook">
              <BookOpen className="w-4 h-4" />
            </NavLink>
            <NavLink to="/settings" className={railLinkClass} title="Settings">
              <SettingsIcon className="w-4 h-4" />
            </NavLink>
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center text-text-muted opacity-30 cursor-not-allowed"
              title="Tags (coming soon)"
            >
              <Tag className="w-4 h-4" />
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="mt-auto w-8 h-8 rounded-md flex items-center justify-center text-text-muted hover:text-val-red hover:bg-bg-elevated/50 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </aside>

        {/* Match search panel */}
        <MatchSearchPanel isOpen={searchOpen} onClose={() => setSearchOpen(false)} initialQuery={searchQuery} />

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar />
          <main className="flex-1 min-w-0 px-4 py-6">
            {children}
          </main>
        </div>
      </div>
    </MatchSearchPanelContext.Provider>
  )
}
