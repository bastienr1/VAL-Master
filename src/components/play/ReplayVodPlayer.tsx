import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Volume2, VolumeX } from 'lucide-react'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer'
import { isDeathmatchBundle, type ReplayBundle } from '../../lib/replayBundle'
import { barrierOffsetAt, replayMsToVideoSeconds } from '../../lib/replaySync'
import { getReplayVod, linkReplayVod, setReplayVodOffset, type ReplayVod } from '../../lib/replayVod'
import type { ValueStore } from '../../lib/valueStore'
import { shouldSeekVideo, videoRateFor } from '../../lib/vodFollow'

interface ReplayVodPlayerProps {
  matchId: string
  bundle: ReplayBundle
  /** Where the replay is. */
  clock: Pick<ValueStore<{ ms: number } | null>, 'get' | 'subscribe'>
  playing: boolean
  speed: number
  onTogglePlay(): void
  /** The replay to a moment, paused: where the sync help sends it. */
  onSeek?(ms: number): void
}

/** Linking and syncing from this panel (§2.20): a Deathmatch has no review page to do it on. */
interface SyncControls {
  /** Keeps the sync; null unsyncs. Throws when it could not be saved. */
  onOffset(offset: number | null): Promise<void>
  onChangeVideo(): void
  /** The player's first kill, a moment easy to find in the video. */
  firstKillMs: number | null
  onSeek?(ms: number): void
}

const MUTED_KEY = 'plays.vodMuted'

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) !== 'false'
  } catch {
    return true
  }
}

const note = 'text-[11px] text-text-secondary'
const action =
  'px-2 py-1 rounded-md text-xs font-medium text-val-cyan border border-val-cyan/25 bg-val-cyan/10 hover:bg-val-cyan/20 transition-colors whitespace-nowrap disabled:opacity-40'
const quiet = 'px-2 py-1 rounded-md text-xs text-text-muted hover:text-text-secondary transition-colors whitespace-nowrap disabled:opacity-40'
/** One press of an earlier / later button, in seconds. */
const NUDGE_S = 0.5
const hundredth = (seconds: number) => Math.round(seconds * 100) / 100

function SyncedVideo({
  vod,
  bundle,
  clock,
  playing,
  speed,
  onTogglePlay,
  sync,
}: Omit<ReplayVodPlayerProps, 'matchId' | 'onSeek'> & { vod: ReplayVod; sync?: SyncControls }) {
  const offset = vod.barrierOffset
  const following = offset !== null
  const { containerRef, ready, isPlaying, embedBlocked, seekTo, pause, play, setRate, setMuted, getCurrentTime } = useYouTubePlayer(vod.videoId, {
    controls: !following,
  })
  // Off by default: a muted video may start from code, and the map is what is being read.
  const [muted, setMutedState] = useState(readMuted)
  useEffect(() => {
    if (ready) setMuted(muted)
  }, [ready, muted, setMuted])
  const toggleMuted = () => {
    setMutedState(m => {
      try {
        localStorage.setItem(MUTED_KEY, String(!m))
      } catch {
        /* a preference only */
      }
      return !m
    })
  }

  const rate = videoRateFor(speed)
  const running = following && playing && rate !== null

  // The video plays when the replay plays. A seek on a video not started yet makes YouTube start it: stopped here too.
  useEffect(() => {
    if (!ready || !following) return
    if (running && rate !== null) {
      setRate(rate)
      play()
    } else if (isPlaying) {
      pause()
    }
  }, [ready, following, running, rate, isPlaying, play, pause, setRate])

  // And goes where the replay goes.
  const latest = useRef({ getCurrentTime, seekTo, running })
  useEffect(() => {
    latest.current = { getCurrentTime, seekTo, running }
  })
  const lastSeek = useRef(0)
  useEffect(() => {
    if (!ready || offset === null) return
    const follow = () => {
      const shown = clock.get()
      if (!shown) return
      const target = Math.max(0, replayMsToVideoSeconds(bundle, offset, shown.ms))
      const now = performance.now()
      if (shouldSeekVideo(latest.current.getCurrentTime() - target, latest.current.running, now - lastSeek.current)) {
        lastSeek.current = now
        latest.current.seekTo(target)
      }
    }
    follow()
    return clock.subscribe(follow)
  }, [ready, offset, bundle, clock, running])

  const [saving, setSaving] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const keep = async (next: number | null) => {
    if (!sync) return
    setSaving(true)
    setSyncError(null)
    try {
      await sync.onOffset(next)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'The sync was not saved.')
    } finally {
      setSaving(false)
    }
  }
  /** The video, where it is paused, shows the moment the replay is on. */
  const syncHere = () => {
    const shown = clock.get()
    if (shown) void keep(barrierOffsetAt(bundle, shown.ms, getCurrentTime()))
  }

  if (embedBlocked) {
    return (
      <a href={`https://www.youtube.com/watch?v=${vod.videoId}`} target="_blank" rel="noopener noreferrer" className="block text-sm text-val-cyan hover:underline">
        Watch on YouTube ↗
      </a>
    )
  }

  return (
    <>
      <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
        <div ref={containerRef} className="absolute inset-0 w-full h-full" />
        {following && (
          <>
            {/* The replay's transport drives the video; a click here is its play button. */}
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={playing ? 'Pause the replay' : 'Play the replay'}
              className="absolute inset-0 w-full h-full cursor-pointer"
            />
            <button
              type="button"
              onClick={toggleMuted}
              aria-pressed={!muted}
              aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
              title={muted ? 'Sound off' : 'Sound on'}
              className="absolute right-1.5 bottom-1.5 p-1.5 rounded-md bg-bg-primary/80 text-text-secondary hover:text-val-cyan transition-colors"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </>
        )}
      </div>
      {sync && offset === null && (
        <div role="status" className="rounded-md border border-val-yellow/30 bg-val-yellow/10 px-2 py-1.5 space-y-1.5">
          <p className="text-xs font-medium text-val-yellow">Not synced: jumps and the replay do not move this video yet.</p>
          <ol className={`${note} list-decimal pl-4 space-y-0.5`}>
            <li>{sync.firstKillMs !== null && sync.onSeek ? 'Press Replay to my first kill.' : 'Put the replay on a moment you can find in the video.'}</li>
            <li>Pause the video on that same moment.</li>
            <li>Press Sync here.</li>
          </ol>
          <div className="flex flex-wrap gap-1.5">
            {sync.firstKillMs !== null && sync.onSeek && (
              <button type="button" className={quiet} onClick={() => sync.onSeek?.(sync.firstKillMs as number)} title="Puts the replay on your first kill, paused">
                Replay to my first kill
              </button>
            )}
            <button type="button" className={action} disabled={!ready || saving} onClick={syncHere}>
              Sync here
            </button>
            <button type="button" className={quiet} disabled={saving} onClick={sync.onChangeVideo}>
              Change video
            </button>
          </div>
        </div>
      )}
      {sync && offset !== null && (
        <div className="px-1 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={quiet}
            disabled={saving}
            onClick={() => void keep(hundredth(offset - NUDGE_S))}
            title="The video is ahead of the map: show it half a second earlier"
          >
            Video −{NUDGE_S} s
          </button>
          <button
            type="button"
            className={quiet}
            disabled={saving}
            onClick={() => void keep(hundredth(offset + NUDGE_S))}
            title="The video is behind the map: show it half a second later"
          >
            Video +{NUDGE_S} s
          </button>
          <button type="button" className={quiet} disabled={saving} onClick={() => void keep(null)} title="Frees the video so you can line it up again">
            Sync again
          </button>
          <button type="button" className={quiet} disabled={saving} onClick={sync.onChangeVideo}>
            Change video
          </button>
        </div>
      )}
      {syncError && <p className="px-1 text-[11px] text-val-red">{syncError}</p>}
    </>
  )
}

/** A YouTube link for the match, kept on its review row (§2.20). */
function LinkVideo({ matchId, onLinked, onCancel }: { matchId: string; onLinked(vod: ReplayVod): void; onCancel?(): void }) {
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onLinked(await linkReplayVod(matchId, url))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The video was not linked.')
      setSaving(false)
    }
  }
  return (
    <form onSubmit={submit} className="px-3 pt-3 space-y-1.5">
      <label htmlFor="replay-vod-link" className={`block ${note}`}>
        Link this match&apos;s video: paste its YouTube link.
      </label>
      <div className="flex gap-1.5">
        <input
          id="replay-vod-link"
          type="url"
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder="https://youtu.be/…"
          className="min-w-0 flex-1 bg-bg-primary border border-bg-elevated rounded-md text-xs px-2 py-1 focus:border-val-cyan outline-none"
        />
        <button type="submit" className={action} disabled={saving || url.trim() === ''}>
          Link video
        </button>
        {onCancel && (
          <button type="button" className={quiet} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-val-red">{error}</p>}
    </form>
  )
}

/**
 * The match's VOD at the top of the Rounds panel (§2.12), following the replay
 * once synced: on the review page for a competitive match, here for a
 * Deathmatch (§2.20), which is also linked here.
 */
export default function ReplayVodPlayer({ matchId, onSeek, ...props }: ReplayVodPlayerProps) {
  const [loaded, setLoaded] = useState<{ matchId: string; vod: ReplayVod | null } | null>(null)
  /** The match whose link is being replaced. */
  const [changing, setChanging] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getReplayVod(matchId)
      .catch(() => null)
      .then(vod => {
        if (!cancelled) setLoaded({ matchId, vod })
      })
    return () => {
      cancelled = true
    }
  }, [matchId])

  const reviewLink = (
    // A new tab: the editor has no unsaved-changes guard, so leaving it would drop the play.
    <Link to={`/review/${matchId}`} target="_blank" rel="noopener noreferrer" className="text-val-cyan hover:underline">
      review page ↗
    </Link>
  )

  if (!loaded || loaded.matchId !== matchId) {
    return (
      <div className="px-2 pt-2">
        <div className="aspect-video rounded-lg bg-bg-elevated animate-pulse" aria-hidden="true" />
      </div>
    )
  }

  const linkable = isDeathmatchBundle(props.bundle)
  const vod = loaded.vod
  if (linkable && (!vod || changing === matchId)) {
    return (
      <LinkVideo
        matchId={matchId}
        onLinked={linked => {
          setLoaded({ matchId, vod: linked })
          setChanging(null)
        }}
        onCancel={vod ? () => setChanging(null) : undefined}
      />
    )
  }
  if (!vod) {
    return <p className={`px-3 pt-3 ${note}`}>No VOD on this match yet. Add one on its {reviewLink}.</p>
  }

  const me = props.bundle.players.find(p => p.isMe)?.subject
  const sync: SyncControls | undefined = linkable
    ? {
        onOffset: async offset => {
          await setReplayVodOffset(matchId, offset)
          setLoaded({ matchId, vod: { ...vod, barrierOffset: offset } })
        },
        onChangeVideo: () => setChanging(matchId),
        firstKillMs: props.bundle.kills.find(k => k.killer === me && k.victim !== me)?.t ?? null,
        onSeek,
      }
    : undefined
  return (
    <div className="px-2 pt-2 space-y-1">
      {/* Remounted when the sync is set or dropped: the player's own controls are fixed when it is made, and a player being remade is not ready for the follow's seeks. */}
      <SyncedVideo key={`${vod.videoId}:${vod.barrierOffset === null ? 'free' : 'following'}`} vod={vod} {...props} sync={sync} />
      {!linkable && vod.barrierOffset === null && <p className={`px-1 ${note}`}>Not synced yet: mark the barrier drop on the {reviewLink} and the video will follow the replay.</p>}
      {vod.barrierOffset !== null && videoRateFor(props.speed) === null && <p className={`px-1 ${note}`}>The video waits above 2× and catches up when you pause.</p>}
    </div>
  )
}
