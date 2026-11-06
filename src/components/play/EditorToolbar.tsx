import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, Ellipsis, PanelRight, Redo2, Tag, Trash2, Undo2 } from 'lucide-react'
import type { PlaySide } from '../../lib/types'

interface EditorToolbarProps {
  title: string
  onTitle(title: string): void
  map: string
  side: PlaySide
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
  showCallouts: boolean
  onToggleCallouts(): void
  playbookOpen: boolean
  onTogglePlaybook(): void
  drawerOpen: boolean
  onToggleDrawer(): void
  /** The play has never been composed: the Brief button carries a dot while the drawer is closed. */
  briefHint: boolean
  canSave: boolean
  saving: boolean
  /** True for the moment after a save, to show "Saved". */
  savedFlash: boolean
  onSave(): void
  /** Absent for a play never saved. Resolves false when the delete failed (the page shows why). */
  onDelete?: () => Promise<boolean>
}

const SIDE_CHIPS: Record<PlaySide, { label: string; className: string }> = {
  attack: { label: 'Attack', className: 'text-val-red bg-val-red/10' },
  defense: { label: 'Defense', className: 'text-val-cyan bg-val-cyan/10' },
}

const chip = 'text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded whitespace-nowrap'

const iconButton =
  'p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-elevated/60 transition-colors disabled:opacity-30 disabled:pointer-events-none'

const toggle = (on: boolean) =>
  `relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
    on
      ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/25'
      : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-bg-elevated/60'
  }`

/**
 * The editor's one 44 px bar (docs/plays-editor-v2.md §2.5): back link, the
 * editable title, map and side at a glance, undo / redo, the Callouts,
 * Playbook (§2.6) and Brief toggles, Save, and Delete behind an overflow menu
 * for a saved play.
 */
export default function EditorToolbar(props: EditorToolbarProps) {
  const { title, map, side, saving, savedFlash, onDelete, drawerOpen } = props
  const sideChip = SIDE_CHIPS[side]

  return (
    <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-bg-elevated bg-bg-secondary min-w-0">
      <Link
        to="/plays"
        aria-label="Back to plays"
        title="Back to plays"
        className="text-text-secondary hover:text-val-cyan transition-colors shrink-0"
      >
        <ArrowLeft className="w-4 h-4" />
      </Link>
      <input
        value={title}
        onChange={e => props.onTitle(e.target.value)}
        onFocus={e => e.target.select()}
        aria-label="Play title"
        className="font-heading text-lg font-bold bg-transparent border-b border-transparent focus:border-val-cyan outline-none min-w-0 flex-1 max-w-md truncate"
      />
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {map && <span className={`${chip} text-text-secondary bg-bg-elevated`}>{map}</span>}
        <span className={`${chip} ${sideChip.className}`}>{sideChip.label}</span>
      </div>

      <div className="flex items-center gap-1 ml-auto shrink-0">
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" className={iconButton}>
          <Undo2 className="w-4 h-4" />
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo" title="Redo (Ctrl+Y)" className={iconButton}>
          <Redo2 className="w-4 h-4" />
        </button>
        <span aria-hidden="true" className="w-px h-5 bg-bg-elevated mx-1" />
        <button
          type="button"
          onClick={props.onToggleCallouts}
          aria-pressed={props.showCallouts}
          title="Show callout names"
          className={toggle(props.showCallouts)}
        >
          <Tag className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Callouts</span>
        </button>
        <button
          type="button"
          onClick={props.onTogglePlaybook}
          aria-pressed={props.playbookOpen}
          title={props.playbookOpen ? 'Hide the playbook' : 'Show the playbook'}
          className={toggle(props.playbookOpen)}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Playbook</span>
        </button>
        <button
          type="button"
          onClick={props.onToggleDrawer}
          aria-pressed={drawerOpen}
          title={drawerOpen ? 'Hide the brief' : 'Show the brief'}
          className={toggle(drawerOpen)}
        >
          <PanelRight className="w-3.5 h-3.5" />
          <span>Brief</span>
          {props.briefHint && !drawerOpen && (
            <span aria-label="Not composed yet" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-val-cyan" />
          )}
        </button>
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.canSave || saving}
          className="ml-1 flex items-center gap-1.5 px-3 py-1 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {savedFlash && !saving && <Check className="w-4 h-4" />}
          <span className="text-sm font-medium">{saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save'}</span>
        </button>
        {onDelete && <OverflowMenu onDelete={onDelete} />}
      </div>
    </div>
  )
}

/** "…" with Delete inside; the delete asks once more before it runs. */
function OverflowMenu({ onDelete }: { onDelete(): Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirming(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const confirmDelete = async () => {
    setDeleting(true)
    // On success the page navigates away; only a failure comes back here.
    if (!(await onDelete())) {
      setDeleting(false)
      setConfirming(false)
      setOpen(false)
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(o => !o)
          setConfirming(false)
        }}
        aria-label="More"
        aria-expanded={open}
        title="More"
        className={iconButton}
      >
        <Ellipsis className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-lg border border-bg-elevated bg-bg-card shadow-lg p-1">
          {confirming ? (
            <div className="px-2 py-1.5 space-y-2">
              <p className="text-sm text-text-secondary">Delete this play?</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="px-2 py-1 rounded-md text-xs text-val-red border border-val-red/25 bg-val-red/10 hover:bg-val-red/20 disabled:opacity-40"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="px-2 py-1 rounded-md text-xs text-text-muted hover:text-text-secondary"
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-text-secondary hover:text-val-red hover:bg-bg-elevated/60 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete play
            </button>
          )}
        </div>
      )}
    </div>
  )
}
