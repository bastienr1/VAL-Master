import { useSyncExternalStore } from 'react'
import { Bomb } from 'lucide-react'
import type { CanvasSkin } from '../../lib/canvasSkins'
import type { PlayStep } from '../../lib/playDoc'
import { rosterOf, utilityUp, type RosterPlayer, type RosterRow } from '../../lib/replayPanels'
import type { ValueStore } from '../../lib/valueStore'
import AgentIcon from './AgentIcon'

/** The replay's frame store, read only. */
type Frames = Pick<ValueStore<{ step: PlayStep } | null>, 'get' | 'subscribe'>

const heading = 'flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-secondary'

function Team({ title, color, rows }: { title: string; color: string; rows: RosterRow[] }) {
  const alive = rows.filter(r => r.alive).length
  return (
    <section className="space-y-1">
      <h2 className={heading}>
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        {title} · {alive} alive
      </h2>
      <ul className="space-y-0.5">
        {rows.map(r => (
          <li key={r.subject} className={`flex items-center gap-2 rounded-md bg-bg-card px-1.5 py-1 ${r.alive ? '' : 'opacity-50'}`}>
            <AgentIcon name={r.agent} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-text-primary">{r.playerName ?? r.agent}</span>
              {r.playerName && <span className="block truncate text-[10px] text-text-secondary">{r.agent}</span>}
            </span>
            {r.spike && <Bomb aria-label="Spike carrier" className="w-3.5 h-3.5 shrink-0 text-val-yellow" />}
            {!r.alive && <span className="shrink-0 text-[10px] text-text-secondary">down</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Analyst layout's left panel (§2.12): both teams, who is alive at the frame shown, and the spike carrier. */
export function ReplayRoster({ frames, players, skin }: { frames: Frames; players(): RosterPlayer[]; skin: CanvasSkin }) {
  const frame = useSyncExternalStore(frames.subscribe, frames.get)
  const rows = rosterOf(players(), frame?.step)
  return (
    <div className="p-2 space-y-3">
      <Team title="Your team" color={skin.ally} rows={rows.filter(r => r.team === 'ally')} />
      <Team title="Enemy" color={skin.enemy} rows={rows.filter(r => r.team === 'enemy')} />
    </div>
  )
}

/** Analyst layout's right panel (§2.12): the utility up now, each with the time it has left. */
export function UtilityNow({ frames, skin }: { frames: Frames; skin: CanvasSkin }) {
  const frame = useSyncExternalStore(frames.subscribe, frames.get)
  const rows = utilityUp(frame?.step)
  return (
    <section className="p-4 space-y-3">
      <h2 className={heading}>Utility up now</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-text-secondary">Nothing is up at this moment.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(u => (
            <li key={u.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-text-primary">{u.name}</span>
                <span className="shrink-0 text-xs text-text-secondary">{u.agent}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-bg-primary overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.round(u.life * 100)}%`, backgroundColor: skin.utility[u.shape] }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
