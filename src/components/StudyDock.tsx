import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import MapFundamentalsPicker from './MapFundamentalsPicker'
import ProReferencePicker from './ProReferencePicker'
import { usePlaybookChapters } from '../hooks/usePlaybooks'
import { extractYouTubeId, formatTimestamp } from '../lib/playbookParser'
import { extractMoments } from '../lib/playbookMoments'
import type { Playbook } from '../lib/types'

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

/** Sub-chapter option meaning "keep the chapter's whole range". */
const WHOLE_CHAPTER = ''

export default function StudyDock({ map, agent, matchId }: StudyDockProps) {
  const [playbook, setPlaybook] = useState<Playbook | null>(null)
  const [chapterNumber, setChapterNumber] = useState<number | null>(null)
  /** Index into the selected chapter's moments; null means the whole chapter. */
  const [momentIndex, setMomentIndex] = useState<number | null>(null)
  const [videoOpen, setVideoOpen] = useState(false)

  const { chapters } = usePlaybookChapters(playbook?.id)

  // Changing playbook drops the chapter stack — the numbers mean nothing in
  // another playbook. Identity-checked so an unchanged re-report is a no-op.
  const handlePlaybookChange = useCallback((next: Playbook | null) => {
    setPlaybook(prev => {
      if (prev?.id === next?.id) return prev
      setChapterNumber(null)
      setMomentIndex(null)
      setVideoOpen(false)
      return next
    })
  }, [])

  const chapter = useMemo(
    () => chapters.find(c => c.chapter_number === chapterNumber) ?? null,
    [chapters, chapterNumber],
  )

  /**
   * Sub-chapters are the chapter's **moments** — the labelled timestamps inside
   * its body that the playbook reader already lists under the open chapter.
   *
   * Derived at render time from `transcript_excerpt`, so every chapter has them
   * with no migration, and they describe the tape itself rather than how the
   * note's section headings happened to be typed.
   */
  const moments = useMemo(
    () => (chapter ? extractMoments(chapter.transcript_excerpt, chapter) : []),
    [chapter],
  )

  const moment = momentIndex === null ? null : moments[momentIndex] ?? null

  /** What the video scopes to. A moment with no end runs to the chapter's. */
  const range = moment
    ? { start: moment.start_seconds, end: moment.end_seconds ?? chapter?.end_seconds ?? null }
    : chapter
      ? { start: chapter.start_seconds, end: chapter.end_seconds }
      : null

  const videoId = playbook?.video_url ? extractYouTubeId(playbook.video_url) : null

  // The video deliberately stays open across chapter and sub-chapter changes:
  // it re-mounts at the new range on its own, and closing it every time would
  // mean re-opening it at each step of exactly the loop this dock exists for.
  // Only a playbook change collapses it, since that is a different video.
  const handleChapterChange = (value: string) => {
    setChapterNumber(value === '' ? null : Number(value))
    setMomentIndex(null)
  }

  if (!map) return null

  return (
    <div className="space-y-3">
      <MapFundamentalsPicker map={map} onPlaybookChange={handlePlaybookChange} />

      {playbook && chapters.length > 0 && (
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
              {chapters.map(c => (
                <option key={c.id} value={c.chapter_number}>
                  {c.chapter_number}. {c.title} · {formatTimestamp(c.start_seconds)}
                </option>
              ))}
            </select>
          </div>

          {/* Hidden when the chapter's body has no labelled timestamps. */}
          {moments.length > 0 && (
            <div>
              <label
                htmlFor={`study-dock-moment-${playbook.id}`}
                className="text-[10px] text-text-muted uppercase tracking-wider"
              >
                Moment
              </label>
              <select
                id={`study-dock-moment-${playbook.id}`}
                value={momentIndex ?? WHOLE_CHAPTER}
                onChange={e =>
                  setMomentIndex(e.target.value === WHOLE_CHAPTER ? null : Number(e.target.value))
                }
                className="w-full mt-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-val-cyan/30"
              >
                <option value={WHOLE_CHAPTER}>All of chapter</option>
                {moments.map((m, i) => (
                  <option key={`${m.start_seconds}-${m.label}`} value={i}>
                    {chapterNumber}.{i + 1} {m.label} · {formatTimestamp(m.start_seconds)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {range && (
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
                      ({formatTimestamp(range.start)}
                      {range.end != null ? `–${formatTimestamp(range.end)}` : ''})
                    </span>
                  </button>
                ) : (
                  <span className="text-[11px] text-text-muted">
                    No video linked on this playbook
                  </span>
                )}

                {/* The reader takes ?chapter and ?t, so a picked moment
                    deep-links to the same second it plays from here. */}
                <a
                  href={`/playbook/${playbook.slug}?chapter=${chapterNumber}${
                    moment ? `&t=${moment.start_seconds}` : ''
                  }`}
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
                    key={`${videoId}-${range.start}-${range.end ?? ''}`}
                    src={`https://www.youtube.com/embed/${videoId}?start=${range.start}${
                      range.end != null ? `&end=${range.end}` : ''
                    }&rel=0`}
                    title={`${playbook.name} — ${moment?.label ?? chapter?.title ?? 'chapter'}`}
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
