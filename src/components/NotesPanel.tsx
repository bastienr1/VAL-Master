import { useState, useMemo } from 'react'
import { Filter, FilterX, ChevronDown, ChevronRight, Trash2, Pencil, Crosshair, Skull } from 'lucide-react'
import NoteMarkdown from './NoteMarkdown'
import { supabase } from '../lib/supabase'
import type { MatchRound, VodComment, VodTag, RoundScreenshot } from '../lib/types'
import {
  ALL_TAG_COLORS,
  PRIMARY_TAG_TYPE_NAMES,
  PRIMARY_TAG_TYPES,
  hexWithAlpha,
} from '../lib/tagColors'
import { getRoundVideoTime } from '../lib/roundResolver'

interface NotesPanelProps {
  comments: VodComment[]
  screenshots: RoundScreenshot[]
  rounds: MatchRound[]
  legacyTags: VodTag[]
  activeRound: number | null
  vodReviewId: string
  barrierOffset: number | null
  /** Note currently loaded in the editor — dimmed in the list. */
  editingCommentId: string | null
  onSeek: (seconds: number) => void
  onCommentDeleted: (commentId: string) => void
  onCommentAdded: (comment: VodComment) => void
  onCommentEdit: (comment: VodComment) => void
  onLegacyTagConverted: (tagId: string) => void
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function findPrimaryTag(tags: string[]): { type: string; label: string; dotColor: string } | null {
  for (const t of tags) {
    if (PRIMARY_TAG_TYPE_NAMES.has(t)) {
      const meta = PRIMARY_TAG_TYPES.find(pt => pt.type === t)
      if (meta) return meta
    }
  }
  return null
}

interface NoteCardProps {
  comment: VodComment
  screenshot: RoundScreenshot | undefined
  isEditing: boolean
  onSeek: (seconds: number) => void
  onEdit: () => void
  onDelete: () => void
}

function NoteCard({ comment, screenshot, isEditing, onSeek, onEdit, onDelete }: NoteCardProps) {
  const primary = findPrimaryTag(comment.tags || [])
  const detailTags = (comment.tags || []).filter(t => !PRIMARY_TAG_TYPE_NAMES.has(t))

  return (
    <div
      className={`group rounded-lg p-2 transition-colors relative ${
        isEditing
          ? 'opacity-50 border border-val-yellow/40 bg-val-yellow/5'
          : 'hover:bg-bg-elevated/20'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={() => onSeek(comment.timestamp_seconds)}
          className="font-stats text-[10px] text-val-cyan font-medium hover:underline"
        >
          {formatTime(comment.timestamp_seconds)}
        </button>
        {primary && (
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-medium border"
            style={{
              backgroundColor: hexWithAlpha(primary.dotColor, 0.1),
              color: primary.dotColor,
              borderColor: hexWithAlpha(primary.dotColor, 0.25),
            }}
          >
            {primary.label}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
          <button
            type="button"
            onClick={onEdit}
            className="p-1 text-text-muted hover:text-val-cyan transition-colors"
            title="Edit note"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1 text-text-muted hover:text-val-red transition-colors"
            title="Delete note"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body — markdown source rendered */}
      {comment.free_text && <NoteMarkdown>{comment.free_text}</NoteMarkdown>}

      {/* Screenshot + detail tags */}
      {(screenshot || detailTags.length > 0) && (
        <div className="flex items-start gap-2 mt-2">
          {screenshot && (
            <img
              src={screenshot.image_url}
              alt="Round screenshot"
              className="w-[240px] max-w-full aspect-square object-cover rounded border border-bg-elevated cursor-zoom-in"
              onClick={() => window.open(screenshot.image_url, '_blank')}
            />
          )}
          {detailTags.length > 0 && (
            <div className="flex flex-col gap-1 flex-1">
              {detailTags.map(t => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted text-[9px] self-start"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NotesPanel({
  comments,
  screenshots,
  rounds,
  legacyTags,
  activeRound,
  vodReviewId,
  barrierOffset,
  editingCommentId,
  onSeek,
  onCommentDeleted,
  onCommentAdded,
  onCommentEdit,
  onLegacyTagConverted,
}: NotesPanelProps) {
  const [showAllNotes, setShowAllNotes] = useState(false)
  const [showRoundEvents, setShowRoundEvents] = useState(false)
  const [showLegacyTags, setShowLegacyTags] = useState(false)

  const visibleComments = useMemo(() => {
    if (showAllNotes) return comments
    if (activeRound != null) return comments.filter(c => c.round_number === activeRound)
    return comments
  }, [comments, showAllNotes, activeRound])

  const activeRoundData = useMemo(
    () => activeRound != null ? rounds.find(r => r.round_number === activeRound) ?? null : null,
    [rounds, activeRound]
  )

  const handleDelete = async (commentId: string) => {
    try {
      const { error } = await supabase.from('vod_comments').delete().eq('id', commentId)
      if (!error) onCommentDeleted(commentId)
    } catch (err) {
      console.error('Failed to delete comment:', err)
    }
  }

  const handleConvertLegacy = async (tag: VodTag) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: inserted, error: insertError } = await supabase
        .from('vod_comments')
        .insert({
          user_id: user.id,
          vod_review_id: vodReviewId,
          timestamp_seconds: tag.timestamp_seconds,
          round_number: tag.round_number,
          tags: [tag.tag_type],
          free_text: tag.label,
          is_strength: tag.tag_type === 'strength',
        })
        .select()
        .single()

      if (insertError) throw insertError

      const { error: deleteError } = await supabase
        .from('vod_tags')
        .delete()
        .eq('id', tag.id)

      if (deleteError) throw deleteError

      if (inserted) onCommentAdded(inserted)
      onLegacyTagConverted(tag.id)
    } catch (err) {
      console.error('Failed to convert legacy tag:', err)
    }
  }

  const filteringSubtitle = !showAllNotes && activeRound != null
    ? `R${activeRound}`
    : null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-heading font-bold text-text-primary">Notes</span>
        <span className="text-[10px] text-text-muted">{visibleComments.length}</span>
        {filteringSubtitle && (
          <span className="text-[10px] text-text-muted">· {filteringSubtitle}</span>
        )}
        <button
          type="button"
          onClick={() => setShowAllNotes(s => !s)}
          className="ml-auto flex items-center gap-1 text-[10px] text-text-muted hover:text-val-cyan transition-colors"
          title={showAllNotes ? 'Filter to active round' : 'Show all notes'}
        >
          {showAllNotes ? <FilterX className="w-3 h-3" /> : <Filter className="w-3 h-3" />}
          {showAllNotes ? 'All notes' : 'Filtered'}
        </button>
      </div>

      {/* Notes list */}
      {visibleComments.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <span className="italic text-text-muted text-sm">
            {activeRound != null && !showAllNotes
              ? 'No notes for this round yet'
              : 'No notes yet — press T to capture an insight'}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleComments.map((c, i) => {
            const screenshot = screenshots.find(s => s.round_number === c.round_number)
            const needsDivider = i > 0 && i % 3 === 0
            return (
              <div key={c.id} className={needsDivider ? 'border-t border-bg-elevated/40 pt-2' : ''}>
                <NoteCard
                  comment={c}
                  screenshot={screenshot}
                  isEditing={editingCommentId === c.id}
                  onSeek={onSeek}
                  onEdit={() => onCommentEdit(c)}
                  onDelete={() => handleDelete(c.id)}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Round events expander */}
      {activeRoundData && (
        <div>
          <button
            type="button"
            onClick={() => setShowRoundEvents(s => !s)}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            {showRoundEvents ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Round events ({(activeRoundData.kill_events?.length ?? 0) + (activeRoundData.death_events?.length ?? 0)})
          </button>

          {showRoundEvents && barrierOffset != null && (
            <div className="mt-1 space-y-1 pl-4">
              {(activeRoundData.kill_events || []).map((kill, i) => {
                const ts = getRoundVideoTime(activeRoundData, rounds, barrierOffset) + (kill.kill_time_ms / 1000)
                return (
                  <div key={`k-${i}`} className="flex items-center gap-2">
                    <Crosshair className="w-3 h-3 text-val-green shrink-0" />
                    <button
                      type="button"
                      onClick={() => onSeek(ts)}
                      className="font-stats text-[10px] text-val-cyan hover:underline w-9 shrink-0 text-left"
                    >
                      {formatTime(ts)}
                    </button>
                    <span className="text-[11px] text-text-muted truncate">
                      Killed {kill.victim} {kill.weapon ? `(${kill.weapon})` : ''}
                    </span>
                  </div>
                )
              })}
              {(activeRoundData.death_events || []).map((death, i) => {
                const ts = getRoundVideoTime(activeRoundData, rounds, barrierOffset) + (death.kill_time_ms / 1000)
                return (
                  <div key={`d-${i}`} className="flex items-center gap-2">
                    <Skull className="w-3 h-3 text-val-red shrink-0" />
                    <button
                      type="button"
                      onClick={() => onSeek(ts)}
                      className="font-stats text-[10px] text-val-cyan hover:underline w-9 shrink-0 text-left"
                    >
                      {formatTime(ts)}
                    </button>
                    <span className="text-[11px] text-text-muted truncate">
                      Died to {death.killer} {death.weapon ? `(${death.weapon})` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Legacy tags expander */}
      {legacyTags.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLegacyTags(s => !s)}
            className="flex items-center gap-1 text-[10px] text-val-yellow hover:text-val-yellow/80 transition-colors"
          >
            {showLegacyTags ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Legacy tags ({legacyTags.length}) · click to convert
          </button>

          {showLegacyTags && (
            <div className="mt-1 space-y-1 pl-4">
              {legacyTags.map(tag => {
                const meta = ALL_TAG_COLORS[tag.tag_type]
                return (
                  <div key={tag.id} className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: meta?.dotColor || '#64748B' }}
                    />
                    <button
                      type="button"
                      onClick={() => onSeek(tag.timestamp_seconds)}
                      className="font-stats text-[10px] text-val-cyan hover:underline w-9 shrink-0 text-left"
                    >
                      {formatTime(tag.timestamp_seconds)}
                    </button>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-bg-elevated text-text-muted shrink-0">
                      {tag.tag_type}
                    </span>
                    <span className="text-[11px] text-text-secondary truncate flex-1">
                      {tag.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleConvertLegacy(tag)}
                      className="text-[10px] text-val-cyan hover:underline shrink-0"
                    >
                      Convert
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
