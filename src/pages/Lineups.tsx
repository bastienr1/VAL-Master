import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, Clapperboard, Eye, EyeOff, Image as ImageIcon, ListFilter, Maximize2, Minimize2, Plus, Users, X } from 'lucide-react'
import ArtSlot from '../components/ArtSlot'
import EmptyLine from '../components/EmptyLine'
import LineColorSwatches from '../components/LineColorSwatches'
import LineupCard from '../components/LineupCard'
import PlayCanvas from '../components/PlayCanvas'
import PurposeChips from '../components/PurposeChips'
import SaveBadge, { type SaveState } from '../components/SaveBadge'
import SkinPicker from '../components/play/SkinPicker'
import LineupsHeader from '../components/lineups/LineupsHeader'
import PicturePicker from '../components/lineups/PicturePicker'
import { mapSlotKey } from '../lib/artSlots'
import { useGameContent } from '../hooks/useGameContent'
import { canvasSkin, type CanvasSkinId } from '../lib/canvasSkins'
import { agentIconUrl, type GameAgent } from '../lib/gameContent'
import {
  groupByAbility,
  imageColumn,
  libraryLink,
  lineupTitle,
  lineupsStep,
  movedLineup,
  nearestCallout,
  ofPurpose,
  parseHiddenIds,
  parseLineupPoint,
  parsePurposeFilter,
  purposeFilterLabel,
  purposePick,
  sharedLineColor,
  standPin,
  toggled,
  type Lineup,
  type LineupImageSlot,
  type LineupInput,
  type LineupPoint,
  type LineupSide,
  type PurposeFilter,
} from '../lib/lineupModel'
import { clearLineupImage, createLineup, deleteLineup, lineupImageUrl, listLineups, setLineupImage, updateLineup, type LineupsState } from '../lib/lineups'
import type { AbilitySlot, PlayStep } from '../lib/playDoc'

const MAP_KEY = 'lineups.map'
const SIDE_KEY = 'lineups.side'
const AGENT_KEY = 'lineups.agent'
const SKIN_KEY = 'plays.canvasSkin'
/** The line-ups hidden from the map on this device, as a list of their ids. */
const HIDDEN_KEY = 'lineups.hidden'
/** The ability groups folded shut in the list, as `agent:slot` keys. */
const FOLDED_KEY = 'lineups.folded'
/** Whether the page was last left filling the window. */
const FULL_KEY = 'lineups.full'
const STAND_PIN = 'lineup-stand'

/** A key pressed while typing belongs to the field. */
const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable)

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
type Placing = { agent: string; slot: AbilitySlot; side: LineupSide; stand: LineupPoint | null }

const SIDE_LABEL: Record<LineupSide, string> = { attack: 'Attack', defense: 'Defense' }

/** A line-up's best picture for the list: where it lands, else the aim, else where you stand. */
const bestPicture = (row: Lineup) => row.result_image ?? row.aim_image ?? row.stand_image

const said = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** The agent and ability a new line-up is for. */
function AbilityPicker({ agents, agent, onAgent, side, onSide, onPick, onCancel }: {
  agents: GameAgent[]
  agent: string | null
  onAgent(name: string): void
  /** The side the new line-up is for: the list shows both, so it is asked here. */
  side: LineupSide
  onSide(side: LineupSide): void
  onPick(agent: string, slot: AbilitySlot): void
  onCancel(): void
}) {
  const chosen = agents.find(a => a.name === agent) ?? null
  return (
    <div className="bg-bg-primary border border-val-cyan/30 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">New line-up: whose ability?</div>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="inline-flex rounded-lg border border-bg-elevated overflow-hidden" role="group" aria-label="Side of the new line-up">
        {(['attack', 'defense'] as const).map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={side === value}
            onClick={() => onSide(value)}
            className={`px-3 py-1 text-xs transition-colors ${
              side === value ? (value === 'attack' ? 'bg-val-red/15 text-val-red' : 'bg-val-cyan/15 text-val-cyan') : 'bg-bg-card text-text-secondary hover:text-text-primary'
            }`}
          >
            {SIDE_LABEL[value]}
          </button>
        ))}
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
 * `/plays/lineups/board` and `/plays/lineups/board/:id`: the line-ups of one
 * map, both sides unless the filter says one, drawn on the plays board, each a throw from where you stand to
 * where it lands; the list beside it; and the open line-up's card (pictures,
 * clip, recipe). The address names the open line-up, so a line-up is a link.
 * The library (`/plays/lineups`) is the way in to the line-ups that exist: it
 * sends the map, side and agent it stood on (`?map=&side=&agent=`), and
 * `?new=1` to start a line-up at once.
 */
export default function Lineups() {
  const { id: openId } = useParams()
  const navigate = useNavigate()
  const { registry, status } = useGameContent()

  const [state, setState] = useState<LineupsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Where the library sent us, read once: after that the page's own switches decide.
  const [asked] = useSearchParams()
  const [mapChoice, setMapChoice] = useState(() => asked.get('map') ?? read(MAP_KEY) ?? '')
  // The list holds both sides; a side is a filter, like a purpose.
  const [sideFilter, setSideFilter] = useState<LineupSide | null>(() => {
    const from = asked.get('side')
    return from === 'attack' || from === 'defense' ? from : null
  })
  // The side a new line-up is for: the filter's when there is one, else the last one used.
  const [newSide, setNewSideState] = useState<LineupSide>(() => {
    const from = asked.get('side') ?? read(SIDE_KEY)
    return from === 'defense' ? 'defense' : 'attack'
  })
  const setNewSide = (next: LineupSide) => {
    write(SIDE_KEY, next)
    setNewSideState(next)
  }
  const [filtersOpen, setFiltersOpen] = useState(false)
  /** The line-up just made: its card opens with its fields to fill in. */
  const [fresh, setFresh] = useState<string | null>(null)
  const [onlyAgent, setOnlyAgent] = useState<string | null>(() => (asked.has('new') ? null : asked.get('agent')))
  // The purpose looked for: a way of looking that stays through a change of map or side.
  const [askedPurpose, setAskedPurpose] = useState<PurposeFilter | null>(() => parsePurposeFilter(asked.get('purpose')))
  const [picking, setPicking] = useState(() => asked.has('new'))
  const [pickAgent, setPickAgent] = useState<string | null>(() => asked.get('agent') ?? read(AGENT_KEY))
  const [placing, setPlacing] = useState<Placing | null>(null)
  /** The ability whose colour row is open in the list, as `agent:slot`. */
  const [colouring, setColouring] = useState<string | null>(null)

  // There is no Save button: every change is written as it is made, and this says how the last write went.
  const [writing, setWriting] = useState(0)
  const [refused, setRefused] = useState(false)
  const [written, setWritten] = useState(false)
  const track = <T,>(work: Promise<T>): Promise<T> => {
    setWriting(n => n + 1)
    return work.then(
      value => {
        setWriting(n => n - 1)
        setRefused(false)
        setWritten(true)
        return value
      },
      err => {
        setWriting(n => n - 1)
        setRefused(true)
        throw err
      },
    )
  }
  const saveState: SaveState = writing > 0 ? 'saving' : refused ? 'failed' : written ? 'saved' : 'idle'

  /**
   * Full screen: the page leaves its centred frame and fills the window under
   * the app's own bar and rail, the map taking all the room between the list
   * and the card. Tab then hides and shows those two panels.
   */
  const [full, setFull] = useState(() => read(FULL_KEY) === 'true')
  const [panelsOff, setPanelsOff] = useState(false)
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
  // Which ability groups are folded shut in the list, on this device.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => parseHiddenIds(read(FOLDED_KEY)))
  const toggleFold = (key: string) => {
    const next = toggled(folded, [key], !folded.has(key))
    write(FOLDED_KEY, JSON.stringify([...next]))
    setFolded(next)
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

  const select = useCallback((id: string | null) => navigate(id ? `/plays/lineups/board/${id}` : '/plays/lineups/board', { replace: true }), [navigate])

  // A line-up opened by its link brings its map with it.
  const [followed, setFollowed] = useState<string | null>(null)
  if ((open?.id ?? null) !== followed) {
    setFollowed(open?.id ?? null)
    if (open) {
      setMapChoice(open.map)
    }
  }

  const onMap = useMemo(() => rows.filter(row => gameMap && row.map === gameMap.name), [rows, gameMap])
  // An agent with no line-up here narrows nothing: the list would be empty with no way to say why.
  const byAgent = useMemo(() => {
    const narrowed = onlyAgent && onMap.some(row => row.agent === onlyAgent)
    return narrowed ? onMap.filter(row => row.agent === onlyAgent) : onMap
  }, [onMap, onlyAgent])
  const sideCounts: Record<LineupSide, number> = {
    attack: byAgent.filter(row => row.side === 'attack').length,
    defense: byAgent.filter(row => row.side === 'defense').length,
  }
  // The open line-up stays listed whatever the filters say, so its card never describes a line-up that is not there.
  const bySide = useMemo(() => (sideFilter ? byAgent.filter(row => row.side === sideFilter || row.id === openId) : byAgent), [byAgent, sideFilter, openId])
  const purpose = useMemo(() => purposePick(bySide, askedPurpose), [bySide, askedPurpose])
  const shown = useMemo(() => ofPurpose(bySide, purpose, openId), [bySide, purpose, openId])
  const anyPurpose = bySide.some(row => row.purpose)
  const activeFilters = (sideFilter ? 1 : 0) + (purpose ? 1 : 0)
  const agentsHere = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of onMap) counts.set(row.agent, (counts.get(row.agent) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }))
  }, [onMap])
  /** The other side, when the filter keeps one and the line-ups are on the other. */
  const otherSide: LineupSide = sideFilter === 'attack' ? 'defense' : 'attack'
  const onOtherSide = sideFilter ? sideCounts[otherSide] : 0
  // The map turns so a side starts at the bottom: the filter's side, else attack.
  const drawSide: LineupSide = sideFilter ?? 'attack'

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
    track(updateLineup(id, change)).catch(err => {
      setError(said(err, 'That change could not be saved.'))
      load()
    })
  }

  const placeName = (point: LineupPoint) => (gameMap?.transform ? (nearestCallout(point, gameMap.callouts, gameMap.transform)?.name ?? null) : null)

  const create = async (agent: string, slot: AbilitySlot, side: LineupSide, stand: LineupPoint, land: LineupPoint) => {
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
      line_color: sharedLineColor(onMap.filter(row => row.agent === agent && row.slot === slot)) ?? null,
      stand_callout: standName,
      land_callout: landName,
      // Made while looking at one purpose, it is one of those: it would leave the list otherwise.
      purpose: purpose && purpose !== 'none' ? purpose : null,
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
      const row = await track(createLineup(input))
      setState(current => (current ? { ...current, rows: [row, ...current.rows] } : current))
      if (onlyAgent && onlyAgent !== agent) setOnlyAgent(null)
      setFresh(row.id)
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
        const { agent, slot, side, stand } = placing
        setPlacing(null)
        void create(agent, slot, side, stand, land)
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
    setPlacing({ agent, slot, side: newSide, stand: null })
    select(null)
  }

  // Escape backs out of placing, then of picking, then (with no line-up open) of full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (placing) setPlacing(null)
      else if (picking) setPicking(false)
      else if (full && !openId && !typingIn(e.target)) {
        write(FULL_KEY, 'false')
        setFull(false)
        setPanelsOff(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, picking, full, openId])

  // F fills the window and gives it back. In full screen Tab hides and shows the panels: the app's own
  // Tab (its match search) is heard after this one, so it is stopped here and stays as it is elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return
      if (e.key === 'Tab' && !e.shiftKey && full) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setPanelsOff(off => !off)
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        write(FULL_KEY, String(!full))
        setFull(!full)
        setPanelsOff(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [full])

  const changeMap = (name: string) => {
    write(MAP_KEY, name)
    select(null)
    setPlacing(null)
    setOnlyAgent(null)
    setMapChoice(name)
  }
  const changeSide = (next: LineupSide | null) => {
    if (next) setNewSide(next)
    setSideFilter(next)
  }
  const clearFilters = () => {
    setSideFilter(null)
    setAskedPurpose(null)
  }

  // The filter menu closes on a press outside it or Escape.
  const filterBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!filtersOpen) return
    const onDown = (e: PointerEvent) => {
      if (filterBox.current && !filterBox.current.contains(e.target as Node)) setFiltersOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setFiltersOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [filtersOpen])

  const onImage = async (lineup: Lineup, slot: LineupImageSlot, file: Blob) => {
    const saved = await track(setLineupImage(lineup, slot, file))
    patchLocal(lineup.id, { [imageColumn(slot)]: saved[imageColumn(slot)], updated_at: saved.updated_at })
  }
  const onClearImage = async (lineup: Lineup, slot: LineupImageSlot) => {
    await track(clearLineupImage(lineup, slot))
    patchLocal(lineup.id, { [imageColumn(slot)]: null })
  }
  const remove = (lineup: Lineup) => {
    select(null)
    setHiddenIds(toggled(hidden, [lineup.id], false))
    setState(current => (current ? { ...current, rows: current.rows.filter(row => row.id !== lineup.id) } : current))
    track(deleteLineup(lineup)).catch(err => {
      setError(said(err, 'The line-up could not be deleted.'))
      load()
    })
  }

  const skin = canvasSkin(skinId)
  const placingAbility = placing ? abilityOf(placing.agent, placing.slot) : null
  const openAbility = open ? abilityOf(open.agent, open.slot) : null
  const openAgent = open ? agentOf(open.agent) : null

  const toggleFull = () => {
    write(FULL_KEY, String(!full))
    setFull(!full)
    setPanelsOff(false)
  }
  const back = { to: libraryLink({ map: gameMap && onMap.length > 0 ? gameMap.name : null, agent: open?.agent ?? onlyAgent, side: sideFilter ?? open?.side ?? null, purpose }), label: '← Library' }
  const panel = 'bg-bg-card border border-bg-elevated rounded-xl'
  const agentValue = onlyAgent && agentsHere.some(a => a.name === onlyAgent) ? onlyAgent : ''
  const countOnMap = (name: string) => rows.filter(row => row.map === name).length

  const pickers = (
    <div className={`${panel} p-3 space-y-3`}>
      <PicturePicker
        label="Map"
        value={gameMap?.name ?? ''}
        onPick={changeMap}
        options={maps.map(m => {
          const n = countOnMap(m.name)
          return {
            value: m.name,
            label: m.name,
            hint: n > 0 ? String(n) : undefined,
            quiet: n === 0,
            picture: <ArtSlot slotKey={mapSlotKey(m.uuid)} apiDefault={m.listViewIconTall} scrim="bottom" defaultOverlay={0} className="w-full h-full" />,
          }
        })}
      />
      <PicturePicker
        label="Agent"
        value={agentValue}
        onPick={value => setOnlyAgent(value || null)}
        options={[
          {
            value: '',
            label: 'All agents',
            hint: String(onMap.length),
            picture: (
              <span className="w-full h-full flex items-center justify-center text-text-secondary">
                <Users className="w-4 h-4" />
              </span>
            ),
          },
          ...agentsHere.map(({ name, count }) => {
            const agent = agentOf(name)
            return {
              value: name,
              label: name,
              hint: String(count),
              picture: agent ? <img src={agentIconUrl(agent.uuid)} alt="" className="w-full h-full object-cover object-[50%_25%]" /> : <span className="text-[10px]">{name.slice(0, 2)}</span>,
            }
          }),
        ]}
      />
    </div>
  )

  const filterMenu = (
    <div ref={filterBox} className="relative">
      <button
        type="button"
        aria-label={activeFilters > 0 ? `Filters: ${activeFilters} on` : 'Filters'}
        aria-haspopup="dialog"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen(o => !o)}
        className={`relative p-1.5 rounded-md transition-colors ${filtersOpen || activeFilters > 0 ? 'text-val-cyan bg-val-cyan/10' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'}`}
      >
        <ListFilter className="w-5 h-5" />
        {activeFilters > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-val-cyan text-bg-primary text-[10px] font-bold leading-4 text-center">{activeFilters}</span>
        )}
      </button>
      {filtersOpen && (
        <div role="dialog" aria-label="Filters" className="absolute z-30 right-0 mt-1 w-72 rounded-xl border border-bg-elevated bg-bg-card shadow-xl p-3 space-y-3">
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-text-secondary">Side</div>
            <div className="flex rounded-lg border border-bg-elevated overflow-hidden" role="group" aria-label="Side">
              {([null, 'attack', 'defense'] as const).map(value => {
                const on = sideFilter === value
                const n = value ? sideCounts[value] : byAgent.length
                return (
                  <button
                    key={value ?? 'all'}
                    type="button"
                    aria-pressed={on}
                    onClick={() => changeSide(value)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs transition-colors ${
                      on ? (value === 'attack' ? 'bg-val-red/15 text-val-red' : value === 'defense' ? 'bg-val-cyan/15 text-val-cyan' : 'bg-bg-elevated text-text-primary') : 'bg-bg-primary text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {value ? SIDE_LABEL[value] : 'Both'}
                    <span className="font-stats text-[11px] opacity-80">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-text-secondary">Purpose</div>
            {anyPurpose ? (
              <PurposeChips rows={bySide} value={purpose} onPick={setAskedPurpose} />
            ) : (
              <p className="text-xs text-text-muted">None set here yet. Give a line-up a purpose on its card to filter by it.</p>
            )}
          </div>
          {activeFilters > 0 && (
            <button type="button" onClick={clearFilters} className="text-xs text-text-secondary hover:text-val-cyan transition-colors">
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  )

  const list = (
    <div className={`${panel} p-3 space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading font-bold text-xl leading-none">
          <span className="inline-block pb-1.5 border-b-2 border-val-red">Line-ups</span>
        </h2>
        {filterMenu}
      </div>

      {activeFilters > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {sideFilter && (
            <button type="button" onClick={() => changeSide(null)} title="Show both sides" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors">
              {SIDE_LABEL[sideFilter]} <X className="w-3 h-3" />
            </button>
          )}
          {purpose && (
            <button type="button" onClick={() => setAskedPurpose(null)} title="Show every purpose" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors">
              {purposeFilterLabel(purpose)} <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {!state && !error ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-14 rounded-lg bg-bg-elevated/40 animate-pulse" />
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
          <div className="space-y-2">
            {groups.map(group => {
              const ability = abilityOf(group.agent, group.slot)
              const agent = agentOf(group.agent)
              const ids = group.rows.map(row => row.id)
              const allOff = ids.every(id => hidden.has(id))
              const key = `${group.agent}:${group.slot}`
              const colour = sharedLineColor(group.rows)
              // The open line-up's group stays open: its row is what the card describes.
              const shut = folded.has(key) && !group.rows.some(row => row.id === openId)
              return (
                <section key={key} aria-label={`${group.agent}: ${ability.name}`} className="space-y-1.5">
                  <div className="flex items-stretch gap-1">
                    {/* The group's band wears its colour, as a layer group wears its label. */}
                    <div
                      className={`min-w-0 flex-1 flex items-center gap-1 pr-1 rounded-lg border ${colour ? 'border-transparent' : 'bg-bg-primary/60 border-bg-elevated'}`}
                      style={colour ? { backgroundColor: `color-mix(in srgb, ${colour} 30%, transparent)` } : undefined}
                    >
                      <button
                        type="button"
                        aria-expanded={!shut}
                        onClick={() => toggleFold(key)}
                        className="min-w-0 flex-1 flex items-center gap-2.5 pl-2 py-1.5 text-left"
                      >
                        <span className="relative shrink-0 w-7 h-7 flex items-center justify-center">
                          {ability.icon ? <img src={ability.icon} alt="" className="w-6 h-6 object-contain" /> : null}
                          {agent && agentsHere.length > 1 && (
                            <img src={agentIconUrl(agent.uuid)} alt="" className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-bg-primary border border-bg-elevated object-cover" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 font-heading font-semibold text-base leading-tight truncate" style={colour ? { color: `color-mix(in srgb, ${colour} 25%, white)` } : undefined}>
                          {ability.name} <span className="font-sans font-normal text-sm text-text-secondary">({group.rows.length})</span>
                        </span>
                        <ChevronDown className={`w-4 h-4 shrink-0 text-text-secondary transition-transform ${shut ? '' : 'rotate-180'}`} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-expanded={colouring === key}
                        aria-label={`Line colour of every ${ability.name} line-up`}
                        title={colour === undefined ? 'Line colour: its line-ups differ' : colour === null ? 'Line colour: the colour of the ability' : `Line colour: ${colour}`}
                        onClick={() => setColouring(colouring === key ? null : key)}
                        className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors ${colouring === key ? 'bg-black/30' : 'hover:bg-black/20'}`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-full border-2 ${colour === null ? 'border-dashed border-text-muted' : 'border-bg-primary ring-1 ring-text-muted/50'}`}
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
                        className={`shrink-0 w-8 flex items-center justify-center rounded-lg transition-colors ${allOff ? 'text-text-muted hover:text-text-primary' : 'text-val-cyan hover:text-val-cyan/80'}`}
                      >
                        {allOff ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    ) : (
                      <span className="shrink-0 w-8" aria-hidden="true" />
                    )}
                  </div>
                  {colouring === key && (
                    <div className="rounded-lg border border-bg-elevated bg-bg-primary p-2 space-y-1.5">
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
                  {!shut && (
                    <ul className="space-y-1">
                      {group.rows.map(row => {
                        const off = hidden.has(row.id)
                        const picture = bestPicture(row)
                        const on = row.id === openId
                        return (
                          <li key={row.id} className="flex items-stretch gap-1">
                            <button
                              type="button"
                              aria-current={on}
                              onClick={() => {
                                setPlacing(null)
                                select(row.id)
                              }}
                              className={`min-w-0 flex-1 flex items-center gap-2.5 p-1.5 rounded-lg border text-left transition-colors ${
                                on ? 'bg-val-red/10 border-val-red/70 ring-1 ring-val-red/40' : 'bg-bg-primary/40 border-bg-elevated hover:border-val-cyan/30'
                              } ${off && !on ? 'opacity-55' : ''}`}
                            >
                              <span className="relative shrink-0 w-16 h-10 rounded-md overflow-hidden bg-bg-elevated flex items-center justify-center text-text-muted">
                                {picture ? <img src={lineupImageUrl(picture)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : <ImageIcon className="w-4 h-4" aria-hidden="true" />}
                                {row.line_color && <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ backgroundColor: row.line_color }} aria-hidden="true" />}
                              </span>
                              <span className="min-w-0 flex-1 leading-tight">
                                <span className="block text-sm line-clamp-1" title={row.title}>
                                  {row.title}
                                </span>
                                <span className="block text-[11px] text-text-muted line-clamp-1">
                                  {row.land_callout ?? 'No callout'} · {SIDE_LABEL[row.side]}
                                </span>
                              </span>
                              {row.video_url && <Clapperboard className="w-3.5 h-3.5 shrink-0 text-text-muted" aria-label="Has a clip" />}
                            </button>
                            <button
                              type="button"
                              aria-pressed={off}
                              aria-label={off ? `Show ${row.title} on the map` : `Hide ${row.title} from the map`}
                              title={off ? 'Show on the map' : 'Hide from the map'}
                              onClick={() => setHiddenIds(toggled(hidden, [row.id], !off))}
                              className={`shrink-0 w-8 flex items-center justify-center rounded-lg transition-colors ${off ? 'text-text-muted hover:text-text-primary' : 'text-val-cyan hover:text-val-cyan/80'}`}
                            >
                              {off ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </>
      ) : (
        state &&
        !state.tableMissing && (
          <EmptyLine>
            {onMap.length === 0 ? (
              <p>No line-up on {gameMap?.name ?? 'this map'} yet. Press New line-up, pick the ability, then click where you stand and where it lands.</p>
            ) : (
              <>
                <p>Nothing here matches the filters.</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {onOtherSide > 0 && (
                    <button type="button" onClick={() => changeSide(otherSide)} className="text-val-cyan hover:underline">
                      {onOtherSide} on {otherSide} →
                    </button>
                  )}
                  <button type="button" onClick={clearFilters} className="text-val-cyan hover:underline">
                    Clear filters
                  </button>
                </div>
              </>
            )}
          </EmptyLine>
        )
      )}

      {picking ? (
        <AbilityPicker
          agents={agents}
          agent={pickAgent}
          onAgent={setPickAgent}
          side={newSide}
          onSide={setNewSide}
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
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-val-cyan/10 text-val-cyan border border-val-cyan/50 rounded-lg hover:bg-val-cyan/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="font-heading font-bold text-lg">New line-up</span>
        </button>
      )}
    </div>
  )

  return (
    <div className={full ? '-mx-4 -my-6 h-[calc(100vh-57px)] flex flex-col bg-bg-primary' : 'max-w-[1600px] mx-auto space-y-4'} data-lineups-full={full}>
      {full ? (
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-b border-bg-elevated">
          <div className="flex items-baseline gap-3">
            <Link to={back.to} className="text-sm text-text-secondary hover:text-val-cyan transition-colors">
              {back.label}
            </Link>
            <h1 className="font-display italic font-extrabold uppercase text-2xl leading-none">Line-ups</h1>
            <SaveBadge state={saveState} />
          </div>
          <button
            type="button"
            aria-pressed
            title="Leave full screen (F)"
            onClick={toggleFull}
            className="inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm bg-val-cyan/15 text-val-cyan border-val-cyan/40 transition-colors"
          >
            <Minimize2 className="w-4 h-4" />
            <span>Exit full screen</span>
          </button>
        </div>
      ) : (
        <LineupsHeader back={back} right={<SaveBadge state={saveState} />} />
      )}

      {state?.tableMissing && (
        <div className={`border border-val-yellow/30 bg-val-yellow/10 text-sm rounded-md px-3 py-2 ${full ? 'mx-3 mt-2' : ''}`}>
          The line-ups table is not in the database yet. Run <code className="font-stats">supabase/migrations/20261124_lineups.sql</code> in the Supabase SQL editor, then reload.
        </div>
      )}
      {error && <div className={`border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2 ${full ? 'mx-3 mt-2' : ''}`}>{error}</div>}

      <div className={full ? 'flex-1 min-h-0 flex' : 'grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_minmax(360px,420px)] gap-4 items-start'}>
        {/* The map and agent, and the list */}
        <div className={full ? `w-[320px] shrink-0 overflow-y-auto p-3 space-y-3 border-r border-bg-elevated ${panelsOff ? 'hidden' : ''}` : 'space-y-3 order-2 lg:order-1'}>
          {pickers}
          {list}
        </div>

        {/* The map */}
        <div className={full ? 'relative flex-1 min-w-0 min-h-0' : `order-1 lg:order-2 space-y-2 ${panel} p-2`}>
          <div
            style={{ backgroundColor: skin.back }}
            className={full ? 'absolute inset-0 overflow-hidden' : 'relative w-full aspect-square max-h-[calc(100vh-8rem)] mx-auto rounded-lg overflow-hidden'}
          >
            {!registry && status === 'loading' ? (
              <div className="absolute inset-3 rounded-xl bg-bg-card animate-pulse" aria-hidden="true" />
            ) : gameMap ? (
              <div className="absolute inset-2">
                <PlayCanvas
                  key={`${gameMap.uuid}:${drawSide}`}
                  map={gameMap}
                  side={drawSide}
                  step={step}
                  previous={null}
                  tool={placing && !placing.stand ? 'pin' : 'select'}
                  pending={placing?.stand ? { agent: placing.agent, slot: placing.slot } : null}
                  selectedId={placing ? null : (openId ?? null)}
                  showCallouts
                  showNames={false}
                  skin={skinId}
                  animate={false}
                  flyThrows
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
                    <span>
                      {placing.stand ? `${placingAbility.name}: click where it lands` : `${placingAbility.name}: click where you stand`} · {SIDE_LABEL[placing.side]}
                    </span>
                    <button type="button" onClick={() => setPlacing(null)} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">No map can be drawn right now.</div>
            )}
            {/* The map's own controls, in its corner: the skin, and filling the window. */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
              <SkinPicker
                skin={skinId}
                onPick={setSkinId}
                cycleKey={false}
                buttonClass="inline-flex items-center gap-1.5 bg-bg-primary/85 border border-bg-elevated rounded-lg px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
              />
              {!full && (
                <button
                  type="button"
                  title="Full screen (F)"
                  aria-label="Full screen"
                  onClick={toggleFull}
                  className="inline-flex items-center justify-center w-8 h-8 bg-bg-primary/85 border border-bg-elevated rounded-lg text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {full && (
            <p className="absolute bottom-2 left-3 px-2 py-1 rounded-md bg-bg-primary/70 text-[11px] text-text-muted pointer-events-none">
              Tab {panelsOff ? 'shows' : 'hides'} the panels · F or Esc leaves full screen
            </p>
          )}
          <p className={`text-[11px] text-text-muted text-center pb-1 ${full ? 'hidden' : ''}`}>
            Scroll to zoom. Drag the ability to move where it lands and the pin to move where you stand. On an open line-up, press a + on the line to add a bend and drag it; press a bend twice to remove it.
          </p>
        </div>

        {/* The card: in full screen it takes room only while a line-up is open. */}
        <div className={full ? `w-[420px] shrink-0 overflow-y-auto p-3 border-l border-bg-elevated ${panelsOff || !open ? 'hidden' : ''}` : 'order-3'}>
          {open && openAbility ? (
            <LineupCard
              key={open.id}
              lineup={open}
              startEditing={open.id === fresh}
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
              <p>{openId && state && !open ? 'That line-up is not in your library.' : 'Pick a line-up on the map or in the list to open its pictures, recipe and clip.'}</p>
            </EmptyLine>
          )}
        </div>
      </div>
    </div>
  )
}
