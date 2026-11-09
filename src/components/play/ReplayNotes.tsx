import { useMemo, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import CapturePanel from '../CapturePanel'
import NotesPanel from '../NotesPanel'
import TagPicker from '../TagPicker'
import type { MatchNotes } from '../../hooks/useMatchNotes'
import { addMomentTag } from '../../lib/momentTags'
import type { ReplayBundle, ReplayRound } from '../../lib/replayBundle'
import { replayMsToVideoSeconds } from '../../lib/replaySync'
import type { ReplayReview } from '../../lib/replayVod'
import type { MatchRound } from '../../lib/types'
import type { ValueStore } from '../../lib/valueStore'
import { formatTime } from '../../lib/youtube'

type Clock = Pick<ValueStore<{ ms: number; round: ReplayRound } | null>, 'get' | 'subscribe'>

const NO_LEGACY_TAGS: never[] = []

interface ReplayNotesProps {
  notes: MatchNotes
  matchId: string
  /** The match's review, with its barrier drop marked. */
  review: ReplayReview & { barrierOffset: number }
  /** The match's rounds on the replay's own timing. */
  rounds: MatchRound[]
  clock: Clock
}

/**
 * The video second the replay is at, whole: the panels render once a second
 * while the match plays, not with each frame.
 */
function useVideoSecond(clock: Clock, bundle: ReplayBundle, barrierOffset: number): number {
  return useSyncExternalStore(clock.subscribe, () => {
    const shown = clock.get()
    return shown ? Math.max(0, Math.round(replayMsToVideoSeconds(bundle, barrierOffset, shown.ms))) : 0
  })
}

const useRoundShown = (clock: Clock): number | null => useSyncExternalStore(clock.subscribe, () => clock.get()?.round.n ?? null)

/** Why a replay cannot take notes, and where to fix it. */
export function ReplayNotesUnavailable({ matchId, hasReview }: { matchId: string; hasReview: boolean }) {
  const reviewLink = (
    // A new tab: the editor has no unsaved-changes guard, so leaving it would drop the play.
    <Link to={`/review/${matchId}`} target="_blank" rel="noopener noreferrer" className="text-val-cyan hover:underline">
      review page ↗
    </Link>
  )
  return (
    <p className="px-3 py-3 text-[11px] text-text-secondary">
      {hasReview ? (
        <>Notes are timed on the match’s video: mark the barrier drop on its {reviewLink} to take them here.</>
      ) : (
        <>A match’s notes live on its review: add its video on the {reviewLink} to take them here.</>
      )}
    </p>
  )
}

/** The notes of the match, the same list and filters as the VOD review's rail. */
export function ReplayNotesPanel({
  notes,
  review,
  rounds,
  clock,
  onSeek,
  onEdit,
}: Omit<ReplayNotesProps, 'matchId'> & {
  /** A note's time, in video seconds. */
  onSeek(seconds: number): void
  onEdit(comment: MatchNotes['comments'][number]): void
}) {
  const activeRound = useRoundShown(clock)
  return (
    <div className="p-2">
      <NotesPanel
        moments={notes.moments}
        tags={notes.reviewTags}
        onRemoveMomentTag={notes.handleRemoveMomentTag}
        tagFilter={notes.tagFilter}
        onTagFilterChange={notes.setTagFilter}
        comments={notes.comments}
        screenshots={notes.screenshots}
        rounds={rounds}
        legacyTags={NO_LEGACY_TAGS}
        activeRound={activeRound}
        vodReviewId={review.id}
        barrierOffset={review.barrierOffset}
        editingCommentId={notes.editingCommentId}
        onSeek={onSeek}
        onCommentDeleted={notes.handleCommentDeleted}
        onCommentAdded={notes.handleCommentAdded}
        onCommentEdit={onEdit}
        onLegacyTagConverted={() => {}}
      />
    </div>
  )
}

/** The review's note editor at the replay's moment, in the round on screen. */
export function ReplayNoteCapture({
  notes,
  matchId,
  review,
  rounds,
  clock,
  bundle,
  paused,
}: ReplayNotesProps & { bundle: ReplayBundle; paused: boolean }) {
  const second = useVideoSecond(clock, bundle, review.barrierOffset)
  const roundShown = useRoundShown(clock)
  const reviewRef = useMemo(() => ({ type: 'vod' as const, id: matchId }), [matchId])
  return (
    <CapturePanel
      vodReviewId={review.id}
      matchId={matchId}
      rounds={rounds}
      barrierOffset={review.barrierOffset}
      currentTime={second}
      knownRound={notes.editingComment ? notes.editingComment.round_number : roundShown}
      isPaused={paused}
      isOpen={notes.captureOpen}
      editingComment={notes.editingComment}
      onClose={notes.closeCapture}
      onCommentAdded={notes.handleCommentAdded}
      onCommentUpdated={notes.handleCommentUpdated}
      onScreenshotAdded={notes.handleScreenshotAdded}
      onScreenshotDeleted={notes.handleScreenshotDeleted}
      screenshots={notes.screenshots}
      reviewRef={reviewRef}
      tags={notes.reviewTags}
      onTagsChange={notes.setReviewTags}
      onMomentTagAdded={notes.handleMomentTagAdded}
      onRemoveMomentTag={notes.handleRemoveMomentTag}
      onTagDeleted={notes.handleTagDeleted}
      editingMoments={notes.editingMoments}
    />
  )
}

/** G on the review: a tag on this moment, with no note. */
export function ReplayQuickTag({
  notes,
  matchId,
  review,
  clock,
  bundle,
  onClose,
}: Pick<ReplayNotesProps, 'notes' | 'matchId' | 'review' | 'clock'> & { bundle: ReplayBundle; onClose(): void }) {
  const second = useVideoSecond(clock, bundle, review.barrierOffset)
  return (
    <TagPicker
      tags={notes.reviewTags}
      selectedIds={new Set(notes.moments.filter(m => m.video_ts === second).map(m => m.tag_id))}
      mode="apply"
      timestampLabel={formatTime(second)}
      onToggle={async tag => {
        try {
          notes.handleMomentTagAdded(await addMomentTag({ type: 'vod', id: matchId }, tag.id, second))
        } catch (err) {
          console.error('Failed to apply the moment tag:', err)
        }
        onClose()
      }}
      onVocabularyChange={notes.setReviewTags}
      onTagDeleted={notes.handleTagDeleted}
      onClose={onClose}
    />
  )
}
