import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Play } from 'lucide-react'
import GameImage from '../GameImage'
import { useGameContent } from '../../hooks/useGameContent'
import { useResource } from '../../hooks/useResource'
import { agentImageFor, mapImageFor } from '../../lib/gameContent'
import { formatScore } from '../../lib/homeStats'
import type { ReplayBundle } from '../../lib/replayBundle'
import { filterReplayMatches, isFiltering, NO_REPLAY_FILTER, replayFilterOptions, type ReplayFilter } from '../../lib/replayFilters'
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

const RESULT_TEXT: Record<ReplayMatch['result'], string> = {
  W: 'text-val-cyan',
  L: 'text-val-red',
  draw: 'text-val-yellow',
}

const filterField = 'w-full rounded-md border border-bg-elevated bg-bg-primary px-1.5 py-1 text-xs text-text-primary focus:border-val-cyan/50 focus:outline-none'
const resultButton = (on: boolean, active: string) =>
  `px-2.5 py-0.5 rounded-md border text-xs font-medium transition-colors ${on ? active : 'border-bg-elevated text-text-secondary hover:text-text-primary'}`

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
 * asks once before replacing the steps. The list filters by agent, map and
 * win or loss, and its rows are the home page's Recent Matches rows.
 */
export default function ReplayPicker({ currentMap, hasElements, onLoad, onPlay }: ReplayPickerProps) {
  const { registry } = useGameContent()
  const matches = useResource(replayMatchesResource)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [roundN, setRoundN] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilterState] = useState<ReplayFilter>(NO_REPLAY_FILTER)

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

  const options = useMemo(() => replayFilterOptions(rows), [rows])
  const shown = useMemo(() => filterReplayMatches(rows, filter), [rows, filter])

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

  const { agents, maps } = options
  const setFilter = (change: Partial<ReplayFilter>) => setFilterState(f => ({ ...f, ...change }))
  const toggleResult = (result: 'W' | 'L') => setFilter({ result: filter.result === result ? null : result })

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <select value={filter.agent} onChange={e => setFilter({ agent: e.target.value })} aria-label="Filter by agent" className={filterField}>
          <option value="">All agents</option>
          {agents.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={filter.map} onChange={e => setFilter({ map: e.target.value })} aria-label="Filter by map" className={filterField}>
          <option value="">All maps</option>
          {maps.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <div role="group" aria-label="Filter by result" className="flex gap-1">
          <button type="button" onClick={() => toggleResult('W')} aria-pressed={filter.result === 'W'} className={resultButton(filter.result === 'W', 'text-val-cyan border-val-cyan/40 bg-val-cyan/15')}>
            Win
          </button>
          <button type="button" onClick={() => toggleResult('L')} aria-pressed={filter.result === 'L'} className={resultButton(filter.result === 'L', 'text-val-red border-val-red/40 bg-val-red/15')}>
            Loss
          </button>
        </div>
        <span className="ml-auto font-stats text-[11px] text-text-muted">
          {shown.length} of {rows.length}
        </span>
        {isFiltering(filter) && (
          <button type="button" onClick={() => setFilterState(NO_REPLAY_FILTER)} className="text-[11px] text-text-secondary hover:text-val-cyan underline transition-colors">
            Clear
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-text-muted">No replay matches these filters.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map(m => (
            <li key={m.matchId}>
              {/* The Recent Matches row of the home page, as a button that opens the match here. */}
              <button
                type="button"
                onClick={() => pickMatch(m.matchId)}
                className="group relative w-full flex items-center gap-2.5 min-h-[4.25rem] px-3 text-left rounded-xl overflow-hidden border border-bg-elevated hover:border-val-cyan/40 transition-colors"
              >
                <GameImage
                  kind="map"
                  src={mapImageFor({ map_id: m.mapId, map: m.map })}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-25 group-hover:opacity-35 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/90 via-bg-primary/50 to-bg-primary/80" />

                <div className="relative w-[4.5rem] shrink-0">
                  <div className="font-heading font-bold uppercase tracking-wide leading-tight truncate">{m.map}</div>
                  <div className={`font-stats text-base leading-tight ${RESULT_TEXT[m.result]}`}>{formatScore(m.score)}</div>
                </div>

                <div className="relative flex items-center gap-2 min-w-0 flex-1">
                  <GameImage
                    kind="agent"
                    src={agentImageFor({ agent_id: m.agentId, agent: m.agent })}
                    alt=""
                    className="w-8 h-8 rounded-full border-2 border-bg-card shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{m.agent}</span>
                    {m.playedAt && <span className="block text-[11px] text-text-muted truncate">{shortDate(m.playedAt)}</span>}
                  </span>
                </div>

                <div className="relative text-right shrink-0">
                  <div className="font-stats text-base leading-tight text-text-primary">
                    {m.acs} <span className="text-[9px] uppercase tracking-wider text-text-muted">ACS</span>
                  </div>
                  <div className="font-stats text-[11px] text-text-secondary">
                    {m.kills}/{m.deaths}/{m.assists}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
