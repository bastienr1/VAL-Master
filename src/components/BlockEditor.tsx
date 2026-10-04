import { useState } from 'react'
import { ArrowDown, ArrowUp, Minus, Plus, X } from 'lucide-react'
import {
  archiveBlock,
  createBlock,
  deleteBlock,
  reorderBlocks,
  restoreBlock,
  updateBlock,
} from '../lib/weeklyPlanStore'
import type { RoutineBlock } from '../lib/types'

const MIN_TARGET = 1
const MAX_TARGET = 7
const NEW_BLOCK_TARGET = 3

const inputClass =
  'bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors'
const iconButton =
  'w-7 h-7 rounded-md border border-bg-elevated flex items-center justify-center text-text-secondary hover:border-val-cyan/50 hover:text-val-cyan transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-bg-elevated disabled:hover:text-text-secondary'

interface BlockEditorProps {
  /** Every block, archived ones included. */
  blocks: RoutineBlock[]
  run: (action: () => Promise<unknown>, what: string) => void
  onClose: () => void
}

/**
 * The routine itself: rename, re-target, reorder, archive. An archived block
 * leaves the grid from this week on and keeps its past weeks; "Delete with
 * history" is the only real delete.
 */
export default function BlockEditor({ blocks, run, onClose }: BlockEditorProps) {
  const [newName, setNewName] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const active = blocks.filter(block => block.archived_at === null)
  const archived = blocks.filter(block => block.archived_at !== null)

  const move = (index: number, by: -1 | 1) => {
    const ids = active.map(block => block.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + by, 0, id)
    // Archived blocks keep their place after the active ones.
    run(() => reorderBlocks([...ids, ...archived.map(block => block.id)]), 'reorder the routine')
  }

  const add = () => {
    const name = newName.trim()
    if (name === '') return
    setNewName('')
    run(() => createBlock(name, NEW_BLOCK_TARGET), 'add the block')
  }

  return (
    <section aria-label="Edit routine" className="bg-bg-card border border-bg-elevated rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold tracking-wide">Edit routine</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the routine editor"
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-text-muted">No blocks yet. Add the first one below.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((block, index) => (
            <li key={block.id} className="flex flex-wrap items-center gap-2">
              <input
                key={block.name}
                type="text"
                defaultValue={block.name}
                aria-label="Block name"
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                onBlur={e => {
                  const name = e.target.value.trim()
                  if (name === '') e.target.value = block.name
                  else if (name !== block.name) run(() => updateBlock(block.id, { name }), 'rename the block')
                }}
                className={`${inputClass} flex-1 min-w-[10rem]`}
              />
              <div className="flex items-center gap-1.5" role="group" aria-label={`Sessions per week for ${block.name}`}>
                <button
                  type="button"
                  aria-label="One session fewer"
                  disabled={block.weekly_target <= MIN_TARGET}
                  onClick={() => run(() => updateBlock(block.id, { weekly_target: block.weekly_target - 1 }), 'change the target')}
                  className={iconButton}
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-stats text-sm w-12 text-center">×{block.weekly_target} / wk</span>
                <button
                  type="button"
                  aria-label="One session more"
                  disabled={block.weekly_target >= MAX_TARGET}
                  onClick={() => run(() => updateBlock(block.id, { weekly_target: block.weekly_target + 1 }), 'change the target')}
                  className={iconButton}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                type="button"
                aria-label={`Move ${block.name} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className={iconButton}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${block.name} down`}
                disabled={index === active.length - 1}
                onClick={() => move(index, 1)}
                className={iconButton}
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => run(() => archiveBlock(block.id), 'archive the block')}
                className="text-xs text-text-secondary hover:text-val-red transition-colors px-1"
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') add()
          }}
          aria-label="New block name"
          placeholder="New block, e.g. Deathmatch"
          className={`${inputClass} flex-1 min-w-[10rem]`}
        />
        <button
          type="button"
          onClick={add}
          disabled={newName.trim() === ''}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-val-cyan/10 text-val-cyan border border-val-cyan/20 hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add block
        </button>
      </div>

      {archived.length > 0 && (
        <details className="pt-1">
          <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary transition-colors">
            Archived blocks ({archived.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {archived.map(block => (
              <li key={block.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-text-secondary">{block.name}</span>
                {confirming === block.id ? (
                  <>
                    <span className="text-xs text-val-red">Delete it with every check-in and focus it has?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null)
                        run(() => deleteBlock(block.id), 'delete the block')
                      }}
                      className="text-xs text-val-red hover:underline"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="text-xs text-text-secondary hover:underline"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => run(() => restoreBlock(block.id), 'restore the block')}
                      className="text-xs text-val-cyan hover:underline"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(block.id)}
                      className="text-xs text-text-secondary hover:text-val-red transition-colors"
                    >
                      Delete with history
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
