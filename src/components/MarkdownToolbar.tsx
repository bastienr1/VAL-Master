import { Bold, Italic, Heading2, List, ListOrdered, ListChecks, Quote, Code } from 'lucide-react'
import { applyAction, type MarkdownAction } from '../lib/markdown'

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onChange: (next: string) => void
}

const BUTTONS: Array<{
  icon: React.ElementType
  title: string
  action: MarkdownAction
}> = [
  { icon: Bold, title: 'Bold (Ctrl+B)', action: { kind: 'wrap', token: '**' } },
  { icon: Italic, title: 'Italic (Ctrl+I)', action: { kind: 'wrap', token: '*' } },
  { icon: Heading2, title: 'Header', action: { kind: 'prefix', prefix: '## ' } },
  { icon: List, title: 'Bullet list', action: { kind: 'prefix', prefix: '- ' } },
  { icon: ListOrdered, title: 'Numbered list', action: { kind: 'prefix', prefix: '1. ' } },
  { icon: ListChecks, title: 'Checkbox', action: { kind: 'prefix', prefix: '- [ ] ' } },
  { icon: Quote, title: 'Callout', action: { kind: 'prefix', prefix: '> ' } },
  { icon: Code, title: 'Inline code', action: { kind: 'wrap', token: '`' } },
]

export default function MarkdownToolbar({ textareaRef, onChange }: MarkdownToolbarProps) {
  const run = (action: MarkdownAction) => {
    const el = textareaRef.current
    if (!el) return
    onChange(applyAction(el, action))
  }

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {BUTTONS.map(({ icon: Icon, title, action }) => (
        <button
          key={title}
          type="button"
          title={title}
          // Keep the textarea selection alive — mousedown would blur it first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(action)}
          className="p-1 rounded text-text-muted hover:text-val-cyan hover:bg-bg-elevated transition-colors"
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  )
}
