/**
 * URL helpers for user-entered links that become live `href`s.
 *
 * Rules (kept in the data layer, not the UI, per the Resource Links spec):
 *  - trim whitespace
 *  - prepend `https://` when no scheme is present
 *  - reject anything that isn't http/https (blocks `javascript:` and friends)
 */

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/

// The only host allowed to mount in an iframe (plus its subdomains).
const EMBEDDABLE_HOST = 'valoplant.gg'

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

/**
 * True only for hosts we allow to mount in an iframe.
 *
 * Deliberately stricter than `isSafeUrl()`: a generic link only ever becomes an
 * `href`, while these URLs get embedded into the workstation. The check runs on
 * the parsed `hostname`, so `valoplant.gg.evil.com` and paths or query strings
 * that merely mention the host both fail where a substring test would not.
 */
export function isEmbeddableValoplantUrl(raw: string): boolean {
  if (!isSafeUrl(raw)) return false

  const normalized = normalizeUrl(raw)
  if (!normalized) return false // blank passes isSafeUrl but embeds nothing

  try {
    const host = new URL(normalized).hostname.toLowerCase()
    return host === EMBEDDABLE_HOST || host.endsWith(`.${EMBEDDABLE_HOST}`)
  } catch {
    return false
  }
}
