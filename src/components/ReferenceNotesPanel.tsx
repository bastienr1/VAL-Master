import { useMemo, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import NoteMarkdown from './NoteMarkdown'
import MomentTagChips from './MomentTagChips'
import LooseMomentList from './LooseMomentList'
import TagFilterBar from './TagFilterBar'
import { REFERENCE_LABEL_COLORS, hexWithAlpha } from '../lib/tagColors'
import { formatTime } from '../lib/youtube'
import { REFERENCE_LABELS } from '../lib/constants'
import { isFiltering, looseMoments, matchesTagFilter, type TagFilter } from '../lib/tagFilter'
import type { MomentTag, ReferenceNote, ReviewTag } from '../lib/types'

/**
 * Note rail for a pro VOD — the frozen note card anatomy (timestamp, category
 * chip, text, label) reading from `reference_notes`.
 */

interface ReferenceNotesPanelProps {
  notes: ReferenceNote[]
  /** Note currently loaded in the editor — dimmed in the list. */
  editingNoteId: string | null
  onSeek: (seconds: number) => void
  onEdit: (note: ReferenceNote) => void
  onDelete: (note: ReferenceNote) => void
  /** Moment tags on this review, and the vocabulary to render them with. */
  moments: MomentTag[]
  tags: ReviewTag[]
  onRemoveMomentTag: (moment: MomentTag) => void
  /** Lifted so the timeline lane can dim to the same filter. */
  tagFilter: TagFilter
  onTagFilterChange: (filter: TagFilter) => void
}

interface NoteCardProps {
  note: ReferenceNote
  isEditing: boolean
  onSeek: (seconds: number) => void
  onEdit: () => void
  onDelete: () => void
  moments: MomentTag[]
  tags: ReviewTag[]
  onRemoveMomentTag: (moment: MomentTag) => void
}

function NoteCard({
  note,
  isEditing,
  onSeek,
  onEdit,
  onDelete,
  moments,
  tags,
  onRemoveMomentTag,
}: NoteCardProps) {
  const labelColor = note.label ? REFERENCE_LABEL_COLORS[note.label] : null

  return (
    <div
      className={`group rounded-lg p-2 transition-colors relative ${
        isEditing ? 'opacity-50 border border-val-yellow/40 bg-val-yellow/5' : 'hover:bg-bg-elevated/20'
      }`}
    >
      {/* Row 1 — timestamp · category · label · moment tags (wraps on a narrow rail) */}
      <div className="flex items-start gap-1 mb-1">
        <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSeek(note.timestamp_seconds)}
            className="font-stats text-[10px] text-val-cyan font-medium hover:underline"
          >
            {formatTime(note.timestamp_seconds)}
          </button>
          {note.category && (
            <span className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted text-[9px]">
              {note.category}
            </span>
          )}
          {note.label && labelColor && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium border"
              style={{
                backgroundColor: hexWithAlpha(labelColor, 0.1),
                color: labelColor,
                borderColor: hexWithAlpha(labelColor, 0.25),
              }}
            >
              {note.label}
            </span>
          )}
          {/* While this note is in the editor, the editor owns its tags. */}
          <MomentTagChips
            moments={moments}
            tags={tags}
            onRemove={isEditing ? undefined : onRemoveMomentTag}
            className="contents"
          />
        </div>
        {/* Actions stay pinned top-right even when the tag row wraps. */}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
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

      {note.text && <NoteMarkdown>{note.text}</NoteMarkdown>}
    </div>
  )
}

export default function ReferenceNotesPanel({
  notes,
  editingNoteId,
  onSeek,
  onEdit,
  onDelete,
  moments,
  tags,
  onRemoveMomentTag,
  tagFilter,
  onTagFilterChange,
}: ReferenceNotesPanelProps) {
  const [labelFilter, setLabelFilter] = useState<string | null>(null)

  // Only offer a filter for labels this VOD actually uses.
  const usedLabels = useMemo(
    () => REFERENCE_LABELS.filter(l => notes.some(n => n.label === l)),
    [notes],
  )

  /** Same rule for tags: only the ones actually applied in this review. */
  const usedTags = useMemo(
    () => tags.filter(t => moments.some(m => m.tag_id === t.id)),
    [tags, moments],
  )

  const momentsByNote = useMemo(() => {
    const map = new Map<string, MomentTag[]>()
    for (const moment of moments) {
      if (!moment.note_id) continue // a quick-drop moment belongs to no card
      const bucket = map.get(moment.note_id)
      if (bucket) bucket.push(moment)
      else map.set(moment.note_id, [moment])
    }
    return map
  }, [moments])

  const visible = useMemo(() => {
    const byLabel = labelFilter ? notes.filter(n => n.label === labelFilter) : notes
    if (!isFiltering(tagFilter)) return byLabel
    // A note is matched on its own moments' tags.
    return byLabel.filter(n => matchesTagFilter(tagFilter, (momentsByNote.get(n.id) ?? []).map(m => m.tag_id)))
  }, [notes, labelFilter, tagFilter, momentsByNote])

  /** The tagged seconds with no note that the filter keeps. A label filter is about notes, so it hides them. */
  const visibleLoose = useMemo(
    () =>
      isFiltering(tagFilter) && !labelFilter
        ? looseMoments(moments).filter(group => matchesTagFilter(tagFilter, group.moments.map(m => m.tag_id)))
        : [],
    [moments, tagFilter, labelFilter],
  )

  return (
    <div className="bg-bg-card border border-bg-elevated rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-bg-elevated flex items-center gap-2">
        <h2 className="font-heading text-sm font-bold tracking-wide">Notes</h2>
        <span className="text-[10px] text-text-muted">
          {visible.length === notes.length ? notes.length : `${visible.length} of ${notes.length}`}
        </span>
      </div>

      {usedLabels.length > 0 && (
        <div className="px-3 py-2 border-b border-bg-elevated flex flex-wrap gap-1.5">
          {usedLabels.map(option => {
            const active = labelFilter === option
            const color = REFERENCE_LABEL_COLORS[option]
            return (
              <button
                key={option}
                type="button"
                onClick={() => setLabelFilter(active ? null : option)}
                style={
                  active
                    ? {
                        backgroundColor: hexWithAlpha(color, 0.1),
                        color,
                        borderColor: hexWithAlpha(color, 0.3),
                      }
                    : undefined
                }
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  active ? '' : 'bg-transparent text-text-muted border-bg-elevated hover:border-text-muted'
                }`}
              >
                {option}
              </button>
            )
          })}
        </div>
      )}

      <TagFilterBar
        tags={usedTags}
        filter={tagFilter}
        onChange={onTagFilterChange}
        className="px-3 py-2 border-b border-bg-elevated flex flex-wrap items-center gap-1.5"
      />

      <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto">
        {notes.length === 0 ? (
          <p className="text-text-muted text-xs px-1 py-4 text-center">
            No notes yet — press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> while
            watching to capture one.
          </p>
        ) : visible.length === 0 ? (
          visibleLoose.length === 0 && (
            <p className="text-text-muted text-xs px-1 py-4 text-center">
              {isFiltering(tagFilter) ? 'Nothing with these tags.' : 'No notes with that label.'}
            </p>
          )
        ) : (
          visible.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              isEditing={editingNoteId === note.id}
              onSeek={onSeek}
              onEdit={() => onEdit(note)}
              onDelete={() => onDelete(note)}
              moments={momentsByNote.get(note.id) ?? []}
              tags={tags}
              onRemoveMomentTag={onRemoveMomentTag}
            />
          ))
        )}
        {visibleLoose.length > 0 && (
          <div className="pt-1">
            <LooseMomentList groups={visibleLoose} tags={tags} onSeek={onSeek} onRemoveMomentTag={onRemoveMomentTag} />
          </div>
        )}
      </div>
    </div>
  )
}
