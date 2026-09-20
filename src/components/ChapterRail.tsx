import { useMemo, useState } from 'react'
import { ListOrdered } from 'lucide-react'
import NoteMarkdown from './NoteMarkdown'
import { guideMarkdown } from '../lib/guideMarkdown'
import { formatTime } from '../lib/youtube'
import type { ReferenceSection } from '../lib/types'

interface ChapterRailProps {
  sections: ReferenceSection[]
  /** From the player's own 250 ms poll — no second interval here. */
  currentTime: number
  /**
   * No video linked. Every body is expanded and nothing seeks: the guide becomes
   * a reading view until a `video_url` is pasted into the note and it is
   * re-imported.
   */
  readingMode: boolean
  onSeek: (seconds: number) => void
}

/**
 * The chapters of a study guide, left of the player.
 *
 * Which row is highlighted is derived from the playhead rather than stored, so
 * clicking a row needs no selection state: the click seeks, the player's time
 * moves, and the highlight follows. Only the body a user has explicitly opened
 * is tracked, because an unranged chapter — the older map guides have whole
 * sections of them — can never be reached by the playhead.
 */
export default function ChapterRail({ sections, currentTime, readingMode, onSeek }: ChapterRailProps) {
  const [openedPosition, setOpenedPosition] = useState<number | null>(null)

  /** The chapter whose `[start, end)` contains the playhead. */
  const playingPosition = useMemo(() => {
    if (readingMode) return null
    const active = sections.find(
      section =>
        section.start_seconds !== null &&
        currentTime >= section.start_seconds &&
        (section.end_seconds === null || currentTime < section.end_seconds),
    )
    return active?.position ?? null
  }, [sections, currentTime, readingMode])

  if (sections.length === 0) {
    return (
      <div className="bg-bg-card border border-bg-elevated rounded-xl px-4 py-6 text-center">
        <ListOrdered className="w-8 h-8 text-text-muted mx-auto mb-2" />
        <p className="text-xs text-text-secondary">
          No chapters imported — the note's headings may be missing their{' '}
          <code className="font-stats text-val-cyan">[MM:SS–MM:SS]</code> ranges.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-bg-card border border-bg-elevated rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-bg-elevated flex items-center gap-2">
        <ListOrdered className="w-3.5 h-3.5 text-val-cyan" />
        <h2 className="text-[10px] uppercase tracking-wider text-text-muted">Chapters</h2>
        <span className="ml-auto font-stats text-[10px] text-text-muted">{sections.length}</span>
      </div>

      <ol className="divide-y divide-bg-elevated/60 max-h-[70vh] overflow-y-auto">
        {sections.map(section => {
          const seekable = !readingMode && section.start_seconds !== null
          const playing = playingPosition === section.position
          const open = readingMode || openedPosition === section.position || (openedPosition === null && playing)

          return (
            <li key={section.id} className={playing ? 'bg-val-cyan/5' : ''}>
              <button
                type="button"
                // A chapter with no range still opens — it just cannot seek.
                onClick={() => {
                  setOpenedPosition(prev => (prev === section.position ? null : section.position))
                  if (seekable) onSeek(section.start_seconds!)
                }}
                className={`w-full text-left px-3 py-2 flex gap-2 items-start transition-colors hover:bg-bg-elevated/40 ${
                  playing ? 'border-l-2 border-val-cyan' : 'border-l-2 border-transparent'
                }`}
              >
                <span
                  className={`font-stats text-[11px] shrink-0 mt-0.5 ${
                    seekable ? 'text-val-cyan' : 'text-text-muted'
                  }`}
                  title={seekable ? undefined : 'No range in the note — nothing to seek to'}
                >
                  {section.start_seconds === null ? '--:--' : formatTime(section.start_seconds)}
                </span>

                <span className="min-w-0 flex-1">
                  {(section.map || section.agent) && (
                    <span className="flex flex-wrap gap-1 mb-0.5">
                      {section.map && (
                        <span className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[9px] font-medium">
                          {section.map}
                        </span>
                      )}
                      {section.agent && (
                        <span className="px-1.5 py-0.5 rounded bg-val-cyan/10 text-val-cyan text-[9px] font-medium">
                          {section.agent}
                        </span>
                      )}
                    </span>
                  )}
                  <span
                    className={`block text-[12px] leading-snug ${
                      playing ? 'text-text-primary font-medium' : 'text-text-secondary'
                    }`}
                  >
                    {section.heading}
                  </span>
                </span>
              </button>

              {open && section.body_md && (
                <div className="px-3 pb-3 pt-0.5">
                  {/* Same renderer as the notes panels — one markdown look across
                      the rail, and tables stay out of a 320px column. */}
                  <NoteMarkdown>{guideMarkdown(section.body_md)}</NoteMarkdown>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
