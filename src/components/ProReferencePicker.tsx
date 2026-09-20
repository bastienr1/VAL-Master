import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Film, X } from 'lucide-react'
import {
  addProReference,
  listCandidateReferences,
  listProReferencesForMatch,
  removeProReference,
  type CandidateGroups,
  type ProReferenceRow,
} from '../lib/proReferences'
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

export default function ProReferencePicker({ matchId, map, agent }: ProReferencePickerProps) {
  const [rows, setRows] = useState<ProReferenceRow[]>([])
  const [candidates, setCandidates] = useState<CandidateGroups>({ exact: [], sameMap: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([listProReferencesForMatch(matchId), listCandidateReferences(map, agent)])
      .then(([attached, groups]) => {
        if (cancelled) return
        setRows(attached)
        setCandidates(groups)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
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
  const nothingOnThisMap =
    !loading && candidates.exact.length === 0 && candidates.sameMap.length === 0

  return (
    <div>
      <label className="text-[10px] text-text-muted uppercase tracking-wider">{heading}</label>

      {rows.length > 0 && (
        <div className="mt-1 space-y-1">
          {rows.map(row => (
            <div
              key={row.id}
              className="flex items-center gap-2 bg-bg-elevated border border-bg-card rounded-lg px-2.5 py-1.5"
            >
              <Film className="w-3.5 h-3.5 text-val-cyan shrink-0" />
              <span className="min-w-0 flex-1 text-sm text-text-primary truncate">
                {row.review.player}
                <span className="text-text-secondary">
                  {row.review.agent || row.review.map ? ' — ' : ''}
                  {[row.review.agent, row.review.map].filter(Boolean).join(' · ')}
                </span>
              </span>
              {stamp(row.review) && (
                <span className="font-stats text-[10px] text-text-muted shrink-0">
                  {stamp(row.review)}
                </span>
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
                onClick={() => handleRemove(row)}
                title="Remove this pro reference"
                className="text-text-muted hover:text-val-red transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
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
