import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Film, X } from 'lucide-react'
import {
  addProReference,
  listCandidateReferences,
  listProReferencesForMatch,
  listReviewMarkers,
  removeProReference,
  type CandidateGroups,
  type ProReferenceRow,
  type ReviewMarker,
} from '../lib/proReferences'
import { formatTimestamp } from '../lib/playbookParser'
import type { ReferenceReview } from '../lib/types'

/**
 * The pro VODs attached to this match.
 *
 * The dropdown is pre-filtered to the match's map and grouped so the exact
 * map+agent fits come first: with ~70 seeded rows an exact hit is often one or
 * two, and a picker that looks empty reads as broken. Added rows open in a new
 * tab — the match VOD's position is worth more than the navigation.
 */

interface ProReferencePickerProps {
  matchId: string
  map: string | null
  agent: string | null
}

const ADD_PLACEHOLDER = ''

/** "12 Mar 2026", or the event when the seed row carried no date. */
function stamp(review: ProReferenceRow['review']): string | null {
  if (review.played_at) {
    const date = new Date(`${review.played_at}T00:00:00`)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    }
  }
  return review.event
}

function optionLabel(review: ReferenceReview): string {
  return [review.player, review.team && `(${review.team})`, review.agent, review.map]
    .filter(Boolean)
    .join(' · ')
}

/**
 * One attached pro VOD: the row, and behind a toggle the video itself plus the
 * moments already marked on it.
 *
 * Same shape as the playbook half of the dock — collapsed by default, iframe
 * mounted only on expand, no IFrame API. The marker dropdown is what makes it
 * more than an embed: a pro VOD you have already reviewed carries your notes
 * and tags at specific seconds, so the useful entry point is "jump to the
 * retake I marked", not "play from zero".
 */
function AttachedProVod({ row, onRemove }: { row: ProReferenceRow; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const [markers, setMarkers] = useState<ReviewMarker[] | null>(null)
  const [markersError, setMarkersError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState<number | null>(null)

  const videoId = row.review.video_id

  // Fetched on first expand, not with the row: four attached VODs should not
  // pull four sets of notes nobody has opened.
  useEffect(() => {
    if (!open || markers !== null) return
    let cancelled = false

    listReviewMarkers(row.reference_review_id)
      .then(found => {
        if (!cancelled) setMarkers(found)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setMarkers([])
        setMarkersError(err.message)
      })

    return () => {
      cancelled = true
    }
  }, [open, markers, row.reference_review_id])

  const noteMarkers = markers?.filter(m => m.kind === 'note') ?? []
  const tagMarkers = markers?.filter(m => m.kind === 'tag') ?? []

  return (
    <div className="bg-bg-elevated border border-bg-card rounded-lg">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {videoId ? (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            title={open ? 'Hide video' : 'Show video'}
            className="text-text-muted hover:text-val-cyan transition-colors shrink-0"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <Film className="w-3.5 h-3.5 text-val-cyan shrink-0" />
        )}

        <span className="min-w-0 flex-1 text-sm text-text-primary truncate">
          {row.review.player}
          <span className="text-text-secondary">
            {row.review.agent || row.review.map ? ' — ' : ''}
            {[row.review.agent, row.review.map].filter(Boolean).join(' · ')}
          </span>
        </span>

        {stamp(row.review) && (
          <span className="font-stats text-[10px] text-text-muted shrink-0">{stamp(row.review)}</span>
        )}
        <a
          href={`/study/${row.reference_review_id}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in Pro Study"
          className="text-text-muted hover:text-val-cyan transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button
          type="button"
          onClick={onRemove}
          title="Remove this pro reference"
          className="text-text-muted hover:text-val-red transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && videoId && (
        <div className="px-2.5 pb-2.5 space-y-1.5">
          {markers === null ? (
            <p className="text-[11px] text-text-muted">Loading moments…</p>
          ) : markers.length > 0 ? (
            <select
              value={seconds ?? ''}
              onChange={e => setSeconds(e.target.value === '' ? null : Number(e.target.value))}
              className="w-full bg-bg-card border border-bg-elevated rounded-lg px-2.5 py-1 text-[12px] text-text-primary focus:outline-none focus:border-val-cyan/30"
            >
              <option value="">Start from the beginning</option>
              {noteMarkers.length > 0 && (
                <optgroup label={`Notes (${noteMarkers.length})`}>
                  {noteMarkers.map(m => (
                    <option key={m.key} value={m.seconds}>
                      {formatTimestamp(m.seconds)} · {m.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {tagMarkers.length > 0 && (
                <optgroup label={`Tags (${tagMarkers.length})`}>
                  {tagMarkers.map(m => (
                    <option key={m.key} value={m.seconds}>
                      {formatTimestamp(m.seconds)} · {m.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          ) : (
            <p className="text-[11px] text-text-muted">
              {markersError
                ? `Couldn't load moments — ${markersError}`
                : 'No notes or tags on this VOD yet — capture some in Pro Study.'}
            </p>
          )}

          <div
            className="relative w-full bg-black rounded-lg overflow-hidden"
            style={{ paddingBottom: '56.25%' }}
          >
            {/* Keyed on the chosen second so picking a moment re-mounts the
                iframe there — the embed only reads `start` on load. */}
            <iframe
              key={`${videoId}-${seconds ?? 'start'}`}
              src={`https://www.youtube.com/embed/${videoId}?rel=0${seconds != null ? `&start=${seconds}` : ''}`}
              title={`${row.review.player} — ${row.review.map ?? 'pro VOD'}`}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProReferencePicker({ matchId, map, agent }: ProReferencePickerProps) {
  const [rows, setRows] = useState<ProReferenceRow[]>([])
  const [candidates, setCandidates] = useState<CandidateGroups>({ exact: [], sameMap: [] })
  /** The candidate query failed — "unknown", not "none". */
  const [candidatesFailed, setCandidatesFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Settled independently, not with Promise.all: the two reads hit different
  // tables and one failing must not blank the other. A rejected junction read
  // used to empty the candidate list, which rendered as "no pro VODs for this
  // map" — a wrong answer to a question the user did not ask.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const failures: string[] = []

    const attached = listProReferencesForMatch(matchId)
      .then(rows => {
        if (!cancelled) setRows(rows)
      })
      .catch((err: Error) => {
        failures.push(`attached pro VODs: ${err.message}`)
      })

    const candidates = listCandidateReferences(map, agent)
      .then(groups => {
        if (!cancelled) setCandidates(groups)
      })
      .catch((err: Error) => {
        failures.push(`pro VOD list: ${err.message}`)
        // Unknown, which is not the same as none — keep the empty state honest.
        if (!cancelled) setCandidatesFailed(true)
      })

    Promise.all([attached, candidates]).finally(() => {
      if (cancelled) return
      setLoading(false)
      if (failures.length > 0) setError(failures.join(' · '))
    })

    return () => {
      cancelled = true
    }
  }, [matchId, map, agent])

  const attachedIds = useMemo(() => new Set(rows.map(r => r.reference_review_id)), [rows])

  // An already-attached VOD is not worth offering twice.
  const offer = useMemo(
    () => ({
      exact: candidates.exact.filter(r => !attachedIds.has(r.id)),
      sameMap: candidates.sameMap.filter(r => !attachedIds.has(r.id)),
    }),
    [candidates, attachedIds],
  )

  const handleAdd = async (referenceReviewId: string) => {
    if (!referenceReviewId) return
    setBusy(true)
    setError(null)
    try {
      const added = await addProReference(matchId, referenceReviewId)
      if (added) setRows(prev => (prev.some(r => r.id === added.id) ? prev : [added, ...prev]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that pro VOD.')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (row: ProReferenceRow) => {
    setRows(prev => prev.filter(r => r.id !== row.id))
    try {
      await removeProReference(row.id)
    } catch (err) {
      console.error('Failed to remove the pro reference:', err)
      setRows(prev => [row, ...prev])
    }
  }

  if (!map) return null

  const heading = `Pro reference — ${map}${agent ? ` · ${agent}` : ''}`
  // Only claim there are none when the query actually answered.
  const nothingOnThisMap =
    !loading && !candidatesFailed && candidates.exact.length === 0 && candidates.sameMap.length === 0

  return (
    <div>
      <label className="text-[10px] text-text-muted uppercase tracking-wider">{heading}</label>

      {rows.length > 0 && (
        <div className="mt-1 space-y-1">
          {rows.map(row => (
            <AttachedProVod key={row.id} row={row} onRemove={() => handleRemove(row)} />
          ))}
        </div>
      )}

      {nothingOnThisMap ? (
        <p className="mt-1 text-[11px] text-text-muted">
          No pro VODs for {map} yet — capture one in Notion and re-seed, then find it in{' '}
          <a href="/study" className="text-val-cyan hover:underline">
            Pro Study
          </a>
          .
        </p>
      ) : (
        <select
          value={ADD_PLACEHOLDER}
          onChange={e => handleAdd(e.target.value)}
          disabled={loading || busy}
          className="w-full mt-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-val-cyan/30 disabled:opacity-60"
        >
          <option value={ADD_PLACEHOLDER}>
            {loading ? 'Loading…' : '+ Add pro match…'}
          </option>
          {offer.exact.length > 0 && (
            <optgroup label={`${map}${agent ? ` · ${agent}` : ''} (${offer.exact.length})`}>
              {offer.exact.map(r => (
                <option key={r.id} value={r.id}>
                  {optionLabel(r)}
                </option>
              ))}
            </optgroup>
          )}
          {offer.sameMap.length > 0 && (
            <optgroup label={`${map} · other agents (${offer.sameMap.length})`}>
              {offer.sameMap.map(r => (
                <option key={r.id} value={r.id}>
                  {optionLabel(r)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}

      {error && <p className="mt-1 text-[11px] text-val-red">{error}</p>}
    </div>
  )
}
