import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Trash2 } from 'lucide-react'
import type { PlaySide } from '../../lib/types'
import AgentIcon from './AgentIcon'

interface PlayHeaderProps {
  title: string
  onTitle(title: string): void
  map: string
  side: PlaySide
  comp: string[]
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

const chip = 'text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded'

/** Back link, the editable title, what the play is at a glance, Save and Delete. */
export default function PlayHeader(props: PlayHeaderProps) {
  const { title, map, side, comp, saving, savedFlash, onDelete } = props
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const sideChip = SIDE_CHIPS[side]

  const confirmDelete = async () => {
    if (!onDelete) return
    setDeleting(true)
    // On success the page navigates away; only a failure comes back here.
    if (!(await onDelete())) {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <Link to="/plays" aria-label="Back to plays" className="text-text-secondary hover:text-val-cyan transition-colors">
        <ArrowLeft className="w-5 h-5" />
      </Link>
      <input
        value={title}
        onChange={e => props.onTitle(e.target.value)}
        onFocus={e => e.target.select()}
        aria-label="Play title"
        className="font-heading text-2xl font-bold bg-transparent border-b border-transparent focus:border-val-cyan outline-none min-w-0 flex-1 basis-48"
      />
      <div className="flex items-center gap-2">
        {map && <span className={`${chip} text-text-secondary bg-bg-elevated`}>{map}</span>}
        <span className={`${chip} ${sideChip.className}`}>{sideChip.label}</span>
      </div>
      {comp.length > 0 && (
        <div className="flex items-center gap-1">
          {comp.map(name => (
            <AgentIcon key={name} name={name} size={28} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 ml-auto">
        {onDelete &&
          (confirming ? (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <span>Delete this play?</span>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="px-2 py-1 rounded-md text-xs text-val-red border border-val-red/25 bg-val-red/10 hover:bg-val-red/20 disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Yes'}
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
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label="Delete play"
              title="Delete"
              className="p-1.5 rounded-md text-text-muted hover:text-val-red transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ))}
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.canSave || saving}
          className="flex items-center gap-2 px-3 py-1.5 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {savedFlash && !saving && <Check className="w-4 h-4" />}
          <span className="text-sm font-medium">{saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save'}</span>
        </button>
      </div>
    </div>
  )
}
