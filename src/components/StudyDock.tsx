import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import MapFundamentalsPicker from './MapFundamentalsPicker'
import ProReferencePicker from './ProReferencePicker'
import { usePlaybookChapters } from '../hooks/usePlaybooks'
import { extractYouTubeId, formatTimestamp } from '../lib/playbookParser'
import type { Playbook, PlaybookChapter } from '../lib/types'

/**
 * The study surface inside a VOD review: which playbook covers this map, which
 * chapter of it, and which pro VOD to model.
 *
 * It owns the 6b fundamentals picker rather than the debrief form owning it —
 * a chapter stack, a video and a second picker inside a save-gated form would
 * make that form the junk drawer. Everything here saves on its own or is
 * ephemeral; nothing is gated behind Save Debrief.
 *
 * The video is a plain iframe, deliberately: the match VOD is the page's player
 * and a second IFrame API instance is a conflict waiting to happen. No autoplay,
 * mounted only once expanded.
 */

interface StudyDockProps {
  map: string | null
  agent: string | null
  matchId: string
}

/** Sub-chapter option meaning "keep the parent's whole range". */
const WHOLE_CHAPTER = ''

export default function StudyDock({ map, agent, matchId }: StudyDockProps) {
  const [playbook, setPlaybook] = useState<Playbook | null>(null)
  const [chapterNumber, setChapterNumber] = useState<number | null>(null)
  const [childNumber, setChildNumber] = useState<number | null>(null)
  const [videoOpen, setVideoOpen] = useState(false)

  const { chapters } = usePlaybookChapters(playbook?.id)

  // Changing playbook drops the chapter stack — the numbers mean nothing in
  // another playbook. Identity-checked so an unchanged re-report is a no-op.
  const handlePlaybookChange = useCallback((next: Playbook | null) => {
    setPlaybook(prev => {
      if (prev?.id === next?.id) return prev
      setChapterNumber(null)
      setChildNumber(null)
      setVideoOpen(false)
      return next
    })
  }, [])

  const parents = useMemo(() => chapters.filter(c => c.depth !== 2), [chapters])

  const children = useMemo(
    () =>
      chapterNumber === null
        ? []
        : chapters.filter(c => c.depth === 2 && c.parent_chapter_number === chapterNumber),
    [chapters, chapterNumber],
  )

  const selectedParent = useMemo(
    () => parents.find(c => c.chapter_number === chapterNumber) ?? null,
    [parents, chapterNumber],
  )

  const selectedChild = useMemo(
    () => children.find(c => c.chapter_number === childNumber) ?? null,
    [children, childNumber],
  )

  /** The node the video and the ↗ deep link both follow. */
  const active: PlaybookChapter | null = selectedChild ?? selectedParent

  const videoId = playbook?.video_url ? extractYouTubeId(playbook.video_url) : null

  const handleChapterChange = (value: string) => {
    setChapterNumber(value === '' ? null : Number(value))
    setChildNumber(null)
    setVideoOpen(false)
  }

  if (!map) return null

  return (
    <div className="space-y-3">
      <MapFundamentalsPicker map={map} onPlaybookChange={handlePlaybookChange} />

      {playbook && parents.length > 0 && (
        <div className="space-y-2 pl-2 border-l border-bg-elevated">
          <div>
            <label
              htmlFor={`study-dock-chapter-${playbook.id}`}
              className="text-[10px] text-text-muted uppercase tracking-wider"
            >
              Chapter
            </label>
            <select
              id={`study-dock-chapter-${playbook.id}`}
              value={chapterNumber ?? ''}
              onChange={e => handleChapterChange(e.target.value)}
              className="w-full mt-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-val-cyan/30"
            >
              <option value="">Select a chapter…</option>
              {parents.map(c => (
                <option key={c.id} value={c.chapter_number}>
                  {c.chapter_number}. {c.title} · {formatTimestamp(c.start_seconds)}
                </option>
              ))}
            </select>
          </div>

          {/* Hidden entirely when the chapter has no children — most do not. */}
          {children.length > 0 && (
            <div>
              <label
                htmlFor={`study-dock-subchapter-${playbook.id}`}
                className="text-[10px] text-text-muted uppercase tracking-wider"
              >
                Sub-chapter
              </label>
              <select
                id={`study-dock-subchapter-${playbook.id}`}
                value={childNumber ?? WHOLE_CHAPTER}
                onChange={e => {
                  setChildNumber(e.target.value === WHOLE_CHAPTER ? null : Number(e.target.value))
                  setVideoOpen(false)
                }}
                className="w-full mt-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-val-cyan/30"
              >
                <option value={WHOLE_CHAPTER}>All of chapter</option>
                {children.map((c, i) => (
                  <option key={c.id} value={c.chapter_number}>
                    {chapterNumber}.{i + 1} {c.title} · {formatTimestamp(c.start_seconds)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {active && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                {videoId ? (
                  <button
                    type="button"
                    onClick={() => setVideoOpen(o => !o)}
                    className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-val-cyan transition-colors"
                  >
                    {videoOpen ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    {videoOpen ? 'Hide' : 'Show'} video
                    <span className="font-stats text-val-cyan">
                      ({formatTimestamp(active.start_seconds)}–{formatTimestamp(active.end_seconds)})
                    </span>
                  </button>
                ) : (
                  <span className="text-[11px] text-text-muted">
                    No video linked on this playbook
                  </span>
                )}

                <a
                  href={`/playbook/${playbook.slug}?chapter=${active.chapter_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open this chapter in the playbook reader"
                  className="ml-auto text-text-muted hover:text-val-cyan transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Mounted only once expanded — the match VOD stays the page's
                  primary player and an idle second embed helps nobody. */}
              {videoOpen && videoId && (
                <div
                  className="relative w-full bg-black rounded-lg overflow-hidden"
                  style={{ paddingBottom: '56.25%' }}
                >
                  <iframe
                    key={`${videoId}-${active.chapter_number}`}
                    src={`https://www.youtube.com/embed/${videoId}?start=${active.start_seconds}&end=${active.end_seconds}&rel=0`}
                    title={`${playbook.name} — ${active.title}`}
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full border-0"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ProReferencePicker matchId={matchId} map={map} agent={agent} />
    </div>
  )
}
