import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, ChevronRight, Camera, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { MatchRound, VodComment, RoundScreenshot } from '../lib/types'
import {
  PRIMARY_TAG_TYPES,
  SECONDARY_TAG_TYPES,
  PRIMARY_TAG_TYPE_NAMES,
  SECONDARY_TAG_TYPE_NAMES,
  hexWithAlpha,
} from '../lib/tagColors'
import { COMMENT_TAG_CATEGORIES } from '../lib/commentTags'
import { resolveRoundFromTimestamp } from '../lib/roundResolver'
import RoundScreenshots from './RoundScreenshots'
import MarkdownToolbar from './MarkdownToolbar'
import { applyAction } from '../lib/markdown'

interface CapturePanelProps {
  vodReviewId: string
  matchId: string
  rounds: MatchRound[]
  barrierOffset: number | null
  currentTime: number
  isPaused: boolean
  isOpen: boolean
  /** When set, the panel edits this note instead of creating a new one. */
  editingComment?: VodComment | null
  onClose: () => void
  onCommentAdded: (comment: VodComment) => void
  onCommentUpdated: (comment: VodComment) => void
  onScreenshotAdded: (screenshot: RoundScreenshot) => void
  onScreenshotDeleted: (screenshotId: string) => void
  screenshots: RoundScreenshot[]
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
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

export default function CapturePanel({
  vodReviewId,
  matchId,
  rounds,
  barrierOffset,
  currentTime,
  isPaused,
  isOpen,
  editingComment,
  onClose,
  onCommentAdded,
  onCommentUpdated,
  onScreenshotAdded,
  onScreenshotDeleted,
  screenshots,
}: CapturePanelProps) {
  const [text, setText] = useState('')
  const [primary, setPrimary] = useState<Set<string>>(new Set())
  const [secondary, setSecondary] = useState<Set<string>>(new Set())
  const [detailTags, setDetailTags] = useState<string[]>([])
  const [showSecondary, setShowSecondary] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pastedFile, setPastedFile] = useState<File | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isEditing = !!editingComment

  // An edit keeps the note's original moment in the tape; a new note takes the playhead.
  const noteTime = editingComment ? editingComment.timestamp_seconds : currentTime

  const resolvedRound = useMemo(
    () => resolveRoundFromTimestamp(noteTime, rounds, barrierOffset),
    [noteTime, rounds, barrierOffset]
  )

  // Auto-focus when opened, prefill in edit mode, reset when closed
  useEffect(() => {
    if (isOpen) {
      if (editingComment) {
        const tags = editingComment.tags || []
        const detail = tags.filter(
          t => !PRIMARY_TAG_TYPE_NAMES.has(t) && !SECONDARY_TAG_TYPE_NAMES.has(t)
        )
        const secondaryTags = tags.filter(t => SECONDARY_TAG_TYPE_NAMES.has(t))
        setText(editingComment.free_text ?? '')
        setPrimary(new Set(tags.filter(t => PRIMARY_TAG_TYPE_NAMES.has(t))))
        setSecondary(new Set(secondaryTags))
        setDetailTags(detail)
        setShowSecondary(secondaryTags.length > 0)
        setShowDetail(detail.length > 0)
      }
      const t = setTimeout(() => textareaRef.current?.focus(), 30)
      return () => clearTimeout(t)
    } else {
      setText('')
      setPrimary(new Set())
      setSecondary(new Set())
      setDetailTags([])
      setShowSecondary(false)
      setShowDetail(false)
      setPastedFile(null)
    }
  }, [isOpen, editingComment])

  if (!isOpen) return null

  const togglePrimary = (type: string) => {
    setPrimary(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const toggleSecondary = (type: string) => {
    setSecondary(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const toggleDetail = (tag: string) => {
    setDetailTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(item => item.type.startsWith('image/'))
    if (imageItem) {
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (file) setPastedFile(file)
    }
  }

  const handleSave = async () => {
    const trimmed = text.trim()
    const tags = [...primary, ...secondary, ...detailTags]
    if (!trimmed && tags.length === 0) return

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Branch on editingComment: an edit UPDATEs the existing row, never INSERTs.
      if (editingComment) {
        const { data, error } = await supabase
          .from('vod_comments')
          .update({
            tags,
            free_text: trimmed || null,
            is_strength: primary.has('strength'),
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingComment.id)
          .select()
          .single()

        if (error) throw error
        if (data) {
          onCommentUpdated(data)
          onClose()
        }
        return
      }

      const { data, error } = await supabase
        .from('vod_comments')
        .insert({
          user_id: user.id,
          vod_review_id: vodReviewId,
          timestamp_seconds: Math.round(currentTime),
          round_number: resolvedRound?.round_number ?? null,
          tags,
          free_text: trimmed || null,
          is_strength: primary.has('strength'),
        })
        .select()
        .single()

      if (error) throw error
      if (data) {
        onCommentAdded(data)
        onClose()
      }
    } catch (err) {
      console.error('Failed to save comment:', err)
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

  const sideLabel = resolvedRound
    ? resolvedRound.side === 'attack' ? 'Attack' : 'Defense'
    : null
  const roundLabel = resolvedRound ? `R${resolvedRound.round_number}` : null

  const canSave = text.trim().length > 0 || primary.size > 0 || secondary.size > 0 || detailTags.length > 0

  return (
    <div className={`bg-bg-card border rounded-lg overflow-hidden ${isEditing ? 'border-val-yellow/40' : 'border-val-cyan/30'}`}>
      {/* Editing banner */}
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
        {roundLabel && (
          <span className="text-xs text-text-secondary">
            · {roundLabel}{sideLabel ? ` · ${sideLabel}` : ''}
          </span>
        )}
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
          onPaste={handlePaste}
          placeholder="What happened here? What did you notice?"
          rows={3}
          className="w-full min-h-[72px] bg-transparent text-text-primary text-base font-normal leading-relaxed placeholder:text-text-muted resize-y focus:outline-none"
        />
      </div>

      {/* Primary chips row */}
      <div className="px-3 py-2 border-t border-bg-elevated flex flex-wrap items-center gap-1.5">
        {PRIMARY_TAG_TYPES.map(t => (
          <Chip
            key={t.type}
            label={t.label}
            selected={primary.has(t.type)}
            dotColor={t.dotColor}
            onClick={() => togglePrimary(t.type)}
          />
        ))}
        <button
          type="button"
          onClick={() => setShowSecondary(s => !s)}
          className="px-2.5 py-1 rounded-full text-[11px] font-medium border bg-transparent text-text-muted border-bg-elevated hover:border-text-muted transition-colors flex items-center gap-1"
        >
          More
          {showSecondary ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
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

      {/* Secondary chips */}
      {showSecondary && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {SECONDARY_TAG_TYPES.map(t => (
            <Chip
              key={t.type}
              label={t.label}
              selected={secondary.has(t.type)}
              dotColor={t.dotColor}
              onClick={() => toggleSecondary(t.type)}
            />
          ))}
        </div>
      )}

      {/* Detail tags expander */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => setShowDetail(s => !s)}
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
        >
          {showDetail ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Add detail tags (technique, position, weapon, play type)
        </button>

        {showDetail && (
          <div className="mt-2 space-y-2">
            {Object.entries(COMMENT_TAG_CATEGORIES).map(([catKey, cat]) => (
              <div key={catKey}>
                <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color: cat.color }}>
                  {cat.label}
                </span>
                <div className="flex gap-1 flex-wrap mt-0.5">
                  {cat.tags.map(tag => {
                    const selected = detailTags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleDetail(tag)}
                        className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                          selected
                            ? 'border-val-cyan/40 bg-val-cyan/10 text-val-cyan'
                            : 'border-transparent bg-bg-elevated text-text-muted hover:text-text-secondary'
                        }`}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Screenshot wiring */}
      {resolvedRound && (
        <div className="px-3 pb-3 border-t border-bg-elevated pt-2 flex items-center gap-2">
          <Camera className="w-3 h-3 text-text-muted" />
          <span className="text-[10px] text-text-muted">
            {pastedFile ? 'Screenshot pasted, uploading…' : 'Paste image (Ctrl+V) to attach to this round'}
          </span>
          <div className="ml-auto">
            <RoundScreenshots
              matchId={matchId}
              roundNumber={resolvedRound.round_number}
              screenshots={screenshots.filter(s => s.round_number === resolvedRound.round_number)}
              pastedFile={pastedFile}
              onPasteConsumed={() => setPastedFile(null)}
              onScreenshotAdded={onScreenshotAdded}
              onScreenshotDeleted={onScreenshotDeleted}
            />
          </div>
        </div>
      )}
    </div>
  )
}
