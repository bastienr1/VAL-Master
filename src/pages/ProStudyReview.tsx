import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock, ExternalLink, Pause, Play, SkipBack, SkipForward, VideoOff } from 'lucide-react'
import ReferenceCapturePanel from '../components/ReferenceCapturePanel'
import ReferenceNotesPanel from '../components/ReferenceNotesPanel'
import ChapterRail from '../components/ChapterRail'
import MomentTagLane from '../components/MomentTagLane'
import TagPicker from '../components/TagPicker'
import { useSplitter, SplitterHandle } from '../components/ColumnSplitter'
import { RAIL_MAX_RATIO } from '../lib/constants'
import GameImage from '../components/GameImage'
import { agentImageFor, mapImageFor } from '../lib/gameContent'
import { useGameContent } from '../hooks/useGameContent'
import { useYouTubePlayer } from '../hooks/useYouTubePlayer'
import { deleteNote, getNotes, getReviewWithGuide } from '../lib/referenceReviews'
import { addMomentTag, listMomentTags, listReviewTags, removeMomentTag } from '../lib/momentTags'
import { REFERENCE_LABEL_COLORS, hexWithAlpha } from '../lib/tagColors'
import { formatTime } from '../lib/youtube'
import type {
  MomentTag,
  ReferenceNote,
  ReferenceReview,
  ReferenceSection,
  ReviewRef,
  ReviewTag,
} from '../lib/types'

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
  const [sections, setSections] = useState<ReferenceSection[]>([])
  const [notes, setNotes] = useState<ReferenceNote[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [captureOpen, setCaptureOpen] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)

  // Moment tags: the vocabulary is global, the applications are this review's.
  const [tags, setTags] = useState<ReviewTag[]>([])
  const [moments, setMoments] = useState<MomentTag[]>([])
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [quickDropOpen, setQuickDropOpen] = useState(false)

  // Mounted so the header re-renders once the registry lands.
  useGameContent()

  const {
    containerRef, ready, isPlaying, currentTime, duration, embedBlocked,
    togglePlay, seek, seekTo, pause,
  } = useYouTubePlayer(review?.video_id ?? null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      try {
        // One call for both shapes: a Notion row simply comes back with no
        // chapters, and the screen renders its v1 layout unchanged.
        const found = await getReviewWithGuide(id!)
        if (cancelled) return
        if (!found) {
          setNotFound(true)
          return
        }
        setReview(found.review)
        setSections(found.sections)
        const [loadedNotes, loadedTags, loadedMoments] = await Promise.all([
          getNotes(found.review.id),
          listReviewTags(),
          listMomentTags({ type: 'reference', id: found.review.id }),
        ])
        if (!cancelled) {
          setNotes(loadedNotes)
          setTags(loadedTags)
          setMoments(loadedMoments)
        }
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

  const handleMomentTagAdded = useCallback((moment: MomentTag) => {
    // Replace rather than skip on a known id: applying a tag that already
    // exists can return the same row with a `note_id` it did not have before.
    setMoments(prev =>
      [...prev.filter(m => m.id !== moment.id), moment].sort((a, b) => a.video_ts - b.video_ts),
    )
  }, [])

  /** Deleting a tag cascades its moments server-side; mirror that locally. */
  const handleTagDeleted = useCallback((tagId: string) => {
    setMoments(prev => prev.filter(m => m.tag_id !== tagId))
    setTagFilter(prev => (prev === tagId ? null : prev))
  }, [])

  const handleRemoveMomentTag = useCallback(async (moment: MomentTag) => {
    // Optimistic: the row is the user's own and the only failure is a network
    // one, in which case the reload puts it back.
    setMoments(prev => prev.filter(m => m.id !== moment.id))
    try {
      await removeMomentTag(moment.id)
    } catch (err) {
      console.error('Failed to remove the moment tag:', err)
      setMoments(prev => [...prev, moment].sort((a, b) => a.video_ts - b.video_ts))
    }
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
        case 'g':
        case 'G':
          // Quick-drop: a tag with no note. Pauses like T does, so the moment
          // being marked is the one on screen.
          e.preventDefault()
          pause()
          setQuickDropOpen(true)
          break
        case 'Escape':
          e.preventDefault()
          setQuickDropOpen(false)
          closeCapture()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, seek, openCapture, closeCapture, pause])

  const { dragHandlers, panelProps: notesPanelProps } = useSplitter({
    initialWidth: 320,
    minWidth: 240,
    maxWidth: 480,
    maxRatio: RAIL_MAX_RATIO,
    storageKey: 'proStudyReview.notesPanelWidth',
    label: 'Resize notes panel',
  })

  // Its own key, so widening the chapters does not narrow the notes.
  const { dragHandlers: chapterDragHandlers, panelProps: chapterRailProps } = useSplitter({
    initialWidth: 300,
    minWidth: 220,
    maxWidth: 460,
    maxRatio: RAIL_MAX_RATIO,
    storageKey: 'proStudyReview.chapterRailWidth',
    side: 'left',
    label: 'Resize chapter rail',
  })

  const editingNote = useMemo(
    () => (editingNoteId ? notes.find(n => n.id === editingNoteId) ?? null : null),
    [editingNoteId, notes],
  )

  // `?t=90` seeks once the player is ready — the deep-link shape a tag explorer
  // would link to. Guarded by a ref so it fires once and never fights the user.
  const [searchParams] = useSearchParams()
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current || !ready) return
    const raw = searchParams.get('t')
    if (!raw) return
    const seconds = Number.parseInt(raw, 10)
    if (Number.isFinite(seconds) && seconds >= 0) {
      deepLinkDone.current = true
      seekTo(seconds)
    }
  }, [ready, searchParams, seekTo])

  const reviewRef = useMemo<ReviewRef | null>(
    () => (review ? { type: 'reference', id: review.id } : null),
    [review],
  )

  // A vault guide gets the chapter rail; a Notion pro VOD keeps the v1 layout.
  const isGuide = review?.source === 'vault'
  // A guide whose note has no `video_url` yet still opens, as a reading view.
  const hasVideo = !!review?.video_id

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
        <span className="text-text-primary text-xs font-medium truncate">
          {isGuide
            ? review.title ?? review.creator ?? 'Study guide'
            : `${review.player}${review.agent ? ` · ${review.agent}` : ''}${review.map ? ` on ${review.map}` : ''}`}
        </span>
        <span className="ml-auto text-text-muted text-xs shrink-0">
          {isGuide && `${sections.length} chapter${sections.length === 1 ? '' : 's'} · `}
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Header card — map splash behind, agent portrait in front */}
      <div className="relative bg-bg-card border border-bg-elevated rounded-xl overflow-hidden">
        <GameImage
          kind="map"
          src={review.map ? mapImageFor({ map: review.map }) : null}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-45"
        />
        {/* Opaque under the text, clearing to the right so the map stays readable. */}
        <div className="absolute inset-0 bg-gradient-to-r from-bg-card via-bg-card/90 to-bg-card/25" />

        <div className="relative px-4 py-3 flex flex-wrap items-center gap-2.5">
          <GameImage
            kind="agent"
            src={review.agent ? agentImageFor({ agent: review.agent }) : null}
            alt={review.agent ?? 'Unknown agent'}
            className="w-11 h-11 rounded-full border-2 border-bg-elevated shrink-0"
          />
          <h1 className="font-heading text-lg font-bold tracking-wide">
            {isGuide ? review.creator ?? review.player : review.player}
          </h1>
          {/* The team belongs to the player in the note, not to the creator —
              badging "Zasko (NRG)" on a guide about mada would be wrong. */}
          {review.team && (!isGuide || !review.creator) && (
            <span className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[10px] font-medium">
              {review.team}
            </span>
          )}
          {review.content_type && (
            <span className="px-2 py-0.5 rounded-full bg-val-yellow/10 text-val-yellow border border-val-yellow/20 text-[10px] font-medium">
              {review.content_type}
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
      </div>

      <div className="flex gap-4">
        {/* === FAR LEFT: chapter rail, beside a video ===
            With no video there is nothing for the rail to sit beside, so the
            chapters move into the main column below and take its full width —
            a 300px column of prose against an empty page is not a reading view. */}
        {isGuide && hasVideo && (
          <>
            <div {...chapterRailProps}>
              <ChapterRail
                sections={sections}
                currentTime={currentTime}
                readingMode={false}
                onSeek={seekTo}
              />
            </div>
            <SplitterHandle {...chapterDragHandlers} />
          </>
        )}

        {/* === CENTRE: video + controls === */}
        <div className="flex-1 min-w-0 space-y-3">
          {hasVideo && (
            <div className="relative w-full bg-black rounded-xl overflow-hidden" style={{ paddingBottom: '56.25%' }}>
              <div ref={containerRef} className="absolute inset-0 w-full h-full" />
            </div>
          )}

          {/* A guide whose note never got its link. The chapters are still worth
              reading, so the screen degrades to a reading view rather than 404ing. */}
          {!hasVideo && (
            <div className="bg-bg-card border border-val-yellow/30 rounded-lg px-4 py-3 flex items-start gap-3">
              <VideoOff className="w-4 h-4 text-val-yellow shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary">
                <strong className="text-val-yellow">No video linked.</strong> Add{' '}
                <code className="font-stats text-val-cyan">video_url</code> to{' '}
                <code className="font-stats text-text-secondary">{review.vault_path ?? 'the note'}</code> and re-run{' '}
                <code className="font-stats text-val-cyan">npm run import:guides</code> — the chapters below read fine
                meanwhile, but nothing can seek.
              </p>
            </div>
          )}

          {isGuide && !hasVideo && (
            <ChapterRail sections={sections} currentTime={0} readingMode onSeek={seekTo} />
          )}

          {/* Embed refused by the channel — link out, same pattern as the Valoplant row. */}
          {embedBlocked && review.youtube_url && (
            <div className="bg-bg-card border border-val-yellow/30 rounded-lg px-4 py-2.5 flex items-center gap-3">
              <ExternalLink className="w-4 h-4 text-val-yellow shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-secondary">
                  <strong className="text-val-yellow">This one won't play here.</strong> The channel blocks embedding, or the video is gone. Notes still save.
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
          <div
            className="bg-bg-card border border-bg-elevated rounded-lg px-4 py-2 flex items-center gap-3"
            hidden={!hasVideo}
          >
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
              <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">G</kbd> tag</span>
            </div>
          </div>

          <NoteTimeline notes={notes} duration={duration} currentTime={currentTime} onSeek={seekTo} />

          <MomentTagLane
            moments={moments}
            tags={tags}
            duration={duration}
            onSeek={seekTo}
            activeTagId={tagFilter}
          />

          {/* Quick-drop, anchored under the player where the eye already is. */}
          {quickDropOpen && reviewRef && (
            <div className="relative">
              <div className="absolute left-0 top-0 z-30">
                <TagPicker
                  tags={tags}
                  selectedIds={
                    new Set(
                      moments
                        .filter(m => m.video_ts === Math.floor(currentTime))
                        .map(m => m.tag_id),
                    )
                  }
                  mode="apply"
                  timestampLabel={formatTime(currentTime)}
                  onToggle={async tag => {
                    try {
                      handleMomentTagAdded(await addMomentTag(reviewRef, tag.id, currentTime))
                    } catch (err) {
                      console.error('Failed to apply the moment tag:', err)
                    }
                    setQuickDropOpen(false)
                  }}
                  onVocabularyChange={setTags}
                  onTagDeleted={handleTagDeleted}
                  onClose={() => setQuickDropOpen(false)}
                />
              </div>
            </div>
          )}

          {reviewRef && (
            <ReferenceCapturePanel
              reviewId={review.id}
              currentTime={currentTime}
              isPaused={!isPlaying}
              isOpen={captureOpen}
              editingNote={editingNote}
              onClose={closeCapture}
              onNoteAdded={handleNoteAdded}
              onNoteUpdated={handleNoteUpdated}
              reviewRef={reviewRef}
              tags={tags}
              onTagsChange={setTags}
              onMomentTagAdded={handleMomentTagAdded}
              onTagDeleted={handleTagDeleted}
            />
          )}

          {review.notes && (
            <div className="bg-bg-card border border-bg-elevated rounded-lg px-4 py-3">
              <h2 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">From Notion</h2>
              <p className="text-sm text-text-secondary whitespace-pre-line">{review.notes}</p>
            </div>
          )}
        </div>

        <SplitterHandle {...dragHandlers} />

        {/* === RIGHT: notes rail === */}
        <div {...notesPanelProps}>
          <ReferenceNotesPanel
            notes={notes}
            editingNoteId={editingNoteId}
            onSeek={seekTo}
            onEdit={openEdit}
            onDelete={handleDelete}
            moments={moments}
            tags={tags}
            onRemoveMomentTag={handleRemoveMomentTag}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
          />
        </div>
      </div>
    </div>
  )
}
