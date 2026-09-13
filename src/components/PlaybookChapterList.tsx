import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Play } from 'lucide-react'
import { formatTimestamp } from '../lib/playbookParser'
import type { PlaybookChapter } from '../lib/types'

interface PlaybookChapterListProps {
  chapters: PlaybookChapter[]
  activeChapterId: string
  onChapterSelect: (chapterId: string) => void
  /** Whole-video length; falls back to the last chapter's end. */
  totalSeconds?: number | null
}

function ChapterMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated/50"
        aria-label="Chapter actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[170px] bg-bg-elevated border border-bg-card rounded-md shadow-xl overflow-hidden">
          <div className="px-3 py-2 text-xs text-text-muted cursor-not-allowed">Share link (Sprint 8)</div>
        </div>
      )}
    </div>
  )
}

export default function PlaybookChapterList({ chapters, activeChapterId, onChapterSelect, totalSeconds }: PlaybookChapterListProps) {
  const total = totalSeconds ?? Math.max(0, ...chapters.map(c => c.end_seconds))

  return (
    <div>
      <div className="flex items-center justify-between pb-2 border-b border-bg-elevated">
        <span className="text-[10px] uppercase tracking-widest text-text-muted">Playbook Chapters</span>
        <span className="font-stats text-xs text-text-muted">{formatTimestamp(total)}</span>
      </div>

      <div>
        {chapters.map(chapter => {
          const active = chapter.id === activeChapterId
          return (
            <div
              key={chapter.id}
              role="button"
              tabIndex={0}
              onClick={() => onChapterSelect(chapter.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onChapterSelect(chapter.id)
                }
              }}
              className={`flex items-center gap-3 py-3 pr-2 border-b border-bg-elevated/40 cursor-pointer transition-colors ${
                active
                  ? 'border-l-4 border-l-val-red bg-val-red/5 pl-2'
                  : 'border-l-4 border-l-transparent pl-2 hover:bg-bg-elevated/30'
              }`}
            >
              <span
                className={`w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-sm ${
                  active ? 'bg-val-red border-val-red text-white' : 'border-bg-elevated text-text-secondary'
                }`}
              >
                {chapter.chapter_number}
              </span>
              <Play className="w-4 h-4 shrink-0 text-val-cyan" />
              <div className="flex-1 min-w-0">
                <div className={`font-medium truncate ${active ? 'text-val-red' : 'text-text-primary'}`}>{chapter.title}</div>
                {(chapter.subtitle || chapter.role_context) && (
                  <div className="text-text-muted text-xs truncate">{chapter.subtitle ?? chapter.role_context}</div>
                )}
              </div>
              <span className="font-stats text-val-cyan text-xs whitespace-nowrap">
                {formatTimestamp(chapter.start_seconds)} - {formatTimestamp(chapter.end_seconds)}
              </span>
              <ChapterMenu />
            </div>
          )
        })}
      </div>
    </div>
  )
}
