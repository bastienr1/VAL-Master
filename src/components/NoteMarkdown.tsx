import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TIMESTAMP_HREF_PREFIX } from '../lib/playbookMoments'
import { formatTime } from '../lib/youtube'

interface NoteMarkdownProps {
  children: string
  /**
   * Turns `#t=` links — what `linkifyTimestamps` rewrites a body's timestamps
   * into — into in-page jumps. Omitted by the note panels, whose bodies are typed
   * by hand and carry no ranges; passed by the chapter rail, where every
   * `[MM:SS–MM:SS]` in a guide is a place in the video.
   */
  onJump?: (seconds: number) => void
}

// Renders a saved note's markdown body. rehype-raw is deliberately NOT enabled —
// react-markdown ignores raw HTML by default, which keeps stored notes safe to render.
export default function NoteMarkdown({ children, onJump }: NoteMarkdownProps) {
  return (
    <div className="text-text-primary text-[13px] font-normal leading-relaxed space-y-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <div className="font-heading text-sm font-bold text-text-primary">{children}</div>,
          h2: ({ children }) => <div className="font-heading text-sm font-bold text-text-primary">{children}</div>,
          h3: ({ children }) => <div className="font-heading text-[13px] font-bold text-text-secondary">{children}</div>,
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-bold text-text-primary">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-val-yellow bg-val-yellow/5 pl-2 py-0.5 text-text-secondary">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="font-stats text-[11px] bg-bg-elevated text-val-yellow px-1 py-0.5 rounded">
              {children}
            </code>
          ),
          a: ({ href, children }) => {
            if (onJump && href?.startsWith(TIMESTAMP_HREF_PREFIX)) {
              const seconds = Number(href.slice(TIMESTAMP_HREF_PREFIX.length))
              return (
                <button
                  type="button"
                  onClick={() => onJump(seconds)}
                  className="font-stats text-[11px] text-val-cyan hover:underline"
                  title={`Jump to ${formatTime(seconds)}`}
                >
                  {children}
                </button>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-val-cyan hover:underline">
                {children}
              </a>
            )
          },
          // Vault chapter bodies carry small two-column tables; without these
          // they render as unspaced runs of text in a narrow rail.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="text-left font-medium text-text-secondary border-b border-bg-elevated px-1.5 py-1">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="align-top border-b border-bg-elevated/50 px-1.5 py-1">{children}</td>
          ),
          input: ({ checked }) => (
            <input
              type="checkbox"
              checked={!!checked}
              readOnly
              className="mr-1.5 accent-val-cyan align-middle"
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
