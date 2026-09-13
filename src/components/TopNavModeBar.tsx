import { Fragment } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const base = 'tracking-widest text-sm font-medium transition-colors'
const activeClass = `${base} text-val-cyan`
const inactiveClass = `${base} text-text-muted hover:text-text-secondary`

/**
 * REVIEW / IMPROVE / ASCEND — mode framing, not destination navigation.
 * Reflection → directed learning → mastery.
 */
export default function TopNavModeBar() {
  const { pathname } = useLocation()
  const reviewActive = pathname === '/' || pathname.startsWith('/review/')
  const improveActive = pathname.startsWith('/playbook')

  const modes = [
    <NavLink key="review" to="/" className={reviewActive ? activeClass : inactiveClass}>
      REVIEW
    </NavLink>,
    <NavLink key="improve" to="/playbook" className={improveActive ? activeClass : inactiveClass}>
      IMPROVE
    </NavLink>,
    <span key="ascend" className={`${base} text-text-muted/40 cursor-not-allowed`} title="Coming soon — mastery tracking" aria-disabled="true">
      ASCEND
    </span>,
  ]

  return (
    <nav className="flex items-center gap-4" aria-label="Mode">
      {modes.map((mode, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-text-muted/50" aria-hidden="true">·</span>}
          {mode}
        </Fragment>
      ))}
    </nav>
  )
}
