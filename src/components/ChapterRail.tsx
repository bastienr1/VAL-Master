import { useMemo, useState } from 'react'
import { CornerDownRight, Dumbbell, ListOrdered } from 'lucide-react'
import NoteMarkdown from './NoteMarkdown'
import { drillForRange } from '../lib/guideDisplay'
import { guideMarkdown } from '../lib/guideMarkdown'
import {
  activeMomentIndex,
  extractMoments,
  linkifyTimestamps,
  type ChapterMoment,
} from '../lib/playbookMoments'
import { formatTime } from '../lib/youtube'
import type { PracticeDrill, ReferenceSection } from '../lib/types'

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
  /**
   * The guide's drills. A moment whose range contains a drill's Source start is
   * the footage that drill came from, and is marked as such.
   */
  drills?: PracticeDrill[]
  /**
   * Fired with the linked drill's position when a marked moment is clicked, and
   * with null for any other moment, so the page can open and highlight the
   * drill — or let go of the last one.
   */
  onDrillFocus?: (position: number | null) => void
}

const momentTime = (moment: ChapterMoment) =>
  moment.end_seconds === null
    ? formatTime(moment.start_seconds)
    : `${formatTime(moment.start_seconds)} - ${formatTime(moment.end_seconds)}`

/**
 * The chapters of a study guide, left of the player.
 *
 * Which row is highlighted is derived from the playhead rather than stored, so
 * clicking a row needs no selection state: the click seeks, the player's time
 * moves, and the highlight follows. Only the body a user has explicitly opened
 * is tracked, because an unranged chapter — the older map guides have whole
 * sections of them — can never be reached by the playhead.
 *
 * An open chapter lists its **moments** beneath it — the same labelled timestamps
 * the playbook reader nests and the review session's study dock offers as a
 * dropdown. They are parsed out of the body at render time rather than stored,
 * so every guide already imported has them.
 *
 * A moment that a practice drill was drawn from carries a dumbbell. The link is
 * derived too — the drill's Source range against the moment's — so it needs
 * nothing from the note beyond what the drill table already says.
 */
export default function ChapterRail({
  sections,
  currentTime,
  readingMode,
  onSeek,
  drills = [],
  onDrillFocus,
}: ChapterRailProps) {
  const [openedPosition, setOpenedPosition] = useState<number | null>(null)

  /**
   * Moments per chapter. A chapter with a range drops any moment outside it —
   * guides cross-reference other parts of the tape, and those would jump
   * somewhere unexpected. An unranged heading has nothing to filter against, so
   * it keeps whatever its body labels.
   */
  const momentsByPosition = useMemo(
    () =>
      new Map(
        sections.map(section => [
          section.position,
          extractMoments(
            section.body_md,
            section.start_seconds === null
              ? undefined
              : {
                  start_seconds: section.start_seconds,
                  end_seconds: section.end_seconds ?? Number.POSITIVE_INFINITY,
                },
          ),
        ]),
      ),
    [sections],
  )

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
          const moments = momentsByPosition.get(section.position) ?? []
          const playingMoment =
            playing && !readingMode ? activeMomentIndex(moments, currentTime, section.end_seconds) : -1
          // With moments, each drill hangs off the one it was drawn from; a
          // chapter with none carries the mark itself.
          const chapterDrill =
            moments.length === 0 && section.start_seconds !== null
              ? drillForRange(drills, section.start_seconds, section.end_seconds)
              : null

          return (
            <li key={section.id} className={playing ? 'bg-val-cyan/5' : ''}>
              <button
                type="button"
                // A chapter with no range still opens — it just cannot seek.
                onClick={() => {
                  setOpenedPosition(prev => (prev === section.position ? null : section.position))
                  if (seekable) onSeek(section.start_seconds!)
                  if (chapterDrill) onDrillFocus?.(chapterDrill.position)
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
                    {chapterDrill && (
                      <Dumbbell
                        className="inline w-3 h-3 ml-1.5 -mt-0.5 text-val-yellow"
                        aria-label={`Practice drill ${chapterDrill.position}`}
                      />
                    )}
                  </span>
                  {/* Only worth saying while they are out of sight. */}
                  {!open && moments.length > 0 && (
                    <span className="block text-[10px] text-text-muted">
                      {moments.length} {moments.length === 1 ? 'moment' : 'moments'}
                    </span>
                  )}
                </span>
              </button>

              {open && moments.length > 0 && (
                <ul className="pb-1.5 pr-2 pl-3" aria-label={`Moments in ${section.heading}`}>
                  {moments.map((moment, i) => {
                    const current = i === playingMoment
                    // An open-ended moment runs to the next one, as the
                    // highlight above already assumes.
                    const drill = drillForRange(
                      drills,
                      moment.start_seconds,
                      moment.end_seconds ?? moments[i + 1]?.start_seconds ?? section.end_seconds,
                    )
                    return (
                      <li key={`${moment.start_seconds}-${moment.label}`}>
                        <button
                          type="button"
                          // With no video a marked moment still opens its drill.
                          disabled={readingMode && !drill}
                          onClick={() => {
                            if (!readingMode) onSeek(moment.start_seconds)
                            onDrillFocus?.(drill?.position ?? null)
                          }}
                          title={
                            drill
                              ? `${readingMode ? 'Show' : `Jump to ${formatTime(moment.start_seconds)} and show`} practice drill ${drill.position}`
                              : readingMode
                                ? 'No video linked — nothing to seek to'
                                : `Jump to ${formatTime(moment.start_seconds)}`
                          }
                          className={`w-full flex items-center gap-1.5 py-0.5 px-1 rounded text-left transition-colors ${
                            current
                              ? 'bg-val-cyan/10 text-val-cyan'
                              : 'text-text-secondary enabled:hover:text-text-primary enabled:hover:bg-bg-elevated/40'
                          } ${readingMode && !drill ? 'cursor-default' : ''}`}
                        >
                          <CornerDownRight
                            className={`w-3 h-3 shrink-0 ${current ? 'text-val-cyan' : 'text-text-muted'}`}
                          />
                          <span className="flex-1 min-w-0 truncate text-[11px] leading-snug">{moment.label}</span>
                          {drill && (
                            <Dumbbell
                              className="w-3 h-3 shrink-0 text-val-yellow"
                              aria-label={`Practice drill ${drill.position}`}
                            />
                          )}
                          <span className="font-stats text-[10px] text-val-cyan whitespace-nowrap">
                            {momentTime(moment)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {open && section.body_md && (
                <div className="px-3 pb-3 pt-0.5">
                  {/* Same renderer as the notes panels — one markdown look across
                      the rail, and tables stay out of a 320px column. Body
                      timestamps become jumps too, so a range mentioned
                      mid-sentence is as reachable as a moment row. */}
                  <NoteMarkdown onJump={readingMode ? undefined : onSeek}>
                    {readingMode
                      ? guideMarkdown(section.body_md)
                      : linkifyTimestamps(guideMarkdown(section.body_md))}
                  </NoteMarkdown>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
