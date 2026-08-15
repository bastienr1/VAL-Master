// Toolbar helpers for the note textarea. Each returns the next textarea value;
// the caller feeds it into setState. Selection is restored after React repaints.

export type MarkdownAction =
  | { kind: 'wrap'; token: string }
  | { kind: 'prefix'; prefix: string }

export function applyAction(el: HTMLTextAreaElement, action: MarkdownAction): string {
  return action.kind === 'wrap'
    ? wrapSelection(el, action.token)
    : toggleLinePrefix(el, action.prefix)
}

/** Wrap the current selection with a token on both sides (e.g. "**"). */
export function wrapSelection(el: HTMLTextAreaElement, token: string): string {
  const { selectionStart: s, selectionEnd: e, value } = el
  const selected = value.slice(s, e)
  const body = selected || 'text'
  const next = value.slice(0, s) + token + body + token + value.slice(e)
  queueMicrotask(() => {
    el.focus()
    el.setSelectionRange(s + token.length, s + token.length + body.length)
  })
  return next
}

/** Add — or remove, if every line already has it — a line-start prefix across the selection. */
export function toggleLinePrefix(el: HTMLTextAreaElement, prefix: string): string {
  const { selectionStart: s, selectionEnd: e, value } = el
  const lineStart = value.lastIndexOf('\n', s - 1) + 1
  const lineEndIdx = value.indexOf('\n', e)
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx

  const lines = value.slice(lineStart, lineEnd).split('\n')
  const allHave = lines.every(l => l.startsWith(prefix))
  const out = lines
    .map(l => (allHave ? l.slice(prefix.length) : prefix + l))
    .join('\n')

  const next = value.slice(0, lineStart) + out + value.slice(lineEnd)
  const delta = out.length - (lineEnd - lineStart)
  queueMicrotask(() => {
    el.focus()
    el.setSelectionRange(Math.max(lineStart, s + (allHave ? -prefix.length : prefix.length)), e + delta)
  })
  return next
}
