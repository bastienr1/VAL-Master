/**
 * How a video follows the replay clock (docs/plays-editor-v2.md §2.12). The
 * replay is the master: the video plays when it plays and is moved when the
 * two drift apart.
 *
 * Pure, no imports, so `node --test` can check it.
 */

/** The speeds both the replay and the YouTube player have. */
const VIDEO_RATES = [0.25, 0.5, 1, 2]

/** The video's rate at this replay speed, or null when YouTube cannot go that fast: the video then waits, paused. */
export function videoRateFor(speed: number): number | null {
  return VIDEO_RATES.includes(speed) ? speed : null
}

/** While the video runs, a small drift is left alone: seeking stutters. */
const RUNNING_DRIFT_S = 0.6
const RUNNING_GAP_MS = 1000
/** While it is still (scrubbing, a jump), it should show the very frame, but not on every input event. */
const STILL_DRIFT_S = 0.15
const STILL_GAP_MS = 120

/** Whether to move the video to the replay's time now. */
export function shouldSeekVideo(driftSeconds: number, running: boolean, msSinceLastSeek: number): boolean {
  const [drift, gap] = running ? [RUNNING_DRIFT_S, RUNNING_GAP_MS] : [STILL_DRIFT_S, STILL_GAP_MS]
  return Math.abs(driftSeconds) > drift && msSinceLastSeek >= gap
}
