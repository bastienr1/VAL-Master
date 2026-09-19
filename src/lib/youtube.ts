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
        elementId: string,
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

/** Loads the IFrame API once, then runs `onReady` (immediately if already loaded). */
export function loadYouTubeApi(onReady: () => void): void {
  if (window.YT && window.YT.Player) {
    onReady()
    return
  }
  window.onYouTubeIframeAPIReady = onReady
  if (!document.getElementById('yt-api-script')) {
    const tag = document.createElement('script')
    tag.id = 'yt-api-script'
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  }
}
