/**
 * URL helpers for user-entered links that become live `href`s.
 *
 * Rules (kept in the data layer, not the UI, per the Resource Links spec):
 *  - trim whitespace
 *  - prepend `https://` when no scheme is present
 *  - reject anything that isn't http/https (blocks `javascript:` and friends)
 */

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/

// `new URL('https://ascent')` parses fine, so a bare word would otherwise
// become a live link to nowhere. Require a dotted hostname (or localhost).
function hasRealHost(hostname: string): boolean {
  if (hostname === 'localhost') return true
  const dot = hostname.indexOf('.')
  return dot > 0 && dot < hostname.length - 1
}

/** Returns a canonical http(s) URL, or null if empty/unsafe/unparseable. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!hasRealHost(parsed.hostname)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/** True when the string is blank (nothing to save) or a valid http(s) URL. */
export function isSafeUrl(raw: string): boolean {
  return raw.trim() === '' || normalizeUrl(raw) !== null
}
