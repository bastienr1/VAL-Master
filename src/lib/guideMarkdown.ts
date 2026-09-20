/**
 * Obsidian markdown → markdown `react-markdown` can render.
 *
 * Chapter bodies come straight out of the vault, so they carry two things no
 * plain renderer knows: wikilinks, which would show as literal `[[…]]`, and
 * callouts, whose `> [!warning] Title` first line would render as part of the
 * quote text. Neither can resolve to anything inside the app — there is no vault
 * route to link to — so both are reduced to plain markdown rather than styled.
 */

/** `![[image.png]]` — an embed with nothing to embed once it leaves the vault. */
const EMBED = /!\[\[[^\]]+\]\]/g
/** `[[Note|Alias]]` or `[[Note]]` — keep the text a reader would have seen. */
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
/** `> [!warning]- Title` — the type marker, an optional fold marker, a title. */
const CALLOUT = /^(\s*>+)\s*\[!(\w+)\][+-]?\s*(.*)$/

/**
 * Rewrites one chapter body for rendering.
 *
 * Callout titles become bold so the emphasis of the original survives; a callout
 * with no title keeps its blockquote and loses only the marker, which reads
 * better than promoting `[!note]` to a heading nobody wrote.
 */
export function guideMarkdown(source: string): string {
  return source
    .split('\n')
    .map(line => {
      const callout = line.match(CALLOUT)
      if (callout) {
        const [, quote, type, title] = callout
        const label = title.trim() || capitalise(type)
        return `${quote} **${label}**`
      }
      return line
    })
    .join('\n')
    .replace(EMBED, '')
    .replace(WIKILINK, (_match, target: string, alias?: string) => (alias ?? target).trim())
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}
