import { useMemo, useSyncExternalStore } from 'react'
import type { ReplayAngle } from '../../lib/replayAngles'
import { isDeathmatchRound, type ReplayBundle, type ReplayRound } from '../../lib/replayBundle'
import { roundLabel } from '../../lib/replayFrame'
import { LAYERS, type LayerKey, type Layers } from '../../lib/replayLayers'
import { weaponLabel } from '../../lib/replaySync'
import type { ValueStore } from '../../lib/valueStore'

interface ReplayRoundPanelProps {
  bundle: ReplayBundle
  /** Where the replay is. */
  clock: Pick<ValueStore<{ ms: number; round: ReplayRound } | null>, 'get' | 'subscribe'>
  /** A player's agent name. */
  nameOf(subject: string): string
  layers: Layers
  onToggleLayer(key: LayerKey): void
  /** A round cell: that round's barrier drop, paused. */
  onRound(n: number): void
  /** A kill row: a moment of the round shown, paused. */
  onSeek(ms: number, round: ReplayRound): void
  /** A Deathmatch's best angles (§2.20), best first; those of two kills or more are listed. */
  angles?: ReplayAngle[]
}

/** How long before a kill a jump lands, and how long after it the jump still counts as where the replay is. */
const JUMP_LEAD_MS = 2000
const JUMP_TAIL_MS = 1500

function phaseOf(round: ReplayRound, t: number): string {
  if (round.barrierMs == null) return ''
  // A Deathmatch has no buy phase and no round result to give (§2.19).
  const deathmatch = isDeathmatchRound(round)
  if (t < round.barrierMs) return `${deathmatch ? '' : 'buy phase · '}barrier in ${Math.ceil((round.barrierMs - t) / 1000)} s`
  if (!deathmatch && round.endMs != null && t >= round.endMs) return `${round.winner === 'ALLY' ? 'won' : 'lost'} · ${round.how ?? ''}`
  return `+${((t - round.barrierMs) / 1000).toFixed(1)} s`
}

/**
 * The right-hand panel while a replay plays (docs/plays-editor-v2.md §2.12),
 * the VOD review's: the round and its score so far, the map's layers, every
 * round to jump to, and the round's kills, each jumping to 2 s before it.
 * A Deathmatch (§2.19) is one round of some 250 kills: "DM", no side, score
 * or round grid, and the kills scroll in a box of their own, under the best
 * angles (§2.20), each with the times of its kills to jump to.
 */
export default function ReplayRoundPanel({ bundle, clock, nameOf, layers, onToggleLayer, onRound, onSeek, angles }: ReplayRoundPanelProps) {
  const shown = useSyncExternalStore(clock.subscribe, clock.get)
  const round = shown?.round ?? bundle.rounds[0]
  const t = shown?.ms ?? round.buyStartMs

  const playerOf = useMemo(() => new Map(bundle.players.map(p => [p.subject, p])), [bundle])
  const kills = useMemo(() => bundle.kills.filter(k => k.round === round.n), [bundle, round.n])
  const wonBefore = bundle.rounds.filter(r => r.n < round.n && r.winner === 'ALLY').length
  const lostBefore = bundle.rounds.filter(r => r.n < round.n && r.winner === 'ENEMY').length
  const deathmatch = isDeathmatchRound(round)
  const best = useMemo(() => (angles ?? []).filter(angle => angle.kills.length >= 2), [angles])
  /** A kill's time on the Deathmatch clock, as the transport shows it. */
  const clockOf = (ms: number) => {
    const s = Math.max(0, Math.floor((ms - (round.barrierMs ?? round.buyStartMs)) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const label = (subject: string | null) => {
    const player = subject ? playerOf.get(subject) : undefined
    if (!player) return { name: 'Unknown', tone: 'text-text-muted' }
    const name = nameOf(player.subject)
    return { name: player.isMe ? `${name} (you)` : name, tone: player.team === 'ALLY' ? 'text-val-cyan' : 'text-val-red' }
  }

  return (
    <div className="p-2 space-y-2">
      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-stats text-text-primary">{roundLabel(round)}</span>
          {!deathmatch && (
            <>
              <span className="text-text-muted">{round.side ?? ''}</span>
              <span className="font-stats text-text-secondary">
                {wonBefore}–{lostBefore}
              </span>
            </>
          )}
          <span className="font-stats text-text-muted">{phaseOf(round, t)}</span>
          <span className="ml-auto flex items-center gap-2 text-[10px]">
            {LAYERS.map(({ key, label: text, title }) => (
              <button
                key={key}
                type="button"
                onClick={() => onToggleLayer(key)}
                aria-pressed={layers[key]}
                title={title}
                className={`whitespace-nowrap transition-colors ${layers[key] ? 'text-val-cyan' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {text}
              </button>
            ))}
          </span>
        </div>

        {!deathmatch && (
          <div className="grid grid-cols-12 gap-1">
            {bundle.rounds.map(r => (
              <button
                key={r.n}
                type="button"
                onClick={() => onRound(r.n)}
                aria-current={r.n === round.n ? 'true' : undefined}
                title={`Round ${r.n}: ${r.winner === 'ALLY' ? 'won' : 'lost'}${r.how ? ` by ${r.how}` : ''}. Jumps to its barrier drop`}
                className={`rounded text-[10px] font-stats py-0.5 transition-colors ${
                  r.n === round.n ? 'bg-bg-elevated ring-1 ring-val-cyan/40' : 'bg-bg-elevated/50 hover:bg-bg-elevated'
                } ${r.winner === 'ALLY' ? 'text-val-green' : 'text-val-red'}`}
              >
                {r.n}
              </button>
            ))}
          </div>
        )}
      </div>

      {deathmatch && best.length > 0 && (
        <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Best angles · your kills</div>
          <ol className="space-y-1.5">
            {best.map(angle => (
              <li key={angle.rank}>
                <button
                  type="button"
                  onClick={() => onSeek(angle.kills[0].t - JUMP_LEAD_MS, round)}
                  title="Jump to 2 s before the first kill from this angle"
                  className="w-full flex items-baseline gap-2 text-left text-xs rounded px-1 py-0.5 hover:bg-bg-elevated transition-colors"
                >
                  <span className="font-stats text-text-muted w-3 shrink-0">{angle.rank}</span>
                  <span className="truncate text-text-primary">
                    {angle.from ?? 'Unnamed spot'}
                    {angle.toward && angle.toward !== angle.from ? ` → ${angle.toward}` : ''}
                  </span>
                  <span className="ml-auto whitespace-nowrap font-stats text-text-secondary">
                    {angle.kills.length} kills · {angle.held} held
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-1 pl-6 pt-0.5">
                  {angle.kills.map(kill => {
                    const on = t >= kill.t - JUMP_LEAD_MS && t <= kill.t + JUMP_TAIL_MS
                    return (
                      <button
                        key={kill.t}
                        type="button"
                        onClick={() => onSeek(kill.t - JUMP_LEAD_MS, round)}
                        aria-current={on ? 'true' : undefined}
                        title={`${kill.stance === 'held' ? 'Held' : kill.stance === 'moving' ? 'Moving' : 'Stance unknown'} · ${kill.distanceM.toFixed(0)} m · jumps to 2 s before the kill`}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-stats border transition-colors hover:bg-bg-elevated ${
                          kill.stance === 'held' ? 'text-val-cyan border-val-cyan/25' : 'text-text-secondary border-bg-elevated'
                        } ${on ? 'bg-bg-elevated ring-1 ring-val-cyan/40' : ''}`}
                      >
                        {clockOf(kill.t)}
                      </button>
                    )
                  })}
                  {angle.deathsNear > 0 && (
                    <span className="text-[10px] text-val-red">
                      {angle.deathsNear} {angle.deathsNear === 1 ? 'death' : 'deaths'} here
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[10px] text-text-muted mt-1.5">Cyan times are held kills. A time jumps to 2 s before its kill.</p>
        </div>
      )}

      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Kills · {deathmatch ? roundLabel(round) : `round ${round.n}`}</div>
        {kills.length === 0 ? (
          <p className="text-xs text-text-muted">No kills this round.</p>
        ) : (
          <ul className={`space-y-0.5${deathmatch ? ' max-h-[50vh] overflow-y-auto pr-1' : ''}`}>
            {kills.map((kill, i) => {
              const killer = label(kill.killer)
              const victim = label(kill.victim)
              const selfDeath = kill.killer === kill.victim
              const since = round.barrierMs == null ? '' : `+${((kill.t - round.barrierMs) / 1000).toFixed(1)}`
              return (
                <li key={`${kill.t}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSeek(kill.t - 2000, round)}
                    title="Jump to 2 s before this kill"
                    className={`w-full grid grid-cols-[3rem_1fr_1fr_1fr] gap-2 text-left text-xs rounded px-1 py-0.5 hover:bg-bg-elevated transition-colors ${
                      kill.t <= t ? '' : 'opacity-40'
                    }`}
                  >
                    <span className="font-stats text-text-muted">{since}</span>
                    <span className={`truncate ${killer.tone}`}>{selfDeath ? '' : killer.name}</span>
                    <span className="truncate text-text-muted">
                      {selfDeath ? 'self' : weaponLabel(kill.weapon == null ? null : bundle.weapons[kill.weapon])}
                    </span>
                    <span className={`truncate ${victim.tone}`}>{victim.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
