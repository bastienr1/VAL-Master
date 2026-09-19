import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import MarkdownToolbar from './MarkdownToolbar'
import { applyAction } from '../lib/markdown'
import { createNote, updateNote } from '../lib/referenceReviews'
import { REFERENCE_LABELS } from '../lib/constants'
import { COMMENT_TAG_CATEGORIES } from '../lib/commentTags'
import { REFERENCE_LABEL_COLORS, hexWithAlpha } from '../lib/tagColors'
import { formatTime } from '../lib/youtube'
import type { ReferenceLabel, ReferenceNote } from '../lib/types'

/**
 * Capture-first note editor for a pro VOD.
 *
 * Same shape and keybindings as the Sprint 5b `CapturePanel`, against
 * `reference_notes` instead of `vod_comments`. It is a sibling rather than a
 * reuse because the two note rows differ: a match note carries a tag array plus
 * round linkage and screenshots, a reference note carries one category and one
 * replication label and has no rounds to resolve against.
 */

/** The category chip vocabulary, borrowed from the match-note taxonomy. */
const CATEGORY_OPTIONS = Object.values(COMMENT_TAG_CATEGORIES).map(c => ({
  label: c.label,
  color: c.color,
}))

interface ReferenceCapturePanelProps {
  reviewId: string
  currentTime: number
  isPaused: boolean
  isOpen: boolean
  /** When set, the panel edits this note instead of creating a new one. */
  editingNote?: ReferenceNote | null
  onClose: () => void
  onNoteAdded: (note: ReferenceNote) => void
  onNoteUpdated: (note: ReferenceNote) => void
}

interface ChipProps {
  label: string
  selected: boolean
  dotColor: string
  onClick: () => void
}

function Chip({ label, selected, dotColor, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={
        selected
          ? {
              backgroundColor: hexWithAlpha(dotColor, 0.1),
              color: dotColor,
              borderColor: hexWithAlpha(dotColor, 0.3),
            }
          : undefined
      }
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        selected ? '' : 'bg-transparent text-text-muted border-bg-elevated hover:border-text-muted'
      }`}
    >
      {label}
    </button>
  )
}

export default function ReferenceCapturePanel({
  reviewId,
  currentTime,
  isPaused,
  isOpen,
  editingNote,
  onClose,
  onNoteAdded,
  onNoteUpdated,
}: ReferenceCapturePanelProps) {
  const [text, setText] = useState('')
  const [label, setLabel] = useState<ReferenceLabel | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isEditing = !!editingNote

  // An edit keeps the note's original moment in the tape; a new note takes the playhead.
  const noteTime = editingNote ? editingNote.timestamp_seconds : currentTime

  useEffect(() => {
    if (isOpen) {
      if (editingNote) {
        setText(editingNote.text ?? '')
        setLabel(editingNote.label)
        setCategory(editingNote.category)
      }
      const t = setTimeout(() => textareaRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
    setText('')
    setLabel(null)
    setCategory(null)
    setError(null)
  }, [isOpen, editingNote])

  if (!isOpen) return null

  const canSave = text.trim().length > 0

  const handleSave = async () => {
    const trimmed = text.trim()
    if (!trimmed) return

    setSaving(true)
    setError(null)
    try {
      if (editingNote) {
        const updated = await updateNote(editingNote.id, { text: trimmed, label, category })
        onNoteUpdated(updated)
      } else {
        const created = await createNote({
          reference_review_id: reviewId,
          timestamp_seconds: currentTime,
          text: trimmed,
          label,
          category,
        })
        onNoteAdded(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note.')
    } finally {
      setSaving(false)
    }
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault()
      setText(applyAction(e.currentTarget, { kind: 'wrap', token: e.key === 'b' ? '**' : '*' }))
    }
  }

  return (
    <div className={`bg-bg-card border rounded-lg overflow-hidden ${isEditing ? 'border-val-yellow/40' : 'border-val-cyan/30'}`}>
      {isEditing && (
        <div className="px-3 py-1.5 bg-val-yellow/10 border-b border-val-yellow/30 flex items-center gap-2">
          <Pencil className="w-3 h-3 text-val-yellow shrink-0" />
          <span className="text-[11px] text-val-yellow">Editing an existing note</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel · Esc
          </button>
        </div>
      )}

      {/* Header */}
      <div className="px-3 py-2 border-b border-bg-elevated flex items-center gap-2">
        <span className="font-stats text-xs text-val-cyan">{formatTime(noteTime)}</span>
        {!isEditing && (
          <span className="ml-auto px-1.5 py-0.5 rounded bg-bg-elevated text-[9px] text-text-muted">
            {isPaused ? 'paused' : 'live'}
          </span>
        )}
      </div>

      {/* Formatting toolbar */}
      <div className="px-2 py-1 border-b border-bg-elevated">
        <MarkdownToolbar textareaRef={textareaRef} onChange={setText} />
      </div>

      {/* Textarea */}
      <div className="px-3 py-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="What is the pro doing here? What would you replicate?"
          rows={3}
          className="w-full min-h-[72px] bg-transparent text-text-primary text-base font-normal leading-relaxed placeholder:text-text-muted resize-y focus:outline-none"
        />
      </div>

      {/* Label chips + save */}
      <div className="px-3 py-2 border-t border-bg-elevated flex flex-wrap items-center gap-1.5">
        {REFERENCE_LABELS.map(option => (
          <Chip
            key={option}
            label={option}
            selected={label === option}
            dotColor={REFERENCE_LABEL_COLORS[option]}
            // Clicking the selected label clears it — the column is nullable.
            onClick={() => setLabel(prev => (prev === option ? null : option))}
          />
        ))}
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
          className={`ml-auto px-3 py-1 rounded-md text-[11px] font-medium border disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
            isEditing
              ? 'bg-val-yellow/15 text-val-yellow border-val-yellow/30 hover:bg-val-yellow/25'
              : 'bg-val-cyan/15 text-val-cyan border-val-cyan/30 hover:bg-val-cyan/25'
          }`}
        >
          {saving ? 'Saving…' : isEditing ? 'Update · ⌘↵' : 'Save · ⌘↵'}
        </button>
      </div>

      {/* Category chips */}
      <div className="px-3 pb-3 flex flex-wrap gap-1.5">
        {CATEGORY_OPTIONS.map(option => (
          <Chip
            key={option.label}
            label={option.label}
            selected={category === option.label}
            dotColor={option.color}
            onClick={() => setCategory(prev => (prev === option.label ? null : option.label))}
          />
        ))}
      </div>

      {error && (
        <div className="px-3 pb-3 text-[11px] text-val-red">{error}</div>
      )}
    </div>
  )
}
