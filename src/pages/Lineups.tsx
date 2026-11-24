import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Clapperboard, Eye, EyeOff, Image as ImageIcon, Plus, X } from 'lucide-react'
import EmptyLine from '../components/EmptyLine'
import LineColorSwatches from '../components/LineColorSwatches'
import LineupCard from '../components/LineupCard'
import PlayCanvas from '../components/PlayCanvas'
import SkinPicker from '../components/play/SkinPicker'
import { useGameContent } from '../hooks/useGameContent'
import { canvasSkin, type CanvasSkinId } from '../lib/canvasSkins'
import { agentIconUrl, type GameAgent } from '../lib/gameContent'
import {
  groupByAbility,
  imageColumn,
  lineupTitle,
  lineupsStep,
  movedLineup,
  nearestCallout,
  parseHiddenIds,
  parseLineupPoint,
  pictureCount,
  recipeLine,
  sharedLineColor,
  standPin,
  toggled,
  type Lineup,
  type LineupImageSlot,
  type LineupInput,
  type LineupPoint,
  type LineupSide,
} from '../lib/lineupModel'
import { clearLineupImage, createLineup, deleteLineup, listLineups, setLineupImage, updateLineup, type LineupsState } from '../lib/lineups'
import type { AbilitySlot, PlayStep } from '../lib/playDoc'

const MAP_KEY = 'lineups.map'
const SIDE_KEY = 'lineups.side'
const AGENT_KEY = 'lineups.agent'
const SKIN_KEY = 'plays.canvasSkin'
/** The line-ups hidden from the map on this device, as a list of their ids. */
const HIDDEN_KEY = 'lineups.hidden'
const STAND_PIN = 'lineup-stand'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A private window: the choice lasts as long as the page.
  }
}

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** A line-up being placed: first where you stand, then where it lands. */
type Placing = { agent: string; slot: AbilitySlot; stand: LineupPoint | null }

const said = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** The agent and ability a new line-up is for. */
function AbilityPicker({ agents, agent, onAgent, onPick, onCancel }: {
  agents: GameAgent[]
  agent: string | null
  onAgent(name: string): void
  onPick(agent: string, slot: AbilitySlot): void
  onCancel(): void
}) {
  const chosen = agents.find(a => a.name === agent) ?? null
  return (
    <div className="bg-bg-card border border-val-cyan/30 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">New line-up: whose ability?</div>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {agents.map(a => (
          <button
            key={a.uuid}
            type="button"
            title={a.name}
            aria-label={a.name}
            aria-pressed={a.name === agent}
            onClick={() => onAgent(a.name)}
            className={`aspect-square rounded-md overflow-hidden border transition-colors ${a.name === agent ? 'border-val-cyan' : 'border-transparent hover:border-val-cyan/40'}`}
          >
            <img src={agentIconUrl(a.uuid)} alt="" loading="lazy" className="w-full h-full object-cover bg-bg-elevated" />
          </button>
        ))}
      </div>
      {chosen && (
        <div className="grid grid-cols-2 gap-1.5">
          {chosen.abilities.map(ability => (
            <button
              key={ability.slot}
              type="button"
              onClick={() => onPick(chosen.name, ability.slot)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg-primary border border-bg-elevated hover:border-val-cyan/50 text-left transition-colors"
            >
              {ability.icon ? <img src={ability.icon} alt="" className="w-5 h-5 object-contain shrink-0" /> : <span className="w-5 h-5 shrink-0" />}
              <span className="text-xs leading-tight">{ability.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * `/plays/lineups` and `/plays/lineups/:id`: the line-ups of one map and side
 * drawn on the plays board, each a throw from where you stand to where it
 * lands; the list beside it; and the open line-up's card (pictures, clip,
 * recipe). The address names the open line-up, so a line-up is a link.
 */
export default function Lineups() {
  const { id: openId } = useParams()
  const navigate = useNavigate()
  const { registry, status } = useGameContent()

  const [state, setState] = useState<LineupsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapChoice, setMapChoice] = useState(() => read(MAP_KEY) ?? '')
  const [side, setSide] = useState<LineupSide>(() => (read(SIDE_KEY) === 'defense' ? 'defense' : 'attack'))
  const [onlyAgent, setOnlyAgent] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [pickAgent, setPickAgent] = useState<string | null>(() => read(AGENT_KEY))
  const [placing, setPlacing] = useState<Placing | null>(null)
  /** The ability whose colour row is open in the list, as `agent:slot`. */
  const [colouring, setColouring] = useState<string | null>(null)
  // The canvas skin is the one picked in the Plays editor, and a pick here is kept for it too.
  const [skinId, setSkinIdState] = useState<CanvasSkinId>(() => canvasSkin(read(SKIN_KEY)).id)
  const setSkinId = (next: CanvasSkinId) => {
    write(SKIN_KEY, next)
    setSkinIdState(next)
  }
  // Which line-ups are hidden from the map: a way of looking, kept on this device, not part of a line-up.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => parseHiddenIds(read(HIDDEN_KEY)))
  const setHiddenIds = (next: ReadonlySet<string>) => {
    write(HIDDEN_KEY, JSON.stringify([...next]))
    setHidden(next)
  }

  const load = useCallback(() => {
    listLineups()
      .then(setState)
      .catch(err => setError(said(err, 'Line-ups could not be loaded.')))
  }, [])
  useEffect(load, [load])

  const rows = useMemo(() => state?.rows ?? [], [state])
  const open = useMemo(() => rows.find(row => row.id === openId) ?? null, [rows, openId])

  // The maps the board can draw, by name.
  const maps = useMemo(
    () => (registry ? [...registry.maps.byId.values()].filter(m => m.transform && m.callouts.length > 0).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [registry],
  )
  const gameMap = maps.find(m => m.name === mapChoice) ?? maps[0] ?? null
  const agents = useMemo(() => (registry ? [...registry.agents.byId.values()].sort((a, b) => a.name.localeCompare(b.name)) : []), [registry])
  const agentOf = useCallback((name: string) => registry?.agents.byName.get(name) ?? agents.find(a => a.name === name) ?? null, [registry, agents])
  const abilityOf = useCallback(
    (agent: string, slot: AbilitySlot) => {
      const found = agentOf(agent)?.abilities.find(a => a.slot === slot)
      return { name: found?.name ?? slot, icon: found?.icon ?? null }
    },
    [agentOf],
  )

  const select = useCallback((id: string | null) => navigate(id ? `/plays/lineups/${id}` : '/plays/lineups', { replace: true }), [navigate])

  // A line-up opened by its link brings its map and side with it.
  const [followed, setFollowed] = useState<string | null>(null)
  if ((open?.id ?? null) !== followed) {
    setFollowed(open?.id ?? null)
    if (open) {
      setMapChoice(open.map)
      setSide(open.side)
    }
  }

  const here = useMemo(() => rows.filter(row => gameMap && row.map === gameMap.name && row.side === side), [rows, gameMap, side])
  const shown = useMemo(() => here.filter(row => !onlyAgent || row.agent === onlyAgent), [here, onlyAgent])
  const agentsHere = useMemo(() => [...new Set(here.map(row => row.agent))].sort(), [here])

  const hiddenHere = shown.filter(row => hidden.has(row.id)).length
  const groups = useMemo(() => groupByAbility(shown), [shown])

  const step = useMemo(() => {
    // A hidden line-up is not drawn, unless it is the one open: its card would describe nothing.
    const drawn = shown.filter(row => !hidden.has(row.id) || row.id === openId)
    return lineupsStep(drawn, placing?.stand ? [standPin(STAND_PIN, placing.agent, placing.stand)] : [])
  }, [shown, hidden, openId, placing])

  const patchLocal = (id: string, patch: Partial<Lineup>) =>
    setState(current => (current ? { ...current, rows: current.rows.map(row => (row.id === id ? { ...row, ...patch } : row)) } : current))

  /** Saves a change of the line-up: shown at once, and read again from the table if the save is refused. */
  const patch = (id: string, change: Partial<LineupInput>) => {
    patchLocal(id, change)
    setError(null)
    updateLineup(id, change).catch(err => {
      setError(said(err, 'That change could not be saved.'))
      load()
    })
  }

  const placeName = (point: LineupPoint) => (gameMap?.transform ? (nearestCallout(point, gameMap.callouts, gameMap.transform)?.name ?? null) : null)

  const create = async (agent: string, slot: AbilitySlot, stand: LineupPoint, land: LineupPoint) => {
    if (!gameMap) return
    const standName = placeName(stand)
    const landName = placeName(land)
    const input: LineupInput = {
      title: lineupTitle(landName, standName, abilityOf(agent, slot).name),
      map: gameMap.name,
      map_uuid: gameMap.uuid,
      side,
      agent,
      slot,
      stand,
      land,
      via: [],
      curved: false,
      // A new line-up joins its ability's group: it takes the colour the group has.
      line_color: sharedLineColor(here.filter(row => row.agent === agent && row.slot === slot)) ?? null,
      stand_callout: standName,
      land_callout: landName,
      purpose: null,
      stance: null,
      movement: null,
      click: null,
      bounces: null,
      charge: null,
      note: '',
      stand_image: null,
      aim_image: null,
      result_image: null,
      video_url: null,
      video_start: null,
      video_end: null,
      patch: null,
      verified_on: today(),
      source: null,
    }
    try {
      const row = await createLineup(input)
      setState(current => (current ? { ...current, rows: [row, ...current.rows] } : current))
      if (onlyAgent && onlyAgent !== agent) setOnlyAgent(null)
      select(row.id)
    } catch (err) {
      setError(said(err, 'The line-up could not be saved.'))
    }
  }

  /** Every change the board makes comes through here, as the whole step. */
  const onCanvasChange = (next: PlayStep) => {
    if (placing && !placing.stand) {
      const pin = next.elements.find(el => el.kind === 'marker' && !step.elements.some(old => old.id === el.id))
      const stand = pin?.kind === 'marker' ? parseLineupPoint(pin.at) : null
      if (stand) setPlacing({ ...placing, stand })
      return
    }
    if (placing?.stand) {
      const thrown = next.elements.find(el => el.kind === 'ability' && !step.elements.some(old => old.id === el.id))
      const land = thrown?.kind === 'ability' ? parseLineupPoint(thrown.at) : null
      if (land) {
        const { agent, slot, stand } = placing
        setPlacing(null)
        void create(agent, slot, stand, land)
      }
      return
    }
    for (const row of shown) {
      const moved = movedLineup(next, row)
      if (!moved) continue
      const standName = placeName(moved.stand)
      const landName = placeName(moved.land)
      const ability = abilityOf(row.agent, row.slot).name
      // A name the page gave follows the line-up; one the user typed stays.
      const named = row.title === lineupTitle(row.land_callout, row.stand_callout, ability)
      patch(row.id, {
        ...moved,
        stand_callout: standName,
        land_callout: landName,
        ...(named ? { title: lineupTitle(landName, standName, ability) } : {}),
        // A corner of a straight line is a bounce: the recipe follows the line until it is set by hand.
        ...(!row.curved && moved.via.length !== row.via.length && (row.bounces === null || row.bounces === Math.min(3, row.via.length))
          ? { bounces: Math.min(3, moved.via.length) }
          : {}),
      })
    }
  }

  const startPlacing = (agent: string, slot: AbilitySlot) => {
    write(AGENT_KEY, agent)
    setPicking(false)
    setPlacing({ agent, slot, stand: null })
    select(null)
  }

  // Escape backs out of placing, then closes the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (placing) setPlacing(null)
      else if (picking) setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, picking])

  const changeMap = (name: string) => {
    write(MAP_KEY, name)
    select(null)
    setPlacing(null)
    setOnlyAgent(null)
    setMapChoice(name)
  }
  const changeSide = (next: LineupSide) => {
    write(SIDE_KEY, next)
    select(null)
    setPlacing(null)
    setOnlyAgent(null)
    setSide(next)
  }

  const onImage = async (lineup: Lineup, slot: LineupImageSlot, file: Blob) => {
    const saved = await setLineupImage(lineup, slot, file)
    patchLocal(lineup.id, { [imageColumn(slot)]: saved[imageColumn(slot)], updated_at: saved.updated_at })
  }
  const onClearImage = async (lineup: Lineup, slot: LineupImageSlot) => {
    await clearLineupImage(lineup, slot)
    patchLocal(lineup.id, { [imageColumn(slot)]: null })
  }
  const remove = (lineup: Lineup) => {
    select(null)
    setHiddenIds(toggled(hidden, [lineup.id], false))
    setState(current => (current ? { ...current, rows: current.rows.filter(row => row.id !== lineup.id) } : current))
    deleteLineup(lineup).catch(err => {
      setError(said(err, 'The line-up could not be deleted.'))
      load()
    })
  }

  const skin = canvasSkin(skinId)
  const placingAbility = placing ? abilityOf(placing.agent, placing.slot) : null
  const openAbility = open ? abilityOf(open.agent, open.slot) : null
  const openAgent = open ? agentOf(open.agent) : null

  return (
    <div className="max-w-[1500px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/plays" className="text-sm text-text-secondary hover:text-val-cyan transition-colors">
            ← Plays
          </Link>
          <h1 className="font-heading text-3xl font-bold">Line-ups</h1>
          <p className="text-text-secondary text-sm">Where to stand, where to aim, where it lands</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Map"
            value={gameMap?.name ?? ''}
            onChange={e => changeMap(e.target.value)}
            className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-1.5 text-sm outline-none focus:border-val-cyan/60"
          >
            {maps.map(m => (
              <option key={m.uuid} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <SkinPicker skin={skinId} onPick={setSkinId} cycleKey={false} buttonClass="inline-flex items-center gap-1.5 bg-bg-card border border-bg-elevated rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors" />
          <div className="inline-flex rounded-lg border border-bg-elevated overflow-hidden" role="group" aria-label="Side">
            {(['attack', 'defense'] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={side === value}
                onClick={() => changeSide(value)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  side === value ? (value === 'attack' ? 'bg-val-red/15 text-val-red' : 'bg-val-cyan/15 text-val-cyan') : 'bg-bg-card text-text-secondary hover:text-text-primary'
                }`}
              >
                {value === 'attack' ? 'Attack' : 'Defense'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {state?.tableMissing && (
        <div className="border border-val-yellow/30 bg-val-yellow/10 text-sm rounded-md px-3 py-2">
          The line-ups table is not in the database yet. Run <code className="font-stats">supabase/migrations/20261124_lineups.sql</code> in the Supabase SQL editor, then reload.
        </div>
      )}
      {error && <div className="border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_400px] gap-4 items-start">
        {/* The list */}
        <div className="space-y-3 order-2 lg:order-1">
          {picking ? (
            <AbilityPicker
              agents={agents}
              agent={pickAgent}
              onAgent={setPickAgent}
              onPick={startPlacing}
              onCancel={() => setPicking(false)}
            />
          ) : (
            <button
              type="button"
              disabled={!gameMap || !state || state.tableMissing}
              onClick={() => {
                setPlacing(null)
                setPicking(true)
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">New line-up</span>
            </button>
          )}

          {agentsHere.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Agent">
              {agentsHere.map(name => {
                const agent = agentOf(name)
                const on = onlyAgent === name
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    aria-label={name}
                    aria-pressed={on}
                    onClick={() => setOnlyAgent(on ? null : name)}
                    className={`w-8 h-8 rounded-full overflow-hidden border-2 transition-colors ${on ? 'border-val-cyan' : 'border-transparent opacity-70 hover:opacity-100'}`}
                  >
                    {agent ? <img src={agentIconUrl(agent.uuid)} alt="" className="w-full h-full object-cover bg-bg-elevated" /> : <span className="text-[10px]">{name.slice(0, 2)}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {!state && !error ? (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-14 rounded-lg bg-bg-card animate-pulse" />
              ))}
            </div>
          ) : shown.length > 0 ? (
            <>
            {shown.length > 1 && (
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>
                  {shown.length - hiddenHere} of {shown.length} on the map
                </span>
                <button
                  type="button"
                  onClick={() => setHiddenIds(toggled(hidden, shown.map(row => row.id), hiddenHere < shown.length))}
                  className="inline-flex items-center gap-1 hover:text-val-cyan transition-colors"
                >
                  {hiddenHere < shown.length ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {hiddenHere < shown.length ? 'Hide all' : 'Show all'}
                </button>
              </div>
            )}
            <div className="space-y-4">
              {groups.map(group => {
                const ability = abilityOf(group.agent, group.slot)
                const agent = agentOf(group.agent)
                const ids = group.rows.map(row => row.id)
                const allOff = ids.every(id => hidden.has(id))
                const key = `${group.agent}:${group.slot}`
                const colour = sharedLineColor(group.rows)
                return (
                  <section key={`${group.agent}:${group.slot}`} aria-label={`${group.agent}: ${ability.name}`} className="space-y-1.5">
                    <div className="flex items-stretch gap-1">
                      {/* The group's band wears its colour, as a layer group wears its label. */}
                      <div
                        className={`min-w-0 flex-1 flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-lg ${colour ? '' : 'bg-bg-elevated/40'}`}
                        style={colour ? { backgroundColor: `color-mix(in srgb, ${colour} 34%, transparent)` } : undefined}
                      >
                      <span className={`relative shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${colour ? 'bg-white/10' : 'bg-bg-elevated'}`}>
                        {ability.icon ? <img src={ability.icon} alt="" className="w-5 h-5 object-contain" /> : null}
                        {agent && <img src={agentIconUrl(agent.uuid)} alt="" className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-bg-primary border border-bg-elevated object-cover" />}
                      </span>
                      <h2 className="min-w-0 flex-1 leading-tight">
                        <span className="block text-sm font-semibold line-clamp-1" style={colour ? { color: `color-mix(in srgb, ${colour} 28%, white)` } : undefined}>
                          {ability.name}
                        </span>
                        <span className="block text-[11px] text-text-muted" style={colour ? { color: `color-mix(in srgb, ${colour} 45%, #AEB7C4)` } : undefined}>
                          {group.agent} · {group.rows.length} {group.rows.length === 1 ? 'line-up' : 'line-ups'}
                        </span>
                      </h2>
                      <button
                        type="button"
                        aria-expanded={colouring === key}
                        aria-label={`Line colour of every ${ability.name} line-up`}
                        title={colour === undefined ? 'Line colour: its line-ups differ' : colour === null ? 'Line colour: the colour of the ability' : `Line colour: ${colour}`}
                        onClick={() => setColouring(colouring === key ? null : key)}
                        className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${colouring === key ? 'bg-black/30' : 'hover:bg-black/20'}`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full border-2 ${colour === null ? 'border-dashed border-text-muted' : 'border-bg-primary ring-1 ring-text-muted/50'}`}
                          style={
                            colour === undefined
                              ? { background: `conic-gradient(${[...new Set(group.rows.map(row => row.line_color ?? '#64748B'))].map((c, i, all) => `${c} ${(i / all.length) * 360}deg ${((i + 1) / all.length) * 360}deg`).join(', ')})` }
                              : colour
                                ? { backgroundColor: colour }
                                : undefined
                          }
                        />
                      </button>
                      </div>
                      {/* The eye column lines up with the line-ups' own eyes; a group of one has theirs. */}
                      {group.rows.length > 1 ? (
                        <button
                          type="button"
                          aria-pressed={allOff}
                          aria-label={allOff ? `Show every ${ability.name} line-up on the map` : `Hide every ${ability.name} line-up from the map`}
                          title={allOff ? `Show every ${ability.name}` : `Hide every ${ability.name}`}
                          onClick={() => setHiddenIds(toggled(hidden, ids, !allOff))}
                          className={`shrink-0 w-8 flex items-center justify-center rounded-lg border transition-colors ${
                            allOff ? 'bg-bg-primary border-bg-elevated text-text-muted hover:text-text-primary' : 'bg-bg-card border-bg-elevated text-text-secondary hover:text-val-cyan hover:border-val-cyan/30'
                          }`}
                        >
                          {allOff ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      ) : (
                        <span className="shrink-0 w-8" aria-hidden="true" />
                      )}
                    </div>
                    {colouring === key && (
                      <div className="rounded-lg border border-bg-elevated bg-bg-card p-2 space-y-1.5">
                        <LineColorSwatches
                          label={`Line colour of every ${ability.name} line-up`}
                          value={colour}
                          onPick={picked => {
                            for (const row of group.rows) if (row.line_color !== picked) patch(row.id, { line_color: picked })
                          }}
                        />
                        <p className="text-[11px] text-text-muted">
                          Sets the line of {group.rows.length === 1 ? 'this line-up' : `all ${group.rows.length} line-ups`}; a new {ability.name} line-up takes it too.
                        </p>
                      </div>
                    )}
            <ul className="space-y-1.5">
              {group.rows.map(row => {
                const recipe = recipeLine(row)
                const pictures = pictureCount(row)
                const off = hidden.has(row.id)
                return (
                  <li key={row.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      aria-current={row.id === openId}
                      onClick={() => {
                        setPlacing(null)
                        select(row.id)
                      }}
                      className={`min-w-0 flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors ${
                        row.id === openId ? 'bg-val-cyan/10 border-val-cyan/40' : 'bg-bg-card border-bg-elevated hover:border-val-cyan/30'
                      } ${off && row.id !== openId ? 'opacity-55' : ''}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-tight line-clamp-1" title={row.title}>
                          {row.title}
                        </span>
                        {recipe && <span className="block text-[11px] text-text-muted line-clamp-1">{recipe}</span>}
                      </span>
                      <span className="shrink-0 flex items-center gap-1.5 text-[11px] text-text-muted font-stats">
                        {row.video_url && <Clapperboard className="w-3.5 h-3.5" aria-label="Has a clip" />}
                        <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
                        {pictures}/3
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={off}
                      aria-label={off ? `Show ${row.title} on the map` : `Hide ${row.title} from the map`}
                      title={off ? 'Show on the map' : 'Hide from the map'}
                      onClick={() => setHiddenIds(toggled(hidden, [row.id], !off))}
                      className={`shrink-0 w-8 flex items-center justify-center rounded-lg border transition-colors ${
                        off ? 'bg-bg-primary border-bg-elevated text-text-muted hover:text-text-primary' : 'bg-bg-card border-bg-elevated text-text-secondary hover:text-val-cyan hover:border-val-cyan/30'
                      }`}
                    >
                      {off ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </li>
                )
              })}
            </ul>
                  </section>
                )
              })}
            </div>
            </>
          ) : (
            state &&
            !state.tableMissing && (
              <EmptyLine>
                <p>
                  No line-up on {gameMap?.name ?? 'this map'} for {side === 'attack' ? 'attack' : 'defense'} yet. Press New line-up, pick the ability, then click where you stand and where it lands.
                </p>
              </EmptyLine>
            )
          )}
        </div>

        {/* The map */}
        <div className="order-1 lg:order-2 space-y-2">
          <div style={{ backgroundColor: skin.back }} className="relative w-full aspect-square max-h-[calc(100vh-11rem)] mx-auto rounded-xl overflow-hidden border border-bg-elevated">
            {!registry && status === 'loading' ? (
              <div className="absolute inset-3 rounded-xl bg-bg-card animate-pulse" aria-hidden="true" />
            ) : gameMap ? (
              <div className="absolute inset-2">
                <PlayCanvas
                  key={`${gameMap.uuid}:${side}`}
                  map={gameMap}
                  side={side}
                  step={step}
                  previous={null}
                  tool={placing && !placing.stand ? 'pin' : 'select'}
                  pending={placing?.stand ? { agent: placing.agent, slot: placing.slot } : null}
                  selectedId={placing ? null : (openId ?? null)}
                  showCallouts
                  showNames={false}
                  skin={skinId}
                  animate={false}
                  onSelect={id => {
                    if (placing) return
                    // The pin where you stand opens its line-up, as the ability does.
                    const lineupId = id?.startsWith('stand:') ? id.slice('stand:'.length) : id
                    select(lineupId && rows.some(row => row.id === lineupId) ? lineupId : null)
                  }}
                  onChange={onCanvasChange}
                  onPendingDone={() => {}}
                />
                {placing && placingAbility && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-primary/90 border border-val-cyan/40 text-sm shadow-lg">
                    {placingAbility.icon && <img src={placingAbility.icon} alt="" className="w-4 h-4 object-contain" />}
                    <span>{placing.stand ? `${placingAbility.name}: click where it lands` : `${placingAbility.name}: click where you stand`}</span>
                    <button type="button" onClick={() => setPlacing(null)} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">No map can be drawn right now.</div>
            )}
          </div>
          <p className="text-[11px] text-text-muted text-center">
            Scroll to zoom. Drag the ability to move where it lands and the pin to move where you stand. On an open line-up, press a + on the line to add a bend and drag it; press a bend twice to remove it.
          </p>
        </div>

        {/* The card */}
        <div className="order-3">
          {open && openAbility ? (
            <LineupCard
              key={open.id}
              lineup={open}
              ability={openAbility}
              agentIcon={openAgent ? agentIconUrl(openAgent.uuid) : null}
              onPatch={change => patch(open.id, change)}
              onImage={(slot, file) => onImage(open, slot, file)}
              onClearImage={slot => onClearImage(open, slot)}
              onDelete={() => remove(open)}
              onClose={() => select(null)}
            />
          ) : (
            <EmptyLine>
              <p>{openId && state && !open ? 'That line-up is not in your library.' : 'Pick a line-up on the map or in the list to open its pictures, clip and recipe.'}</p>
            </EmptyLine>
          )}
        </div>
      </div>
    </div>
  )
}
