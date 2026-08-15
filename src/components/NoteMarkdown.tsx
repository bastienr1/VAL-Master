import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Renders a saved note's markdown body. rehype-raw is deliberately NOT enabled —
// react-markdown ignores raw HTML by default, which keeps stored notes safe to render.
export default function NoteMarkdown({ children }: { children: string }) {
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
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-val-cyan hover:underline">
              {children}
            </a>
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
