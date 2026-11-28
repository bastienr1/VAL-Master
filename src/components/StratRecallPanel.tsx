import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { parsePlayDoc, PlayDocError, type OriginPage, type PlayDoc, type PlayStep } from '../lib/playDoc'
import { playsResource } from '../lib/plays'
import type { ReplayRound } from '../lib/replayBundle'
import { roundSide } from '../lib/replayFrame'
import { tagCounts } from '../lib/stratCard'
import { defaultRecallStep, recallOverlay, recallStrats } from '../lib/stratRecall'
import { addStratRound, removeStratRound, stratRoundsResource } from '../lib/stratRounds'

interface StratRecallPanelProps {
  matchId: string
  round: ReplayRound
  /** The map's display name and Riot id, as plays store them. */
  mapName: string
  mapUuid: string | null
  /** The page the panel is on: where a "Seen here" link leads back to. */
  page: OriginPage
  /** The replay time on screen, kept on a "Seen here" link. */
  getMs: () => number
  /** Draws a strat's step faded over the round (null clears it). Absent where the map cannot. */
  onOverlay?: (step: PlayStep | null) => void
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const badge = 'text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap'
const chip = (on: boolean) =>
  `text-[10px] px-1.5 py-0.5 rounded border transition-colors whitespace-nowrap ${
    on ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/30' : 'text-text-secondary border-bg-elevated hover:text-text-primary'
  }`

/** A stored play document read for drawing; null when it cannot be. */
function docOf(raw: unknown): PlayDoc | null {
  if (raw == null) return null
  try {
    return parsePlayDoc(raw)
  } catch (e) {
    if (e instanceof PlayDocError) return null
    throw e
  }
}

/**
 * Strats under the review's or the report's map (docs/plays-editor-v2.md
 * §2.31): the user's strats for this map and the side of the round on screen,
 * those seen here or made from this round first. **Show** draws one faded over
 * the round as it plays (its last step, or the one picked); **Seen here** links
 * the strat to this round, so it collects the rounds its pattern came up in.
 */
export default function StratRecallPanel({ matchId, round, mapName, mapUuid, page, getMs, onOverlay }: StratRecallPanelProps) {
  const [open, setOpen] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [shown, setShown] = useState<{ playId: string; step: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const { data: plays } = useResource(playsResource)
  const { data: links, error: linksError } = useResource(stratRoundsResource)

  const side = roundSide(round)
  const at = { matchId, round: round.n, side, map: mapName, mapUuid }
  const candidates = recallStrats(plays ?? [], links ?? [], at)
  const items = recallStrats(plays ?? [], links ?? [], at, tags)
  const tagChips = tagCounts(candidates.map(i => i.card))

  // The strat shown, drawn over the map; cleared when it is hidden or the panel goes.
  const shownPlay = shown ? (plays ?? []).find(p => p.id === shown.playId) : undefined
  // Parsed once per play row: the step's identity is what tells the map to redraw.
  const shownDoc = useMemo(() => (shownPlay ? docOf(shownPlay.play) : null), [shownPlay])
  const stepIndex = shown?.step ?? 0
  const overlay = useMemo(() => {
    const step = shownDoc?.steps[stepIndex]
    return step ? recallOverlay(step) : null
  }, [shownDoc, stepIndex])
  const shownStep = overlay
  useEffect(() => {
    onOverlay?.(overlay)
  }, [onOverlay, overlay])
  useEffect(() => () => onOverlay?.(null), [onOverlay])

  const toggleSeen = async (playId: string, linkId: string | null) => {
    setBusy(playId)
    setProblem(null)
    try {
      if (linkId) await removeStratRound(linkId)
      else await addStratRound({ play_id: playId, match_id: matchId, round: round.n, replay_ms: Math.max(0, Math.round(getMs())), page })
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2 space-y-2" aria-label="Strats for this round">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider hover:text-text-secondary"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Strats · {mapName} {side === 'attack' ? 'attack' : 'defense'}
        <span className="font-stats normal-case">{candidates.length}</span>
        {shownStep && <span className="ml-auto normal-case text-val-cyan">showing 1</span>}
      </button>

      {open && (
        <>
          {tagChips.length > 0 && (
            <div role="group" aria-label="Strat tags" className="flex flex-wrap gap-1">
              {tagChips.map(({ tag, count }) => {
                const on = tags.some(t => sameTag(t, tag))
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTags(on ? tags.filter(t => !sameTag(t, tag)) : [...tags, tag])}
                    className={chip(on)}
                  >
                    {tag} <span className="font-stats text-text-muted">{count}</span>
                  </button>
                )
              })}
            </div>
          )}

          {items.length === 0 ? (
            <p className="text-xs text-text-muted">
              {candidates.length === 0
                ? `No strat for ${mapName} on ${side} yet. Strategize makes one from this moment.`
                : 'No strat carries all these tags.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map(item => {
                const isShown = shown?.playId === item.play.id
                const doc = isShown ? shownDoc : null
                return (
                  <li key={item.play.id} className={`rounded-md border px-2 py-1.5 space-y-1 ${isShown ? 'border-val-cyan/40 bg-val-cyan/5' : 'border-bg-elevated'}`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Link to={`/plays/${item.play.id}`} className="text-xs font-semibold text-text-primary hover:text-val-cyan truncate" title="Open in Plays">
                        {item.play.title}
                      </Link>
                      {item.fromRound ? (
                        <span className={`${badge} bg-bg-elevated text-text-secondary`}>made here</span>
                      ) : (
                        item.fromMatch && <span className={`${badge} bg-bg-elevated text-text-secondary`}>this match</span>
                      )}
                      {item.rounds > 0 && (
                        <span className="text-[10px] text-text-muted whitespace-nowrap" title="Rounds it is marked as seen on">
                          {item.rounds} round{item.rounds === 1 ? '' : 's'}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setShown(isShown ? null : { playId: item.play.id, step: defaultRecallStep(docOf(item.play.play)) })}
                          disabled={!onOverlay}
                          aria-pressed={isShown}
                          title={onOverlay ? (isShown ? 'Hide it from the map' : 'Draw it faded over the round') : 'This map cannot draw a strat over it'}
                          className={`${chip(isShown)} inline-flex items-center gap-1 disabled:opacity-40`}
                        >
                          {isShown ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {isShown ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleSeen(item.play.id, item.link?.id ?? null)}
                          disabled={busy === item.play.id || Boolean(linksError)}
                          aria-pressed={Boolean(item.link)}
                          title={item.link ? 'Seen here: press to take it off this round' : `Mark this strat as seen on round ${round.n}`}
                          className={`${chip(Boolean(item.link))} inline-flex items-center gap-1 disabled:opacity-40`}
                        >
                          {item.link && <Check className="w-3 h-3" />}
                          Seen here
                        </button>
                      </span>
                    </div>
                    {item.card?.when && (
                      <p className="text-[11px] text-text-secondary line-clamp-2">
                        <span className="text-text-muted">When you see </span>
                        {item.card.when}
                      </p>
                    )}
                    {item.card && item.card.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.card.tags.map(tag => (
                          <span key={tag} className={`${badge} bg-val-cyan/10 text-val-cyan`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {isShown && doc && doc.steps.length > 1 && (
                      <div role="group" aria-label="Step shown" className="flex flex-wrap gap-1">
                        {doc.steps.map((s, i) => (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={shown?.step === i}
                            onClick={() => setShown({ playId: item.play.id, step: i })}
                            className={chip(shown?.step === i)}
                          >
                            {i + 1} {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {(problem || linksError) && <p className="text-[11px] text-val-red">{problem ?? linksError}</p>}
        </>
      )}
    </section>
  )
}
