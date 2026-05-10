import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { List, BarChart3, Tag, LogOut } from 'lucide-react'
import { signOut } from '../lib/auth'
import MatchSearchPanel from './MatchSearchPanel'

interface AppShellProps {
  children: React.ReactNode
}

export default function AppShell({ children }: AppShellProps) {
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)

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
      setSearchOpen(o => !o)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Match Library is the homepage — bypass shell chrome
  if (location.pathname === '/') {
    return <>{children}</>
  }

  const railLinkClass = ({ isActive }: { isActive: boolean }) =>
    `w-8 h-8 rounded-md flex items-center justify-center border transition-colors ${
      isActive
        ? 'bg-bg-elevated border-val-cyan text-val-cyan'
        : 'border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-elevated/50'
    }`

  return (
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
          <NavLink to="/analytics" className={railLinkClass} title="Analytics">
            <BarChart3 className="w-4 h-4" />
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
      <MatchSearchPanel isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Main content */}
      <main className="flex-1 min-w-0 px-4 py-6">
        {children}
      </main>
    </div>
  )
}
