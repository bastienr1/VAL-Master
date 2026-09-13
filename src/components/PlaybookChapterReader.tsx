import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { VideoOff } from 'lucide-react'
import { extractYouTubeId, formatTimestamp } from '../lib/playbookParser'
import type { Playbook, PlaybookChapter } from '../lib/types'

interface PlaybookChapterReaderProps {
  chapter: PlaybookChapter
  playbook: Playbook
  /** Start playing on load — true once the user has picked a chapter. */
  autoplay?: boolean
}

type Tab = 'notes' | 'takeaways' | 'timeline' | 'clips'

const TABS: { id: Tab; label: string }[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'takeaways', label: 'Key Takeaways' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'clips', label: 'Related Clips' },
]

// Vault notes lean on tables and callout-style blockquotes. Raw HTML stays
// disabled (react-markdown's default), same as NoteMarkdown.
const markdownComponents: Components = {
  h1: ({ children }) => <h3 className="font-heading text-lg font-bold text-text-primary mt-4">{children}</h3>,
  h2: ({ children }) => <h3 className="font-heading text-lg font-bold text-text-primary mt-4">{children}</h3>,
  h3: ({ children }) => <h4 className="font-heading text-base font-bold text-text-primary mt-3">{children}</h4>,
  h4: ({ children }) => <h5 className="font-heading text-[15px] font-bold text-text-secondary mt-3">{children}</h5>,
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
  strong: ({ children }) => <strong className="font-bold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-val-yellow bg-val-yellow/5 pl-3 py-1 text-text-secondary">{children}</blockquote>
  ),
  code: ({ children }) => <code className="font-stats text-[12px] bg-bg-elevated text-val-yellow px-1 py-0.5 rounded">{children}</code>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-val-cyan hover:underline">
      {children}
    </a>
  ),
  hr: () => <hr className="border-bg-elevated" />,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="text-left font-medium text-text-secondary border-b border-bg-elevated px-2 py-1.5">{children}</th>,
  td: ({ children }) => <td className="align-top border-b border-bg-elevated/50 px-2 py-1.5">{children}</td>,
}

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  )
}

export default function PlaybookChapterReader({ chapter, playbook, autoplay = false }: PlaybookChapterReaderProps) {
  const [tab, setTab] = useState<Tab>('notes')
  const videoId = playbook.video_url ? extractYouTubeId(playbook.video_url) : null
  const takeaways = chapter.key_takeaways ?? []

  const embedSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?start=${chapter.start_seconds}&end=${chapter.end_seconds}&rel=0${autoplay ? '&autoplay=1' : ''}`
    : null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-val-red text-white text-sm flex items-center justify-center">
            {chapter.chapter_number}
          </span>
          <h2 className="font-heading text-lg leading-tight text-text-primary">{chapter.title}</h2>
        </div>
        <span className="font-stats text-val-cyan text-xs whitespace-nowrap mt-1">
          {formatTimestamp(chapter.start_seconds)} - {formatTimestamp(chapter.end_seconds)}
        </span>
      </div>

      <div className="aspect-video rounded-lg overflow-hidden border border-bg-elevated bg-gradient-to-b from-bg-elevated to-bg-primary">
        {embedSrc ? (
          <iframe
            key={chapter.id}
            src={embedSrc}
            title={`${playbook.title} — ${chapter.title}`}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <VideoOff className="w-8 h-8 text-text-muted" />
            <p className="text-sm text-text-secondary">No video linked</p>
            <p className="text-xs text-text-muted">
              Add <code className="font-stats text-val-yellow">video_url:</code> to the note's frontmatter and re-import.
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-5 border-b border-bg-elevated">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`pb-2 -mb-px text-sm transition-colors ${
              tab === t.id ? 'border-b-2 border-val-red text-val-red' : 'border-b-2 border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.label}
            {t.id === 'takeaways' && takeaways.length > 0 && (
              <span className="ml-1.5 font-stats text-[10px] text-text-muted">{takeaways.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-[200px]">
        {tab === 'notes' &&
          (chapter.notes_markdown ? (
            <div className="text-text-primary text-[15px] font-normal leading-relaxed space-y-3">
              <Markdown>{chapter.notes_markdown}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No notes for this chapter.</p>
          ))}

        {tab === 'takeaways' &&
          (takeaways.length > 0 ? (
            <ul className="space-y-3">
              {takeaways.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-text-primary text-[14px] leading-relaxed">
                  <span className="mt-2 w-1.5 h-1.5 shrink-0 rounded-full bg-val-cyan" />
                  <div className="space-y-1">
                    <Markdown>{t}</Markdown>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">
              No takeaways for this chapter. Callouts like <code className="font-stats text-val-yellow">&gt; [!tip]</code> in the note become takeaways.
            </p>
          ))}

        {tab === 'timeline' &&
          (chapter.transcript_excerpt ? (
            <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap text-text-secondary text-sm leading-relaxed pr-2">
              {chapter.transcript_excerpt}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No transcript for this chapter.</p>
          ))}

        {tab === 'clips' && (
          <div className="py-10 text-center text-sm text-text-muted">
            Coming in Sprint 7 — chapter cross-references will appear here
          </div>
        )}
      </div>
    </div>
  )
}
