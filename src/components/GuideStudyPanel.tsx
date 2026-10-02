import { useState } from 'react'
import { CheckSquare, Dumbbell, Lightbulb, ListChecks, Play, Square } from 'lucide-react'
import NoteMarkdown from './NoteMarkdown'
import { parseActionItems } from '../lib/guideDisplay'
import { guideMarkdown } from '../lib/guideMarkdown'
import { linkifyTimestamps } from '../lib/playbookMoments'
import { formatTime } from '../lib/youtube'
import type { DrillWithProgress } from '../lib/types'

interface GuideStudyPanelProps {
  takeaways: string | null
  drills: DrillWithProgress[]
  habitCues: string | null
  actionItems: string | null
  /** Omitted when the guide has no video — sources then read as plain ranges. */
  onSeek?: (seconds: number) => void
}

type TabId = 'takeaways' | 'practice' | 'actions'

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
 * shown when they exist but are not edited here.
 */
export default function GuideStudyPanel({
  takeaways,
  drills,
  habitCues,
  actionItems,
  onSeek,
}: GuideStudyPanelProps) {
  // A dropped drill left the note; it stays in the table only for its logs.
  const liveDrills = drills.filter(drill => drill.status !== 'dropped')
  const actions = parseActionItems(actionItems)

  const tabs: { id: TabId; label: string; count: number | null; icon: typeof Lightbulb }[] = []
  if (takeaways) tabs.push({ id: 'takeaways', label: 'Key takeaways', count: null, icon: Lightbulb })
  if (liveDrills.length > 0 || habitCues) {
    tabs.push({ id: 'practice', label: 'Practice', count: liveDrills.length, icon: Dumbbell })
  }
  if (actions.length > 0) {
    tabs.push({ id: 'actions', label: 'Action items', count: actions.length, icon: ListChecks })
  }

  const [picked, setPicked] = useState<TabId | null>(null)
  if (tabs.length === 0) return null
  const active = tabs.some(tab => tab.id === picked) ? picked : tabs[0].id

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
              onClick={() => setPicked(tab.id)}
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
                {liveDrills.map(drill => (
                  <li key={drill.id} className="py-2.5 first:pt-0 last:pb-0 flex gap-3 items-start">
                    <span className="font-stats text-[11px] text-text-muted w-4 shrink-0 mt-0.5">
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
                    </div>

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
                  </li>
                ))}
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
