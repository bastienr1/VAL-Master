import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pause, Play } from 'lucide-react'
import { usePlaybookChapters, usePlaybooks } from '../../hooks/usePlaybooks'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer'
import { extractYouTubeId, formatTime } from '../../lib/youtube'
import type { PlaybookChapter, PlaybookWithCount } from '../../lib/types'
import PlaybookChapterList from '../PlaybookChapterList'

interface PlaybookPanelProps {
  map: string
  /** Given in the Study layout (§2.12): a new step from the chapter playing. */
  onNewStep?: (title: string, seconds: number) => void
}

const label = 'text-[10px] uppercase tracking-widest text-text-secondary'
const field = 'bg-bg-primary border border-bg-elevated rounded-lg text-sm focus:border-val-cyan outline-none'
const sectionClass = 'p-4 space-y-3 border-b border-bg-elevated'
const transportButton =
  'px-2 py-1 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated/60 transition-colors disabled:opacity-30 disabled:pointer-events-none'

const pickKey = (map: string) => `plays.playbook.${map}`

function readPick(map: string): string | null {
  try {
    return window.localStorage.getItem(pickKey(map))
  } catch {
    // Private mode or blocked storage: the pick lasts for the session only.
    return null
  }
}

function persistPick(map: string, id: string) {
  try {
    window.localStorage.setItem(pickKey(map), id)
  } catch {
    /* ignore — a remembered pick is not worth an error */
  }
}

const optionLabel = (p: PlaybookWithCount) => (p.side ? `${p.name} (${p.side})` : p.name)

/**
 * The chapter whose `[start, end)` holds the time. A half and its sub-chapters
 * overlap, and the sub-chapter (listed after its half) is the more specific
 * answer, so the last hit wins — the same rule as the Playbook reader's jump.
 */
const chapterAt = (chapters: PlaybookChapter[], seconds: number) =>
  chapters.filter(c => seconds >= c.start_seconds && seconds < c.end_seconds).pop() ?? null

function ErrorBox({ message }: { message: string }) {
  return <div className="border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2">{message}</div>
}

function PulseRows() {
  return (
    <div className="space-y-2 animate-pulse" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-10 rounded-md bg-bg-elevated" />
      ))}
    </div>
  )
}

/**
 * The left-hand Playbook panel (docs/plays-editor-v2.md §2.6): one of the
 * signed-in user's vault playbooks for the play's map, its video and its
 * chapters, so a play can be drawn while the guide runs beside it. It owns its
 * own state; the pick is remembered per map. The page remounts it when the map
 * changes, so the hooks start fresh rather than showing the last map's rows.
 *
 * The root carries `data-playbook-panel`: the editor's shortcuts skip any key
 * pressed inside it, so Space on the player's buttons does not also toggle the
 * step playback.
 */
export default function PlaybookPanel({ map, onNewStep }: PlaybookPanelProps) {
  const { playbooks, loading, error } = usePlaybooks({ map })
  const [pickedId, setPickedId] = useState(() => readPick(map))
  const playbook = playbooks.find(p => p.id === pickedId) ?? playbooks[0] ?? null

  const { chapters, loading: chaptersLoading, error: chaptersError } = usePlaybookChapters(playbook?.id)
  const videoId = playbook?.video_url ? extractYouTubeId(playbook.video_url) : null
  const { containerRef, ready, isPlaying, currentTime, duration, embedBlocked, togglePlay, seek, seekTo } =
    useYouTubePlayer(videoId)

  const activeChapter = chapterAt(chapters, currentTime)

  const pick = (id: string) => {
    setPickedId(id)
    persistPick(map, id)
  }

  return (
    <div data-playbook-panel className="w-full">
      <section className={sectionClass}>
        <div className={label}>Playbook</div>
        {loading ? (
          <div className="h-9 rounded-lg bg-bg-elevated animate-pulse" aria-hidden="true" />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !playbook ? (
          <p className="text-sm text-text-muted">
            No playbook for {map} yet. Import one from the vault on the{' '}
            <Link to="/playbook" className="text-val-cyan hover:underline">
              Playbook page
            </Link>
            .
          </p>
        ) : (
          <select
            value={playbook.id}
            onChange={e => pick(e.target.value)}
            aria-label="Playbook"
            className={`${field} w-full px-2 py-1.5`}
          >
            {playbooks.map(p => (
              <option key={p.id} value={p.id}>
                {optionLabel(p)}
              </option>
            ))}
          </select>
        )}
      </section>

      {loading ? (
        <section className={sectionClass}>
          <div className="aspect-video rounded-lg bg-bg-elevated animate-pulse" aria-hidden="true" />
          <PulseRows />
        </section>
      ) : (
        playbook && (
          <>
            <section className={sectionClass}>
              {!videoId ? (
                <p className="text-sm text-text-muted">This playbook has no video.</p>
              ) : embedBlocked ? (
                <a
                  href={playbook.video_url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-val-cyan hover:underline"
                >
                  Watch on YouTube ↗
                </a>
              ) : (
                <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
                  <div ref={containerRef} className="absolute inset-0 w-full h-full" />
                </div>
              )}

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!ready}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  title={isPlaying ? 'Pause' : 'Play'}
                  className={transportButton}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button type="button" onClick={() => seek(-5)} disabled={!ready} title="Back 5 s" className={transportButton}>
                  −5 s
                </button>
                <button type="button" onClick={() => seek(5)} disabled={!ready} title="Forward 5 s" className={transportButton}>
                  +5 s
                </button>
                <span className="font-stats text-[11px] text-text-muted ml-1 whitespace-nowrap">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                {onNewStep && activeChapter && (
                  <button
                    type="button"
                    onClick={() => onNewStep(activeChapter.title, activeChapter.start_seconds)}
                    title={`New step from "${activeChapter.title}"`}
                    className="ml-2 px-2 py-1 rounded-md text-xs font-medium text-val-cyan border border-val-cyan/25 bg-val-cyan/10 hover:bg-val-cyan/20 transition-colors whitespace-nowrap"
                  >
                    New step at this chapter
                  </button>
                )}
                {/* A new tab: the editor has no unsaved-changes guard, so leaving it would drop the play. */}
                <a
                  href={`/playbook/${playbook.slug}?chapter=${activeChapter?.chapter_number ?? 1}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-xs text-val-cyan hover:underline whitespace-nowrap"
                >
                  Open in Playbook ↗
                </a>
              </div>
            </section>

            <section className={sectionClass}>
              {chaptersLoading ? (
                <PulseRows />
              ) : chaptersError ? (
                <ErrorBox message={chaptersError} />
              ) : (
                <PlaybookChapterList
                  chapters={chapters}
                  activeChapterId={activeChapter?.id ?? ''}
                  onChapterSelect={id => {
                    const chapter = chapters.find(c => c.id === id)
                    if (chapter) seekTo(chapter.start_seconds)
                  }}
                  onMomentSelect={(_chapterId, seconds) => seekTo(seconds)}
                  activeSeconds={currentTime}
                  totalSeconds={playbook.video_duration_seconds}
                />
              )}
            </section>
          </>
        )
      )}
    </div>
  )
}
