import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Play } from 'lucide-react'
import GameImage from '../GameImage'
import { useGameContent } from '../../hooks/useGameContent'
import { useResource } from '../../hooks/useResource'
import { mapImageFor } from '../../lib/gameContent'
import { formatScore } from '../../lib/homeStats'
import type { ReplayBundle } from '../../lib/replayBundle'
import { replayMatchesResource, replayRoundToPlay, type ReplayMatch } from '../../lib/replayMatches'
import { getReplayBundle } from '../../lib/replays'
import { replayStepTimes, type ReplayPlay } from '../../lib/replayToPlay'

interface ReplayPickerProps {
  /** The editor's map: its matches are listed first. */
  currentMap: string
  /** Something is drawn: loading a round asks before it replaces the steps. */
  hasElements: boolean
  onLoad(play: ReplayPlay): void
  /** **Play match** (§2.8): the whole match in the editor's replay mode. Adds steps, replaces none. */
  onPlay(bundle: ReplayBundle, matchId: string): void
}

const RESULT_CHIP: Record<ReplayMatch['result'], { label: string; className: string }> = {
  W: { label: 'W', className: 'text-val-cyan bg-val-cyan/10' },
  L: { label: 'L', className: 'text-val-red bg-val-red/10' },
  draw: { label: 'D', className: 'text-val-yellow bg-val-yellow/10' },
}

const smallButton =
  'px-2.5 py-1 rounded-md text-xs font-medium text-val-cyan border border-val-cyan/25 bg-val-cyan/10 hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const errorBox = 'border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2'

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** One bundle load, tagged with its match so a late answer for another pick is ignored. */
interface Loaded {
  matchId: string
  bundle: ReplayBundle | null
  error: string | null
}

/**
 * "From a replay" (docs/plays-editor-v2.md §2.7, §2.8): the user's matches
 * that have a minimap bundle, then that bundle's rounds. **Play match** opens
 * the whole match in the editor's replay mode; **Load round** turns one round
 * into a play through `roundToPlay`, and over a play with something drawn it
 * asks once before replacing the steps.
 */
export default function ReplayPicker({ currentMap, hasElements, onLoad, onPlay }: ReplayPickerProps) {
  const { registry } = useGameContent()
  const matches = useResource(replayMatchesResource)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [roundN, setRoundN] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    getReplayBundle(matchId).then(
      bundle => {
        if (!cancelled) setLoaded({ matchId, bundle, error: bundle ? null : 'This match has no replay attached any more.' })
      },
      (e: unknown) => {
        if (!cancelled) setLoaded({ matchId, bundle: null, error: messageOf(e) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [matchId])

  // The current map's matches first, each group newest first (the list comes sorted by date).
  const rows = useMemo(() => {
    const all = matches.data ?? []
    return [...all.filter(m => sameName(m.map, currentMap)), ...all.filter(m => !sameName(m.map, currentMap))]
  }, [matches.data, currentMap])

  const current = loaded && loaded.matchId === matchId ? loaded : null
  const bundle = current?.bundle ?? null
  const round = bundle && roundN !== null ? (bundle.rounds.find(r => r.n === roundN) ?? null) : null

  /** The step names the round would become; null when the conversion cannot say. */
  const preview = useMemo(() => {
    if (!bundle || !round) return null
    try {
      return replayStepTimes(bundle, round).map(s => s.name)
    } catch {
      return null
    }
  }, [bundle, round])

  const pickMatch = (id: string | null) => {
    // A failed load is retried on the next pick: show the spinner, not the old error.
    if (loaded?.error) setLoaded(null)
    setMatchId(id)
    setRoundN(null)
    setConfirming(false)
    setLoadError(null)
  }

  const pickRound = (n: number) => {
    setRoundN(n)
    setConfirming(false)
    setLoadError(null)
  }

  const load = () => {
    if (!bundle || roundN === null || !registry) return
    if (hasElements && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    try {
      const play = replayRoundToPlay(bundle, roundN, registry)
      setLoadError(null)
      onLoad(play)
    } catch (e) {
      setLoadError(messageOf(e))
    }
  }

  // ── A match picked: its rounds ────────────────────────────────────────────

  if (matchId) {
    const picked = rows.find(m => m.matchId === matchId)
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => pickMatch(null)}
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-val-cyan transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {picked ? `${picked.map} · ${picked.agent}` : 'All matches'}
        </button>

        {!current && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading the replay…
          </div>
        )}
        {current?.error && <div className={errorBox}>{current.error}</div>}

        {bundle && (
          <>
            <button
              type="button"
              onClick={() => onPlay(bundle, matchId)}
              disabled={!registry}
              title="Watch the match here, pause on a moment and capture it as a step"
              className={`${smallButton} inline-flex items-center gap-1.5`}
            >
              <Play className="w-3 h-3" />
              Play match
            </button>

            <div role="group" aria-label="Rounds" className="grid grid-cols-6 gap-1">
              {bundle.rounds.map(r => (
                <button
                  key={r.n}
                  type="button"
                  onClick={() => pickRound(r.n)}
                  aria-pressed={roundN === r.n}
                  title={`Round ${r.n}: ${r.winner === 'ALLY' ? 'won' : 'lost'}${r.how ? ` by ${r.how}` : ''}`}
                  className={`flex flex-col items-center gap-0.5 rounded-md py-1 text-[10px] transition-colors ${
                    roundN === r.n ? 'bg-bg-elevated ring-1 ring-val-cyan/60' : 'bg-bg-primary hover:bg-bg-elevated'
                  }`}
                >
                  <span className="flex items-center gap-1 font-stats text-xs text-text-primary">
                    <span className={`w-1.5 h-1.5 rounded-full ${r.winner === 'ALLY' ? 'bg-val-green' : 'bg-val-red'}`} />
                    {r.n}
                  </span>
                  <span className="text-text-muted">{r.side === 'attacker' ? 'ATK' : r.side === 'defender' ? 'DEF' : '–'}</span>
                </button>
              ))}
            </div>

            {preview && preview.length > 0 && <div className="text-[11px] text-text-muted">{preview.join(' · ')}</div>}

            {confirming ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <span>Replace the current steps with this round?</span>
                <button type="button" onClick={load} className={smallButton}>
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-xs text-text-secondary hover:text-val-cyan underline transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={load} disabled={roundN === null || !registry} className={smallButton}>
                Load round
              </button>
            )}
          </>
        )}

        {loadError && <div className={errorBox}>{loadError}</div>}
      </div>
    )
  }

  // ── The matches with a replay ─────────────────────────────────────────────

  if (matches.loading && !matches.data) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading your replays…
      </div>
    )
  }

  if (matches.error && !matches.data) return <div className={errorBox}>{matches.error}</div>

  if (rows.length === 0) {
    return (
      <p className="text-xs text-text-muted">No replay attached yet. Attach one on a match's review page, Map tab.</p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {rows.map(m => {
        const result = RESULT_CHIP[m.result]
        return (
          <li key={m.matchId}>
            <button
              type="button"
              onClick={() => pickMatch(m.matchId)}
              className="w-full flex items-center gap-2.5 text-left rounded-lg border border-bg-elevated bg-bg-primary px-2 py-1.5 hover:border-val-cyan/50 transition-colors"
            >
              <GameImage
                kind="map"
                src={mapImageFor({ map_id: m.mapId, map: m.map })}
                alt=""
                className="w-12 h-8 shrink-0 rounded object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{m.map}</span>
                <span className="block text-[11px] text-text-muted truncate">
                  {m.agent}
                  {m.playedAt ? ` · ${shortDate(m.playedAt)}` : ''}
                </span>
              </span>
              <span className="shrink-0 font-stats text-xs text-text-secondary">{formatScore(m.score)}</span>
              <span className={`shrink-0 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${result.className}`}>
                {result.label}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
