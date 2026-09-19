/**
 * Shared YouTube IFrame API surface.
 *
 * Extracted from the Sprint 5b VOD workstation so the Pro Study review screen
 * drives the same player. The global `Window.YT` augmentation lives here and
 * only here — declaring it in two modules would collide.
 */

export { extractYouTubeId } from './youtubeId'

declare global {
  interface Window {
    YT: {
      Player: new (
        // The API accepts an id or the element itself; callers that can hold a
        // ref should pass the element and skip the id lookup entirely.
        element: string | HTMLElement,
        config: {
          videoId: string
          playerVars?: Record<string, unknown>
          events?: {
            onReady?: (event: { target: YTPlayer }) => void
            onStateChange?: (event: { data: number; target: YTPlayer }) => void
            onError?: (event: { data: number; target: YTPlayer }) => void
          }
        }
      ) => YTPlayer
      PlayerState: {
        PLAYING: number
        PAUSED: number
        BUFFERING: number
        ENDED: number
        CUED: number
      }
    }
    onYouTubeIframeAPIReady: (() => void) | undefined
  }
}

export interface YTPlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  pauseVideo: () => void
  playVideo: () => void
  destroy: () => void
}

/**
 * Player error codes that mean "this video will never play in our iframe":
 * 101 and 150 are both "embedding disabled by the owner", 100 is a removed or
 * private video. Broadcast channels disable embedding often enough that the
 * Pro Study screen needs a link-out fallback for them.
 */
export const EMBED_BLOCKED_CODES = new Set([100, 101, 150])

/** `m:ss` — the timestamp format used on every note card. */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Loads the IFrame API once, then runs `onReady` (immediately if already loaded).
 * Returns a canceller — call it from an effect cleanup so a torn-down mount
 * stops waiting.
 *
 * `onYouTubeIframeAPIReady` is a one-shot global, which is not enough on its
 * own. Under StrictMode every component mounts twice, and once the script is
 * warm in cache it can finish loading *between* the two mounts: YouTube then
 * fires the callback at the first mount's handler, which has already been torn
 * down, and never fires again — leaving the second, live mount waiting forever
 * on a black box. So we also chain any handler already registered (several
 * players may be waiting) and poll for readiness as the backstop. Whichever
 * path wins, `onReady` runs exactly once.
 */
export function loadYouTubeApi(onReady: () => void): () => void {
  let settled = false
  let stopPolling = () => {}

  const fire = () => {
    if (settled) return
    settled = true
    stopPolling()
    onReady()
  }

  if (window.YT && window.YT.Player) {
    fire()
    return () => {}
  }

  const previous = window.onYouTubeIframeAPIReady
  window.onYouTubeIframeAPIReady = () => {
    previous?.()
    fire()
  }

  if (!document.getElementById('yt-api-script')) {
    const tag = document.createElement('script')
    tag.id = 'yt-api-script'
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  }

  const poll = setInterval(() => {
    if (window.YT && window.YT.Player) fire()
  }, 50)
  stopPolling = () => clearInterval(poll)

  return () => {
    settled = true
    clearInterval(poll)
  }
}
