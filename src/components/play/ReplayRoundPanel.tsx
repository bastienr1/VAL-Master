import { useMemo, useSyncExternalStore } from 'react'
import type { ReplayBundle, ReplayRound } from '../../lib/replayBundle'
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
}

function phaseOf(round: ReplayRound, t: number): string {
  if (round.barrierMs == null) return ''
  if (t < round.barrierMs) return `buy phase · barrier in ${Math.ceil((round.barrierMs - t) / 1000)} s`
  if (round.endMs != null && t >= round.endMs) return `${round.winner === 'ALLY' ? 'won' : 'lost'} · ${round.how ?? ''}`
  return `+${((t - round.barrierMs) / 1000).toFixed(1)} s`
}

/**
 * The right-hand panel while a replay plays (docs/plays-editor-v2.md §2.12),
 * the VOD review's: the round and its score so far, the map's layers, every
 * round to jump to, and the round's kills, each jumping to 2 s before it.
 */
export default function ReplayRoundPanel({ bundle, clock, nameOf, layers, onToggleLayer, onRound, onSeek }: ReplayRoundPanelProps) {
  const shown = useSyncExternalStore(clock.subscribe, clock.get)
  const round = shown?.round ?? bundle.rounds[0]
  const t = shown?.ms ?? round.buyStartMs

  const playerOf = useMemo(() => new Map(bundle.players.map(p => [p.subject, p])), [bundle])
  const kills = useMemo(() => bundle.kills.filter(k => k.round === round.n), [bundle, round.n])
  const wonBefore = bundle.rounds.filter(r => r.n < round.n && r.winner === 'ALLY').length
  const lostBefore = bundle.rounds.filter(r => r.n < round.n && r.winner === 'ENEMY').length

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
          <span className="font-stats text-text-primary">R{round.n}</span>
          <span className="text-text-muted">{round.side ?? ''}</span>
          <span className="font-stats text-text-secondary">
            {wonBefore}–{lostBefore}
          </span>
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
      </div>

      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Kills · round {round.n}</div>
        {kills.length === 0 ? (
          <p className="text-xs text-text-muted">No kills this round.</p>
        ) : (
          <ul className="space-y-0.5">
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
