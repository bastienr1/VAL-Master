import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, ExternalLink, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import ReferenceCapturePanel from '../components/ReferenceCapturePanel'
import ReferenceNotesPanel from '../components/ReferenceNotesPanel'
import { useSplitter, SplitterHandle } from '../components/ColumnSplitter'
import { useYouTubePlayer } from '../hooks/useYouTubePlayer'
import { deleteNote, getNotes, getReview } from '../lib/referenceReviews'
import { REFERENCE_LABEL_COLORS, hexWithAlpha } from '../lib/tagColors'
import { formatTime } from '../lib/youtube'
import type { ReferenceNote, ReferenceReview } from '../lib/types'

const PLAYER_ELEMENT_ID = 'pro-study-player'

/**
 * Note-anchored timeline.
 *
 * A pro VOD has no Henrik round data — the same constraint that killed the
 * Valoplant embed — so the tape is marked by the notes the user took and
 * nothing else. No event lanes, no round headers.
 */
function NoteTimeline({
  notes,
  duration,
  currentTime,
  onSeek,
}: {
  notes: ReferenceNote[]
  duration: number
  currentTime: number
  onSeek: (seconds: number) => void
}) {
  if (duration <= 0) return null

  return (
    <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2.5">
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-bg-elevated" />

        {notes.map(note => {
          const pct = Math.min(100, Math.max(0, (note.timestamp_seconds / duration) * 100))
          const color = note.label ? REFERENCE_LABEL_COLORS[note.label] : '#94A3B8'
          return (
            <button
              key={note.id}
              type="button"
              onClick={() => onSeek(note.timestamp_seconds)}
              title={`${formatTime(note.timestamp_seconds)}${note.label ? ` · ${note.label}` : ''}`}
              style={{
                left: `${pct}%`,
                backgroundColor: color,
                borderColor: hexWithAlpha(color, 0.4),
              }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border-2 hover:scale-150 transition-transform"
            />
          )
        })}

        {/* Playhead */}
        <div
          style={{ left: `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%` }}
          className="absolute top-0 bottom-0 w-px bg-val-cyan -translate-x-1/2 pointer-events-none"
        />
      </div>
      <div className="flex justify-between text-[10px] font-stats text-text-muted mt-1">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

export default function ProStudyReview() {
  const { id } = useParams<{ id: string }>()

  const [review, setReview] = useState<ReferenceReview | null>(null)
  const [notes, setNotes] = useState<ReferenceNote[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [captureOpen, setCaptureOpen] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)

  const {
    ready, isPlaying, currentTime, duration, embedBlocked,
    togglePlay, seek, seekTo, pause,
  } = useYouTubePlayer(PLAYER_ELEMENT_ID, review?.video_id ?? null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      try {
        const found = await getReview(id!)
        if (cancelled) return
        if (!found) {
          setNotFound(true)
          return
        }
        setReview(found)
        const loadedNotes = await getNotes(found.id)
        if (!cancelled) setNotes(loadedNotes)
      } catch (err) {
        console.error('Failed to load pro VOD:', err)
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id])

  const openCapture = useCallback(() => {
    if (!ready) return
    pause()
    setEditingNoteId(null)
    setCaptureOpen(true)
  }, [ready, pause])

  const openEdit = useCallback((note: ReferenceNote) => {
    pause()
    setEditingNoteId(note.id)
    setCaptureOpen(true)
  }, [pause])

  const closeCapture = useCallback(() => {
    setCaptureOpen(false)
    setEditingNoteId(null)
  }, [])

  const handleNoteAdded = useCallback((note: ReferenceNote) => {
    setNotes(prev => [...prev, note].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds))
  }, [])

  const handleNoteUpdated = useCallback((note: ReferenceNote) => {
    setNotes(prev => prev.map(n => (n.id === note.id ? note : n)))
  }, [])

  const handleDelete = useCallback(async (note: ReferenceNote) => {
    try {
      await deleteNote(note.id)
      setNotes(prev => prev.filter(n => n.id !== note.id))
      // Don't leave the editor holding a note that no longer exists.
      setEditingNoteId(prev => (prev === note.id ? null : prev))
    } catch (err) {
      console.error('Failed to delete note:', err)
    }
  }, [])

  // Same shortcuts as the VOD workstation, minus the round-specific ones.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seek(e.shiftKey ? -10 : -5)
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(e.shiftKey ? 10 : 5)
          break
        case 't':
        case 'T':
          e.preventDefault()
          openCapture()
          break
        case 'Escape':
          e.preventDefault()
          closeCapture()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, seek, openCapture, closeCapture])

  const { width: notesPanelWidth, dragHandlers } = useSplitter({
    initialWidth: 320,
    minWidth: 240,
    maxWidth: 480,
    storageKey: 'proStudyReview.notesPanelWidth',
  })

  const editingNote = useMemo(
    () => (editingNoteId ? notes.find(n => n.id === editingNoteId) ?? null : null),
    [editingNoteId, notes],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !review) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-xl font-heading font-bold mb-4">Pro VOD not found</h2>
        <Link to="/study" className="flex items-center gap-1 text-text-secondary hover:text-val-cyan transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to Pro Study
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-1 mb-2">
        <Link to="/study" className="text-text-secondary hover:text-val-cyan transition-colors text-xs">
          Pro Study
        </Link>
        <span className="text-text-muted text-xs">/</span>
        <span className="text-text-primary text-xs font-medium">
          {review.player}
          {review.agent ? ` · ${review.agent}` : ''}
          {review.map ? ` on ${review.map}` : ''}
        </span>
        <span className="ml-auto text-text-muted text-xs">
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Header card */}
      <div className="bg-bg-card border border-bg-elevated rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-lg font-bold tracking-wide">{review.player}</h1>
        {review.team && (
          <span className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[10px] font-medium">
            {review.team}
          </span>
        )}
        {review.agent && (
          <span className="px-2 py-0.5 rounded-full bg-val-cyan/10 text-val-cyan border border-val-cyan/20 text-[10px] font-medium">
            {review.agent}
          </span>
        )}
        {review.map && (
          <span className="px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary text-[10px] font-medium">
            {review.map}
          </span>
        )}
        {review.event && <span className="text-[11px] text-text-muted">{review.event}</span>}
        {review.played_at && (
          <span className="font-stats text-[10px] text-text-muted ml-auto">{review.played_at}</span>
        )}
      </div>

      <div className="flex gap-4">
        {/* === LEFT: video + controls === */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="relative w-full bg-black rounded-xl overflow-hidden" style={{ paddingBottom: '56.25%' }}>
            <div id={PLAYER_ELEMENT_ID} className="absolute inset-0 w-full h-full" />
          </div>

          {/* Embed refused by the channel — link out, same pattern as the Valoplant row. */}
          {embedBlocked && (
            <div className="bg-bg-card border border-val-yellow/30 rounded-lg px-4 py-2.5 flex items-center gap-3">
              <ExternalLink className="w-4 h-4 text-val-yellow shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-secondary">
                  <strong className="text-val-yellow">This channel blocks embedding.</strong> Notes still save — watch it on YouTube.
                </p>
                <a
                  href={review.youtube_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-val-cyan hover:underline break-all"
                >
                  {review.youtube_url}
                </a>
              </div>
              <a
                href={review.youtube_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-val-yellow/10 text-val-yellow border border-val-yellow/20 rounded-lg text-xs font-medium hover:bg-val-yellow/20 transition-colors"
              >
                Watch on YouTube
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Playback controls */}
          <div className="bg-bg-card border border-bg-elevated rounded-lg px-4 py-2 flex items-center gap-3">
            <button
              onClick={() => seek(-5)}
              className="text-text-muted hover:text-val-cyan transition-colors"
              title="Back 5s (←)"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={togglePlay}
              className="w-9 h-9 rounded-full bg-val-cyan/10 border border-val-cyan/20 flex items-center justify-center text-val-cyan hover:bg-val-cyan/20 transition-colors"
              title="Play/Pause (Space)"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              onClick={() => seek(5)}
              className="text-text-muted hover:text-val-cyan transition-colors"
              title="Forward 5s (→)"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 ml-2">
              <Clock className="w-3.5 h-3.5 text-text-muted" />
              <span className="font-stats text-sm text-text-secondary">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="ml-auto text-[10px] text-text-muted hidden md:flex items-center gap-3">
              <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">Space</kbd> play/pause</span>
              <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">←→</kbd> ±5s</span>
              <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> capture</span>
            </div>
          </div>

          <NoteTimeline notes={notes} duration={duration} currentTime={currentTime} onSeek={seekTo} />

          <ReferenceCapturePanel
            reviewId={review.id}
            currentTime={currentTime}
            isPaused={!isPlaying}
            isOpen={captureOpen}
            editingNote={editingNote}
            onClose={closeCapture}
            onNoteAdded={handleNoteAdded}
            onNoteUpdated={handleNoteUpdated}
          />

          {review.notes && (
            <div className="bg-bg-card border border-bg-elevated rounded-lg px-4 py-3">
              <h2 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">From Notion</h2>
              <p className="text-sm text-text-secondary whitespace-pre-line">{review.notes}</p>
            </div>
          )}
        </div>

        <SplitterHandle {...dragHandlers} />

        {/* === RIGHT: notes rail === */}
        <div style={{ width: notesPanelWidth, flexShrink: 0 }}>
          <ReferenceNotesPanel
            notes={notes}
            editingNoteId={editingNoteId}
            onSeek={seekTo}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        </div>
      </div>
    </div>
  )
}
