/**
 * YouTube link → bare 11-char video id.
 *
 * Kept DOM-free and separate from `youtube.ts` so the Notion seed script can
 * import the same parser under Node: the links that arrive from Notion are the
 * messy ones (`youtu.be` shorteners, `?si=` share params, `&v=` not first), and
 * the app and the seeder must agree on what they resolve to.
 */

const PATTERNS = [
  // `v=` may sit anywhere in the query — `?app=desktop&v=ID` is common on mobile shares.
  /youtube\.com\/watch\?[^\s]*?[?&]v=([\w-]{11})/,
  /youtube\.com\/watch\?v=([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /youtube\.com\/embed\/([\w-]{11})/,
  /youtube\.com\/shorts\/([\w-]{11})/,
  /youtube\.com\/live\/([\w-]{11})/,
]

interface ExtractOptions {
  /**
   * Accept a bare id with no surrounding URL. On for the seeder (a Notion cell
   * may hold just the id); off in the app, where the field is labelled "URL"
   * and any 11-character word would otherwise look like a valid video.
   */
  allowBareId?: boolean
}

/** Returns the 11-char id, or null when there is nothing parseable. */
export function extractYouTubeId(raw: string, options: ExtractOptions = {}): string | null {
  if (!raw) return null

  for (const pattern of PATTERNS) {
    const match = raw.match(pattern)
    if (match) return match[1]
  }

  if (options.allowBareId) {
    const bare = raw.trim()
    if (/^[\w-]{11}$/.test(bare)) return bare
  }

  return null
}
