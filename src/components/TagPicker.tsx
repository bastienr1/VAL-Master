import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, MoreHorizontal, Plus } from 'lucide-react'
import {
  countTagUsage,
  createReviewTag,
  deleteReviewTag,
  renameReviewTag,
} from '../lib/momentTags'
import { hexWithAlpha } from '../lib/tagColors'
import type { ReviewTag } from '../lib/types'

/**
 * The tag popover, shared by both review surfaces and both capture paths.
 *
 * `select` mode hands chosen tags back to a capture panel as pending chips —
 * nothing is written until the note saves. `apply` mode writes immediately, for
 * the quick-drop hotkey where there is no note to attach to.
 *
 * Keyboard-first by design: the review flow is watch-and-mark, so the picker
 * must never cost more than a keystroke. Arrows move, Enter applies or creates,
 * Escape closes.
 */

interface TagPickerProps {
  tags: ReviewTag[]
  /** Ids already applied — rendered with a check and toggled off on Enter. */
  selectedIds: Set<string>
  mode: 'select' | 'apply'
  /** Toggle a tag. In `apply` mode the caller writes the row. */
  onToggle: (tag: ReviewTag) => void
  /** A tag was created, renamed or deleted — the page owns the vocabulary. */
  onVocabularyChange: (tags: ReviewTag[] | ((prev: ReviewTag[]) => ReviewTag[])) => void
  /**
   * A tag was deleted. Deleting the tag cascades its `moment_tags` rows in the
   * database, so the page has to drop them from its own state or the lane keeps
   * rendering dots for a tag that no longer exists.
   */
  onTagDeleted?: (tagId: string) => void
  onClose: () => void
  /** Shown in `apply` mode so the user knows which moment they are marking. */
  timestampLabel?: string
}

export default function TagPicker({
  tags,
  selectedIds,
  mode,
  onToggle,
  onVocabularyChange,
  onTagDeleted,
  onClose,
  timestampLabel,
}: TagPickerProps) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ tag: ReviewTag; usage: number } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [])

  // Click outside closes — but not while a confirm dialog is up, or a stray
  // click would dismiss the question instead of answering it.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (confirmDelete) return
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [onClose, confirmDelete])

  const trimmed = query.trim()

  const filtered = useMemo(() => {
    if (!trimmed) return tags
    const needle = trimmed.toLowerCase()
    return tags.filter(t => t.name.toLowerCase().includes(needle))
  }, [tags, trimmed])

  const exactMatch = useMemo(
    () => tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase()) ?? null,
    [tags, trimmed],
  )

  const canCreate = trimmed.length > 0 && !exactMatch

  // The create row sits at the top of the list when it exists, so index 0 is
  // "create" and the tags shift down by one.
  const rowCount = filtered.length + (canCreate ? 1 : 0)

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const handleCreate = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await createReviewTag(trimmed)
      onVocabularyChange(prev =>
        prev.some(t => t.id === created.id)
          ? prev
          : [...prev, created].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
      )
      onToggle(created)
      setQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the tag.')
    } finally {
      setBusy(false)
    }
  }

  const handleRename = async (tag: ReviewTag) => {
    const next = renameValue.trim()
    if (!next || next === tag.name) {
      setRenamingId(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await renameReviewTag(tag.id, next)
      onVocabularyChange(prev =>
        prev
          .map(t => (t.id === updated.id ? updated : t))
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
      )
      setRenamingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the tag.')
    } finally {
      setBusy(false)
    }
  }

  const openDeleteConfirm = async (tag: ReviewTag) => {
    setMenuFor(null)
    setBusy(true)
    setError(null)
    try {
      setConfirmDelete({ tag, usage: await countTagUsage(tag.id) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not count tag usage.')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (tag: ReviewTag) => {
    setBusy(true)
    setError(null)
    try {
      await deleteReviewTag(tag.id)
      onVocabularyChange(prev => prev.filter(t => t.id !== tag.id))
      onTagDeleted?.(tag.id)
      setConfirmDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the tag.')
    } finally {
      setBusy(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (confirmDelete) setConfirmDelete(null)
      else if (renamingId) setRenamingId(null)
      else onClose()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (rowCount === 0 ? 0 : (i + 1) % rowCount))
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (rowCount === 0 ? 0 : (i - 1 + rowCount) % rowCount))
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (busy) return
      if (canCreate && activeIndex === 0) {
        handleCreate()
        return
      }
      const tag = filtered[canCreate ? activeIndex - 1 : activeIndex]
      if (tag) {
        onToggle(tag)
        setQuery('')
      }
    }
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className="w-64 bg-bg-card border border-bg-elevated rounded-lg shadow-xl overflow-hidden"
    >
      <div className="px-2.5 py-2 border-b border-bg-elevated flex items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tags.length === 0 ? 'Type to create your first tag' : 'Filter or create…'}
          className="flex-1 min-w-0 bg-transparent text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {timestampLabel && (
          <span className="font-stats text-[10px] text-val-cyan shrink-0">{timestampLabel}</span>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {canCreate && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            onMouseEnter={() => setActiveIndex(0)}
            className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-left transition-colors ${
              activeIndex === 0 ? 'bg-val-cyan/10' : 'hover:bg-bg-elevated/50'
            }`}
          >
            <Plus className="w-3.5 h-3.5 text-val-cyan shrink-0" />
            <span className="text-[12px] text-text-primary truncate">
              Create <strong>{trimmed}</strong>
            </span>
          </button>
        )}

        {filtered.map((tag, i) => {
          const index = canCreate ? i + 1 : i
          const selected = selectedIds.has(tag.id)
          const isRenaming = renamingId === tag.id

          return (
            <div
              key={tag.id}
              onMouseEnter={() => setActiveIndex(index)}
              className={`group px-2.5 py-1.5 flex items-center gap-2 ${
                activeIndex === index ? 'bg-val-cyan/10' : ''
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />

              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => handleRename(tag)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleRename(tag)
                    }
                  }}
                  className="flex-1 min-w-0 bg-bg-elevated px-1.5 py-0.5 rounded text-[12px] text-text-primary focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onToggle(tag)
                    setQuery('')
                  }}
                  disabled={busy}
                  className="flex-1 min-w-0 text-left text-[12px] text-text-secondary hover:text-text-primary transition-colors truncate"
                >
                  {tag.name}
                </button>
              )}

              {selected && <Check className="w-3.5 h-3.5 text-val-cyan shrink-0" />}

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setMenuFor(prev => (prev === tag.id ? null : tag.id))}
                  className="text-text-muted hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Rename or delete"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>

                {menuFor === tag.id && (
                  <div className="absolute right-0 top-5 z-10 w-28 bg-bg-elevated border border-bg-card rounded-md shadow-lg py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(tag.name)
                        setRenamingId(tag.id)
                        setMenuFor(null)
                      }}
                      className="w-full px-2.5 py-1 text-left text-[11px] text-text-secondary hover:text-text-primary"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => openDeleteConfirm(tag)}
                      className="w-full px-2.5 py-1 text-left text-[11px] text-val-red hover:text-val-red/80"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && !canCreate && (
          <p className="px-2.5 py-3 text-[11px] text-text-muted text-center">
            {tags.length === 0 ? 'No tags yet — type a name to create one.' : 'No tag matches that.'}
          </p>
        )}
      </div>

      {confirmDelete && (
        <div className="px-2.5 py-2 border-t border-val-red/30 bg-val-red/5">
          <p className="text-[11px] text-text-secondary mb-1.5">
            Delete <strong style={{ color: confirmDelete.tag.color }}>{confirmDelete.tag.name}</strong>
            {confirmDelete.usage > 0 ? (
              <>
                {' '}
                and remove it from <strong>{confirmDelete.usage}</strong> moment
                {confirmDelete.usage === 1 ? '' : 's'}? Your notes stay.
              </>
            ) : (
              <> — it isn't used anywhere yet.</>
            )}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => handleDelete(confirmDelete.tag)}
              disabled={busy}
              className="px-2 py-0.5 rounded bg-val-red/15 text-val-red border border-val-red/30 text-[11px] hover:bg-val-red/25 transition-colors"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-2 py-0.5 rounded text-[11px] text-text-muted hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'apply' && !confirmDelete && (
        <div
          className="px-2.5 py-1.5 border-t border-bg-elevated text-[10px] text-text-muted"
          style={{ backgroundColor: hexWithAlpha('#53CADC', 0.04) }}
        >
          Picking applies straight away · Esc closes
        </div>
      )}

      {error && <div className="px-2.5 py-1.5 text-[11px] text-val-red border-t border-bg-elevated">{error}</div>}
    </div>
  )
}
