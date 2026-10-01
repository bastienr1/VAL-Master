import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { agentIconUrl, loadGameContent, type GameMap } from '../lib/gameContent'
import type { ReplayBundle, ReplayKill, ReplayPlayer } from '../lib/replayBundle'
import {
  deathTimesBySubject,
  isAliveAt,
  isPresentAt,
  ownSideFlips,
  pawnStateAt,
  playedViewport,
  playerStateAt,
  sampleIndex,
  worldToImage,
  type MapTransform,
  type Viewport,
} from '../lib/replayScene'
import {
  replayAnchorMs,
  replayMsToVideoSeconds,
  roundAtReplayMs,
  videoSecondsToReplayMs,
  weaponLabel,
} from '../lib/replaySync'

interface ReplayMinimapProps {
  bundle: ReplayBundle
  /** Video seconds at the R1 barrier drop; null until the match is synced. */
  barrierOffset: number | null
  /** The player's current time. Read every frame, so it must not depend on render state. */
  getVideoTime: () => number
  getPlaybackRate: () => number
  isPlaying: boolean
  onSeek: (videoSeconds: number) => void
  /** Moves the sync anchor by a fraction of a second. Rejects with a message to show. */
  onNudge: (deltaSeconds: number) => Promise<void>
}

const TEAM_COLOR = { ALLY: '#53CADC', ENEMY: '#FF4655' } as const
const SPIKE_COLOR = '#FFCA3A'
const BACKDROP = '#0A0E17'

// The replay gives a utility's position and lifetime, not its size. These radii
// (world cm) are stand-ins so a smoke reads as a smoke; they are not measured.
const EFFECT_STYLE: Record<string, { radius: number; fill: string }> = {
  smoke: { radius: 380, fill: 'rgba(203,213,225,0.34)' },
  wall: { radius: 90, fill: 'rgba(125,211,252,0.55)' },
  trap: { radius: 70, fill: 'rgba(255,202,58,0.6)' },
  slow: { radius: 260, fill: 'rgba(96,165,250,0.25)' },
  damage_zone: { radius: 300, fill: 'rgba(249,115,22,0.3)' },
  recon: { radius: 80, fill: 'rgba(192,132,252,0.6)' },
}

const LAYERS = [
  { key: 'cones', label: 'View', title: 'Where each player is looking' },
  { key: 'utility', label: 'Utility', title: 'Smokes, walls, traps and other placed abilities' },
  { key: 'pawns', label: 'Pawns', title: 'Cameras, drones and other things agents control' },
  { key: 'trails', label: 'Trails', title: 'The last 3 seconds of each player’s path' },
  { key: 'flip', label: 'My side', title: 'Turn the map when sides change, so your team always starts from the bottom' },
] as const
type LayerKey = (typeof LAYERS)[number]['key']
type Layers = Record<LayerKey, boolean>

const LAYERS_KEY = 'vodReview.mapLayers'
const DEFAULT_LAYERS: Layers = { cones: true, utility: true, pawns: true, trails: false, flip: true }

function readLayers(): Layers {
  try {
    return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_LAYERS
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

interface Scene {
  transform: MapTransform
  view: Viewport
  mapImage: HTMLImageElement | null
  icons: Map<string, HTMLImageElement>
  deaths: Map<string, number[]>
  bySubject: Map<string, ReplayPlayer>
  /** Round number → whether the map is turned half a turn that round. */
  flips: Map<number, boolean>
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  size: number,
  bundle: ReplayBundle,
  scene: Scene,
  layers: Layers,
  t: number,
) {
  const { transform, view } = scene
  const round = roundAtReplayMs(bundle, t)
  // Half a turn about the centre of the view: positions are mirrored through
  // it, so icons and letters stay upright while the map itself turns.
  const flipped = layers.flip && scene.flips.get(round.n) === true
  const scale = size / view.size
  const toPx = (x: number, y: number): [number, number] => {
    const [u, v] = worldToImage(transform, x, y)
    const px = (u - view.u) * scale
    const py = (v - view.v) * scale
    return flipped ? [size - px, size - py] : [px, py]
  }
  const cmToPx = (cm: number) => Math.abs(cm * transform.xMultiplier) * scale
  const unit = size / 420 // marker sizes are tuned for a 420 px map

  ctx.fillStyle = BACKDROP
  ctx.fillRect(0, 0, size, size)
  const img = scene.mapImage
  if (img) {
    ctx.save()
    if (flipped) {
      ctx.translate(size, size)
      ctx.rotate(Math.PI)
    }
    ctx.globalAlpha = 0.9
    ctx.drawImage(
      img,
      view.u * img.naturalWidth, view.v * img.naturalHeight,
      view.size * img.naturalWidth, view.size * img.naturalHeight,
      0, 0, size, size,
    )
    ctx.restore()
  }

  if (layers.utility) {
    for (const effect of bundle.effects) {
      if (effect.start > t) break
      const style = EFFECT_STYLE[effect.kind]
      // An effect that never closed lasts until the next round's buy phase.
      const end = effect.end ?? (bundle.rounds[round.n]?.buyStartMs ?? Infinity)
      if (!style || end < t) continue
      const [px, py] = toPx(effect.x, effect.y)
      ctx.beginPath()
      ctx.arc(px, py, Math.max(2 * unit, cmToPx(style.radius)), 0, Math.PI * 2)
      ctx.fillStyle = style.fill
      ctx.fill()
      const owner = effect.owner ? scene.bySubject.get(effect.owner) : undefined
      if (owner) {
        ctx.strokeStyle = TEAM_COLOR[owner.team]
        ctx.globalAlpha = 0.5
        ctx.lineWidth = 1.2 * unit
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  }

  for (const plant of bundle.spike.plants) {
    if (plant.round !== round.n || plant.t > t || plant.x == null || plant.y == null) continue
    const defused = bundle.spike.defuses.some(d => d.round === round.n && d.t <= t)
    const [px, py] = toPx(plant.x, plant.y)
    const r = 8 * unit
    ctx.fillStyle = defused ? '#64748B' : SPIKE_COLOR
    ctx.beginPath()
    ctx.moveTo(px, py - r)
    ctx.lineTo(px + r * 0.85, py + r * 0.6)
    ctx.lineTo(px - r * 0.85, py + r * 0.6)
    ctx.closePath()
    ctx.fill()
    if (plant.site) {
      ctx.fillStyle = BACKDROP
      ctx.font = `bold ${7.5 * unit}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(plant.site, px, py + r * 0.12)
    }
  }

  if (layers.pawns) {
    for (const pawn of bundle.pawns.items) {
      if (pawn.from > t) break
      if (pawn.to < t) continue
      const state = pawnStateAt(pawn.samples, t)
      if (!state) continue
      const owner = pawn.owner ? scene.bySubject.get(pawn.owner) : undefined
      const [px, py] = toPx(state.x, state.y)
      const half = 3 * unit
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(Math.PI / 4)
      ctx.fillStyle = owner ? TEAM_COLOR[owner.team] : '#94A3B8'
      ctx.globalAlpha = 0.85
      ctx.fillRect(-half, -half, half * 2, half * 2)
      ctx.restore()
    }
  }

  const carrier = bundle.spike.carriers.find(c => c.from <= t && c.to > t)?.player
  const radius = 9.5 * unit

  for (const player of bundle.players) {
    const rows = bundle.tracks.byPlayer[player.subject]
    const state = playerStateAt(rows, t)
    // A player who disconnected is not on the map at all, rather than frozen where they stood.
    if (!state || !isPresentAt(state, t, round.buyStartMs)) continue
    const [px, py] = toPx(state.x, state.y)
    const color = TEAM_COLOR[player.team]

    if (!isAliveAt(state, scene.deaths.get(player.subject), t)) {
      const arm = 4.5 * unit
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 2 * unit
      ctx.beginPath()
      ctx.moveTo(px - arm, py - arm)
      ctx.lineTo(px + arm, py + arm)
      ctx.moveTo(px + arm, py - arm)
      ctx.lineTo(px - arm, py + arm)
      ctx.stroke()
      ctx.globalAlpha = 1
      continue
    }

    if (layers.trails) {
      ctx.beginPath()
      let started = false
      for (let i = Math.max(0, sampleIndex(rows, t - 3000)); i < rows.length && rows[i][0] <= t; i++) {
        const [tx, ty] = toPx(rows[i][1], rows[i][2])
        if (started) ctx.lineTo(tx, ty)
        else ctx.moveTo(tx, ty)
        started = true
      }
      ctx.lineTo(px, py)
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 1.6 * unit
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    if (layers.cones) {
      const rad = (state.yaw * Math.PI) / 180
      const half = 0.42 // about a 48° wedge
      const reach = 900 // world cm
      ctx.beginPath()
      ctx.moveTo(px, py)
      for (const angle of [rad - half, rad, rad + half]) {
        // Through the map transform, so the wedge turns the way the map does.
        const [cx, cy] = toPx(state.x + Math.cos(angle) * reach, state.y + Math.sin(angle) * reach)
        ctx.lineTo(cx, cy)
      }
      ctx.closePath()
      ctx.fillStyle = color
      ctx.globalAlpha = 0.16
      ctx.fill()
      ctx.globalAlpha = 1
    }

    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fillStyle = BACKDROP
    ctx.fill()
    const icon = player.agentId ? scene.icons.get(player.agentId) : undefined
    if (icon) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(px, py, radius - 0.8 * unit, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(icon, px - radius, py - radius, radius * 2, radius * 2)
      ctx.restore()
    }
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 2 * unit
    ctx.stroke()
    if (player.isMe) {
      ctx.beginPath()
      ctx.arc(px, py, radius + 3 * unit, 0, Math.PI * 2)
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1.2 * unit
      ctx.stroke()
    }
    if (carrier === player.subject) {
      ctx.beginPath()
      ctx.arc(px + radius * 0.8, py - radius * 0.8, 3.4 * unit, 0, Math.PI * 2)
      ctx.fillStyle = SPIKE_COLOR
      ctx.fill()
    }
  }

  // A kill stays on the map for 1.5 s as a fading line from killer to victim.
  for (const kill of bundle.kills) {
    if (kill.t > t) break
    const age = t - kill.t
    if (age > 1500 || kill.killer === kill.victim) continue
    if (kill.kx == null || kill.ky == null || kill.vx == null || kill.vy == null) continue
    const [ax, ay] = toPx(kill.kx, kill.ky)
    const [bx, by] = toPx(kill.vx, kill.vy)
    const killer = kill.killer ? scene.bySubject.get(kill.killer) : undefined
    ctx.strokeStyle = killer ? TEAM_COLOR[killer.team] : '#FFFFFF'
    ctx.globalAlpha = 1 - age / 1500
    ctx.lineWidth = 1.8 * unit
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/**
 * The match on its minimap, driven by the video.
 *
 * Every frame it asks the player for its time, converts that to the replay
 * clock through the one sync anchor, and draws that instant from the bundle:
 * ten players with view wedges, deaths, utility, the spike, and the pawns
 * agents control. Pausing the video freezes the map; seeking moves it.
 *
 * Memoized: the workstation re-renders four times a second while the video
 * plays, and nothing here should follow that. The frame loop reads its inputs
 * through refs for the same reason.
 */
function ReplayMinimap({
  bundle,
  barrierOffset,
  getVideoTime,
  getPlaybackRate,
  isPlaying,
  onSeek,
  onNudge,
}: ReplayMinimapProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef<HTMLSpanElement>(null)

  const [map, setMap] = useState<GameMap | null>(null)
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map())
  const [mapProblem, setMapProblem] = useState<string | null>(null)
  const [images, setImages] = useState<{ map: HTMLImageElement | null; icons: Map<string, HTMLImageElement> }>({
    map: null,
    icons: new Map(),
  })
  const [layers, setLayers] = useState<Layers>(readLayers)
  const [hud, setHud] = useState({ round: 1, shown: 0 })
  const [nudging, setNudging] = useState(false)
  const [nudgeProblem, setNudgeProblem] = useState<string | null>(null)

  // Map and agent data come from the game-content registry, never from a table here.
  useEffect(() => {
    let cancelled = false
    loadGameContent().then(
      (registry) => {
        if (cancelled) return
        const found = bundle.match.mapUuid ? registry.maps.byId.get(bundle.match.mapUuid) : undefined
        if (!found?.transform) {
          setMapProblem('This map’s minimap data is not available right now.')
          return
        }
        setMapProblem(null)
        setMap(found)
        setAgentNames(new Map([...registry.agents.byId].map(([id, agent]) => [id, agent.name])))
      },
      () => { if (!cancelled) setMapProblem('Could not load map data.') },
    )
    return () => { cancelled = true }
  }, [bundle.match.mapUuid])

  useEffect(() => {
    if (!map) return
    let cancelled = false
    const agentIds = [...new Set(bundle.players.map(p => p.agentId).filter((id): id is string => !!id))]
    Promise.all([
      map.displayIcon ? loadImage(map.displayIcon) : Promise.resolve(null),
      Promise.all(agentIds.map(async id => [id, await loadImage(agentIconUrl(id))] as const)),
    ]).then(([mapImage, icons]) => {
      if (cancelled) return
      setImages({
        map: mapImage,
        icons: new Map(icons.filter((entry): entry is readonly [string, HTMLImageElement] => entry[1] != null)),
      })
    })
    return () => { cancelled = true }
  }, [map, bundle.players])

  const scene = useMemo<Scene | null>(() => {
    if (!map?.transform) return null
    return {
      transform: map.transform,
      view: playedViewport(bundle, map.transform),
      mapImage: images.map,
      icons: images.icons,
      deaths: deathTimesBySubject(bundle),
      bySubject: new Map(bundle.players.map(p => [p.subject, p])),
      flips: ownSideFlips(bundle, map.transform),
    }
  }, [bundle, map, images])

  const killsByRound = useMemo(() => {
    const byRound = new Map<number, ReplayKill[]>()
    for (const kill of bundle.kills) {
      const list = byRound.get(kill.round)
      if (list) list.push(kill)
      else byRound.set(kill.round, [kill])
    }
    return byRound
  }, [bundle])

  // The frame loop outlives renders, so it reads the latest inputs from a ref.
  const live = useRef({ bundle, scene, layers, barrierOffset, isPlaying, getVideoTime, getPlaybackRate, killsByRound })
  useEffect(() => {
    live.current = { bundle, scene, layers, barrierOffset, isPlaying, getVideoTime, getPlaybackRate, killsByRound }
  })

  useEffect(() => {
    let raf = 0
    // The YouTube player reports its time in steps a few times a second. Between
    // two reports, advance from the last one by wall-clock time so the map moves
    // every frame instead of in jumps.
    const clock = { reported: Number.NaN, at: 0 }
    let drawn = { t: Number.NaN, size: 0, scene: null as Scene | null, layers: null as Layers | null }
    let hudShown = { round: -1, shown: -1 }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const state = live.current
      const canvas = canvasRef.current
      const frame = frameRef.current
      if (!canvas || !frame || !state.scene) return

      const anchor = replayAnchorMs(state.bundle) ?? 0
      let t = anchor // unsynced: show the R1 barrier drop
      if (state.barrierOffset != null) {
        const reported = state.getVideoTime()
        if (reported !== clock.reported) {
          clock.reported = reported
          clock.at = now
        }
        const ahead = state.isPlaying ? Math.min(0.5, ((now - clock.at) / 1000) * state.getPlaybackRate()) : 0
        t = videoSecondsToReplayMs(state.bundle, state.barrierOffset, reported + ahead)
        t = Math.max(0, Math.min(state.bundle.match.durationMs, t))
      }

      const dpr = window.devicePixelRatio || 1
      const size = Math.round(frame.clientWidth * dpr)
      if (size === 0) return
      if (canvas.width !== size) {
        canvas.width = size
        canvas.height = size
      }

      if (drawn.t !== t || drawn.size !== size || drawn.scene !== state.scene || drawn.layers !== state.layers) {
        const ctx = canvas.getContext('2d')
        if (ctx) drawScene(ctx, size, state.bundle, state.scene, state.layers, t)
        drawn = { t, size, scene: state.scene, layers: state.layers }
      }

      const round = roundAtReplayMs(state.bundle, t)
      const kills = state.killsByRound.get(round.n) ?? []
      const shown = kills.reduce((count, kill) => count + (kill.t <= t ? 1 : 0), 0)
      if (hudShown.round !== round.n || hudShown.shown !== shown) {
        hudShown = { round: round.n, shown }
        setHud(hudShown)
      }
      if (phaseRef.current) {
        const text =
          round.barrierMs == null ? ''
            : t < round.barrierMs ? `buy phase · barrier in ${Math.ceil((round.barrierMs - t) / 1000)} s`
            : round.endMs != null && t >= round.endMs ? `${round.winner === 'ALLY' ? 'won' : 'lost'} · ${round.how ?? ''}`
            : `+${((t - round.barrierMs) / 1000).toFixed(1)} s`
        if (phaseRef.current.textContent !== text) phaseRef.current.textContent = text
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toggleLayer = (key: LayerKey) => {
    setLayers(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next))
      } catch { /* a full or blocked store only costs the preference */ }
      return next
    })
  }

  const nudge = async (delta: number) => {
    if (nudging) return
    setNudging(true)
    setNudgeProblem(null)
    try {
      await onNudge(delta)
    } catch (err) {
      setNudgeProblem(err instanceof Error ? err.message : 'Could not adjust the sync')
    } finally {
      setNudging(false)
    }
  }

  const synced = barrierOffset != null
  const seekTo = (replayMs: number) => {
    if (barrierOffset == null) return
    onSeek(Math.max(0, replayMsToVideoSeconds(bundle, barrierOffset, replayMs)))
  }

  const round = bundle.rounds.find(r => r.n === hud.round) ?? bundle.rounds[0]
  const roundKills = killsByRound.get(hud.round) ?? []
  const wonBefore = bundle.rounds.filter(r => r.n < hud.round && r.winner === 'ALLY').length
  const lostBefore = bundle.rounds.filter(r => r.n < hud.round && r.winner === 'ENEMY').length
  const label = (subject: string | null) => {
    const player = subject ? scene?.bySubject.get(subject) : undefined
    if (!player) return { name: 'Unknown', tone: 'text-text-muted' }
    const name = (player.agentId && agentNames.get(player.agentId)) || 'Agent'
    return {
      name: player.isMe ? `${name} (you)` : name,
      tone: player.team === 'ALLY' ? 'text-val-cyan' : 'text-val-red',
    }
  }

  if (mapProblem) {
    return (
      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-6 text-center text-xs text-text-muted">
        {mapProblem}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div ref={frameRef} className="relative w-full aspect-square bg-bg-primary border border-bg-elevated rounded-lg overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {!synced && (
          <div className="absolute inset-x-0 bottom-0 bg-bg-primary/85 px-3 py-2 text-center text-[11px] text-val-yellow">
            Sync the round 1 barrier drop under the video to drive the map from the VOD.
          </div>
        )}
      </div>

      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-stats text-text-primary">R{round.n}</span>
          <span className="text-text-muted">{round.side ?? ''}</span>
          <span className="font-stats text-text-secondary">{wonBefore}–{lostBefore}</span>
          <span ref={phaseRef} className="font-stats text-text-muted" />
          <span className="ml-auto flex items-center gap-2 text-[10px]">
            {LAYERS.map(({ key, label: text, title }) => (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                aria-pressed={layers[key]}
                title={title}
                className={`transition-colors ${layers[key] ? 'text-val-cyan' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {text}
              </button>
            ))}
          </span>
        </div>

        <div className="grid grid-cols-12 gap-1">
          {bundle.rounds.map(r => (
            <button
              key={r.n}
              onClick={() => r.barrierMs != null && seekTo(r.barrierMs)}
              disabled={!synced || r.barrierMs == null}
              title={`Round ${r.n}: ${r.winner === 'ALLY' ? 'won' : 'lost'}${r.how ? ` by ${r.how}` : ''}. Jumps to its barrier drop`}
              className={`rounded text-[10px] font-stats py-0.5 transition-colors disabled:cursor-default ${
                r.n === hud.round ? 'bg-bg-elevated ring-1 ring-val-cyan/40' : 'bg-bg-elevated/50 hover:bg-bg-elevated'
              } ${r.winner === 'ALLY' ? 'text-val-green' : 'text-val-red'}`}
            >
              {r.n}
            </button>
          ))}
        </div>

        {barrierOffset != null && (
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span>Map out of step with the video?</span>
            <button
              onClick={() => nudge(-0.1)}
              disabled={nudging}
              title="The map is behind the video: show everything 0.1 s earlier"
              className="px-1.5 py-0.5 rounded bg-bg-elevated hover:text-val-cyan disabled:opacity-40 transition-colors"
            >
              −0.1 s
            </button>
            <button
              onClick={() => nudge(0.1)}
              disabled={nudging}
              title="The map is ahead of the video: show everything 0.1 s later"
              className="px-1.5 py-0.5 rounded bg-bg-elevated hover:text-val-cyan disabled:opacity-40 transition-colors"
            >
              +0.1 s
            </button>
            <span className="font-stats">anchor {barrierOffset.toFixed(1)} s</span>
          </div>
        )}
        {nudgeProblem && <p className="text-[10px] text-val-red">{nudgeProblem}</p>}
      </div>

      <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Kills · round {round.n}</div>
        {roundKills.length === 0 ? (
          <p className="text-xs text-text-muted">No kills this round.</p>
        ) : (
          <ul className="space-y-0.5">
            {roundKills.map((kill, i) => {
              const killer = label(kill.killer)
              const victim = label(kill.victim)
              const selfDeath = kill.killer === kill.victim
              const since = round.barrierMs == null ? '' : `+${((kill.t - round.barrierMs) / 1000).toFixed(1)}`
              return (
                <li key={`${kill.t}-${i}`}>
                  <button
                    onClick={() => seekTo(kill.t - 2000)}
                    disabled={!synced}
                    title="Jump to 2 s before this kill"
                    className={`w-full grid grid-cols-[3rem_1fr_1fr_1fr] gap-2 text-left text-xs rounded px-1 py-0.5 hover:bg-bg-elevated disabled:cursor-default transition-colors ${
                      i < hud.shown ? '' : 'opacity-40'
                    }`}
                  >
                    <span className="font-stats text-text-muted">{since}</span>
                    <span className={`truncate ${killer.tone}`}>{selfDeath ? '' : killer.name}</span>
                    <span className="truncate text-text-muted">
                      {selfDeath ? 'self' : weaponLabel(kill.weapon == null ? null : bundle.weapons[kill.weapon])}
                    </span>
                    <span className={`truncate ${victim.tone}`}>{victim.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="text-[10px] text-text-muted px-1">
        Smoke and utility sizes are approximate: the replay records where and how long, not how big.
      </p>
    </div>
  )
}

export default memo(ReplayMinimap)
