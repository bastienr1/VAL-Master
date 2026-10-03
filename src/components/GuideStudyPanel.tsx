import { useEffect, useRef, useState } from 'react'
import { CheckSquare, Dumbbell, Lightbulb, ListChecks, Play, Square } from 'lucide-react'
import NoteMarkdown from './NoteMarkdown'
import SaveDrillButton from './SaveDrillButton'
import { parseActionItems } from '../lib/guideDisplay'
import { guideMarkdown } from '../lib/guideMarkdown'
import { linkifyTimestamps } from '../lib/playbookMoments'
import { sameScope, scopeLabel } from '../lib/savedDrillScope'
import { formatTime } from '../lib/youtube'
import type { DrillWithProgress, SavedDrill, SavedDrillScope } from '../lib/types'

/** What the page did with a save request: saved it, or wants the row to ask where. */
export type SaveDrillResult = 'saved' | 'pick' | 'failed'

interface GuideStudyPanelProps {
  takeaways: string | null
  drills: DrillWithProgress[]
  habitCues: string | null
  actionItems: string | null
  /** Omitted when the guide has no video — sources then read as plain ranges. */
  onSeek?: (seconds: number) => void
  /** The open tab, owned by the page so the chapter rail can open Practice. */
  tab: StudyTab | null
  onTabChange: (tab: StudyTab) => void
  /**
   * The drill a clicked moment was the footage for. `nonce` changes on every
   * click, so clicking the same moment again scrolls back to its drill.
   */
  drillFocus: { position: number; nonce: number } | null
  /**
   * Saving. All four are optional together: without them the Practice tab is
   * the read-only list it always was. `onSaveDrill` with a null scope asks the
   * page for the guide's default; `'pick'` back means there is none and the
   * row opens its menu instead.
   */
  savedByDrillId?: Map<string, SavedDrill>
  scopeOptions?: SavedDrillScope[]
  onSaveDrill?: (drill: DrillWithProgress, scope: SavedDrillScope | null) => Promise<SaveDrillResult>
  onRemoveSaved?: (saved: SavedDrill) => Promise<void>
}

export type StudyTab = 'takeaways' | 'practice' | 'actions'

const SCOPE_GROUPS: Array<{ type: SavedDrillScope['type']; heading: string }> = [
  { type: 'map', heading: 'Map' },
  { type: 'agent', heading: 'Agent' },
  { type: 'concept', heading: 'Skill' },
]

/**
 * The inline "save to" menu under a drill row: every place the guide allows,
 * grouped, the current one marked. Lives in the row (no portal) so it scrolls
 * with the list; Escape and a click outside close it.
 */
function ScopeMenu({
  options,
  current,
  onPick,
  onClose,
}: {
  options: SavedDrillScope[]
  current: Pick<SavedDrillScope, 'type' | 'value'> | null
  onPick: (scope: SavedDrillScope) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute left-0 top-full mt-1 z-20 w-60 max-h-72 overflow-y-auto bg-bg-card border border-bg-elevated rounded-lg shadow-lg p-1.5 space-y-1.5"
    >
      {SCOPE_GROUPS.map(group => {
        const items = options.filter(option => option.type === group.type)
        if (items.length === 0) return null
        return (
          <div key={group.type}>
            <div className="px-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-text-muted">{group.heading}</div>
            <div className="flex flex-wrap gap-1">
              {items.map(option => {
                const active = current !== null && sameScope(current, option)
                return (
                  <button
                    key={`${option.type}:${option.value}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => onPick(option)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                      active
                        ? 'bg-val-cyan/10 text-val-cyan border-val-cyan/30'
                        : 'bg-transparent text-text-secondary border-bg-elevated hover:border-text-muted'
                    }`}
                  >
                    {scopeLabel(option)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {options.length === 0 && (
        <p className="px-1.5 py-1 text-[11px] text-text-muted">Nothing to save to yet — the map pool is still loading.</p>
      )}
    </div>
  )
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-val-cyan/10 text-val-cyan border-val-cyan/20',
  done: 'bg-val-green/10 text-val-green border-val-green/20',
}

/** `33:50 - 35:07`, or the start alone when the note gave no end. */
function sourceLabel(drill: DrillWithProgress): string {
  const start = formatTime(drill.source_start_seconds ?? 0)
  return drill.source_end_seconds === null ? start : `${start} - ${formatTime(drill.source_end_seconds)}`
}

/**
 * The note's frame, under the player: what to remember, what to practise, what
 * to do next.
 *
 * Tabs rather than three stacked cards, so the player stays on screen whichever
 * one is open. A tab exists only when the note has that section — the older map
 * guides have no drill table — and the whole panel disappears for a note with
 * none, which is also what a Notion pro VOD is.
 *
 * Everything here is read from the note. Drill status and logged sessions are
 * shown when they exist but are not edited here. Saving a drill — bookmarking
 * it to a map, an agent or a skill — is the one thing the user does from this
 * panel, and it writes to `saved_drills`, never to the drill itself.
 *
 * A moment in the chapter rail that a drill was drawn from opens Practice and
 * marks that drill, in the same yellow as the dumbbell on the moment.
 */
export default function GuideStudyPanel({
  takeaways,
  drills,
  habitCues,
  actionItems,
  onSeek,
  tab,
  onTabChange,
  drillFocus,
  savedByDrillId,
  scopeOptions,
  onSaveDrill,
  onRemoveSaved,
}: GuideStudyPanelProps) {
  // A dropped drill left the note; it stays in the table only for its logs.
  const liveDrills = drills.filter(drill => drill.status !== 'dropped')
  const actions = parseActionItems(actionItems)

  const canSave = !!(savedByDrillId && scopeOptions && onSaveDrill && onRemoveSaved)
  // Which row has its "save to" menu open, and which one has a write in flight.
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const toggleSave = async (drill: DrillWithProgress) => {
    if (!canSave || busyId) return
    const saved = savedByDrillId!.get(drill.id) ?? null
    setBusyId(drill.id)
    try {
      if (saved) {
        await onRemoveSaved!(saved)
        setMenuFor(null)
      } else if ((await onSaveDrill!(drill, null)) === 'pick') {
        setMenuFor(drill.id)
      }
    } finally {
      setBusyId(null)
    }
  }

  const pickScope = async (drill: DrillWithProgress, scope: SavedDrillScope) => {
    if (!canSave || busyId) return
    setMenuFor(null)
    setBusyId(drill.id)
    try {
      await onSaveDrill!(drill, scope)
    } finally {
      setBusyId(null)
    }
  }

  const tabs: { id: StudyTab; label: string; count: number | null; icon: typeof Lightbulb }[] = []
  if (takeaways) tabs.push({ id: 'takeaways', label: 'Key takeaways', count: null, icon: Lightbulb })
  if (liveDrills.length > 0 || habitCues) {
    tabs.push({ id: 'practice', label: 'Practice', count: liveDrills.length, icon: Dumbbell })
  }
  if (actions.length > 0) {
    tabs.push({ id: 'actions', label: 'Action items', count: actions.length, icon: ListChecks })
  }

  // Brought into view only as far as needed, so the player moves as little as
  // the screen allows. Keyed on the nonce, not the position, to re-run on a
  // repeat click.
  const focusedRow = useRef<HTMLLIElement | null>(null)
  const focusNonce = drillFocus?.nonce
  useEffect(() => {
    if (focusNonce === undefined) return
    focusedRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusNonce])

  if (tabs.length === 0) return null
  const active = tabs.some(candidate => candidate.id === tab) ? tab : tabs[0].id

  const rendered = (markdown: string) =>
    onSeek ? linkifyTimestamps(guideMarkdown(markdown)) : guideMarkdown(markdown)

  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl overflow-hidden">
      <div role="tablist" aria-label="Study notes" className="flex overflow-x-auto border-b border-bg-elevated px-1">
        {tabs.map(tab => {
          const selected = tab.id === active
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onTabChange(tab.id)}
              className={`-mb-px shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-2 border-b-2 text-[11px] uppercase tracking-wider transition-colors ${
                selected
                  ? 'border-val-cyan text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${selected ? 'text-val-cyan' : ''}`} />
              {tab.label}
              {tab.count !== null && tab.count > 0 && (
                <span className="font-stats text-[10px] text-text-muted">{tab.count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="px-4 py-3">
        {active === 'takeaways' && takeaways && (
          <NoteMarkdown onJump={onSeek}>{rendered(takeaways)}</NoteMarkdown>
        )}

        {active === 'practice' && (
          <div className="space-y-3">
            {liveDrills.length > 0 && (
              <ol className="divide-y divide-bg-elevated/60">
                {liveDrills.map(drill => {
                  const focused = drillFocus?.position === drill.position
                  const saved = canSave ? (savedByDrillId!.get(drill.id) ?? null) : null
                  const menuOpen = canSave && menuFor === drill.id
                  return (
                    <li
                      key={drill.id}
                      ref={focused ? focusedRow : undefined}
                      aria-current={focused ? 'true' : undefined}
                      className={`py-2.5 flex gap-3 items-start ${
                        focused
                          ? '-mx-2 px-2 rounded-lg bg-val-yellow/5 ring-1 ring-inset ring-val-yellow/40'
                          : 'first:pt-0 last:pb-0'
                      }`}
                    >
                      <span
                        className={`font-stats text-[11px] w-4 shrink-0 mt-0.5 ${
                          focused ? 'text-val-yellow' : 'text-text-muted'
                        }`}
                      >
                        {drill.position}
                      </span>

                      <div className="min-w-0 flex-1">
                        <NoteMarkdown>{guideMarkdown(drill.title)}</NoteMarkdown>

                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {drill.venue && (
                            <span className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[10px] font-medium">
                              {drill.venue}
                            </span>
                          )}
                          {STATUS_STYLE[drill.status] && (
                            <span
                              className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLE[drill.status]}`}
                            >
                              {drill.status}
                            </span>
                          )}
                          {drill.log_count > 0 && (
                            <span className="font-stats text-[10px] text-text-muted">
                              {drill.log_count}
                              {drill.target_sessions ? ` / ${drill.target_sessions}` : ''} logged
                            </span>
                          )}
                        </div>

                        {(drill.cue || drill.success_signal) && (
                          <dl className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2 text-[12px] leading-snug">
                            {drill.cue && (
                              <div>
                                <dt className="text-[10px] uppercase tracking-wider text-text-muted">Watch for</dt>
                                <dd className="text-text-secondary">{drill.cue}</dd>
                              </div>
                            )}
                            {drill.success_signal && (
                              <div>
                                <dt className="text-[10px] uppercase tracking-wider text-text-muted">Success</dt>
                                <dd className="text-text-secondary">{drill.success_signal}</dd>
                              </div>
                            )}
                          </dl>
                        )}

                        {/* Where the save went, and the way to move it. The menu
                            also opens on its own when the guide has no default. */}
                        {canSave && (saved || menuOpen) && (
                          <div className="relative mt-1.5 text-[11px] text-text-muted">
                            {saved ? (
                              <>
                                Saved to{' '}
                                <span className="text-text-secondary">
                                  {scopeLabel({ type: saved.scope_type, value: saved.scope_value })}
                                </span>
                                {' · '}
                              </>
                            ) : (
                              <>Save to… </>
                            )}
                            <button
                              type="button"
                              onClick={() => setMenuFor(menuOpen ? null : drill.id)}
                              aria-expanded={menuOpen}
                              className="text-val-cyan hover:underline"
                            >
                              {saved ? 'Change' : 'Pick a place'}
                            </button>
                            {menuOpen && (
                              <ScopeMenu
                                options={scopeOptions!}
                                current={saved ? { type: saved.scope_type, value: saved.scope_value } : null}
                                onPick={scope => pickScope(drill, scope)}
                                onClose={() => setMenuFor(null)}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {canSave && (
                          <SaveDrillButton saved={saved} busy={busyId === drill.id} onToggle={() => toggleSave(drill)} />
                        )}
                        {drill.source_start_seconds !== null &&
                          (onSeek ? (
                            <button
                              type="button"
                              onClick={() => onSeek(drill.source_start_seconds!)}
                              title={`Jump to ${formatTime(drill.source_start_seconds)}`}
                              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-val-cyan/10 border border-val-cyan/20 text-val-cyan font-stats text-[10px] whitespace-nowrap hover:bg-val-cyan/20 transition-colors"
                            >
                              <Play className="w-3 h-3" />
                              {sourceLabel(drill)}
                            </button>
                          ) : (
                            <span className="shrink-0 font-stats text-[10px] text-text-muted whitespace-nowrap mt-0.5">
                              {sourceLabel(drill)}
                            </span>
                          ))}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}

            {habitCues && (
              <div className={liveDrills.length > 0 ? 'pt-3 border-t border-bg-elevated' : ''}>
                <h3 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Habit cues</h3>
                <NoteMarkdown>{guideMarkdown(habitCues)}</NoteMarkdown>
              </div>
            )}
          </div>
        )}

        {active === 'actions' && (
          <div className="space-y-2">
            <ul className="space-y-1.5">
              {actions.map(item => (
                <li key={item.text} className="flex gap-2 items-start">
                  {item.done ? (
                    <CheckSquare className="w-3.5 h-3.5 text-val-green shrink-0 mt-[3px]" aria-label="Done" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-text-muted shrink-0 mt-[3px]" aria-label="Open" />
                  )}
                  <div className={`min-w-0 ${item.done ? 'opacity-60' : ''}`}>
                    <NoteMarkdown>{guideMarkdown(item.text)}</NoteMarkdown>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-text-muted">
              Read from the note. Tick an item there and re-import to update it here.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
