import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import PlayCanvas, { type PlayCanvasHandle, type PlayCanvasProps, type Tool } from '../components/PlayCanvas'
import AbilityPopover from '../components/play/AbilityPopover'
import AgentStrip, { type AgentRole } from '../components/play/AgentStrip'
import { SplitterHandle, useSplitter } from '../components/ColumnSplitter'
import BriefDrawer, { type ComposeFailure } from '../components/play/BriefDrawer'
import EditorRail from '../components/play/EditorRail'
import EditorToolbar from '../components/play/EditorToolbar'
import PlaybookPanel from '../components/play/PlaybookPanel'
import ReplayTransport, { type ReplayClock, type ReplayView } from '../components/play/ReplayTransport'
import { useGameContent, useGameContentNames } from '../hooks/useGameContent'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { abilitiesForComp } from '../lib/composeAbilities'
import { composePlay, ComposerNotConfiguredError } from '../lib/composePlay'
import type { GameAgent } from '../lib/gameContent'
import {
  controlShare,
  emptyGrid,
  instantControl,
  presencesOf,
  sigmaFor,
  simulateControl,
  type ControlGrid,
  type ControlShare,
} from '../lib/mapControl'
import { useMapMask } from '../lib/mapMask'
import {
  copyStep,
  elementAt,
  emptyPlayDoc,
  newId,
  parsePlayDoc,
  PlayDocError,
  withElement,
  withoutElement,
  type AbilitySlot,
  type AgentElement,
  type PlayDoc,
  type PlayStep,
  type Team,
} from '../lib/playDoc'
import { canRedo, canUndo, historyOf, pushHistory, redoHistory, undoHistory, type History } from '../lib/playHistory'
import { sceneTurns, sceneViewport, viewToImage } from '../lib/playScene'
import { PLAY_TEMPLATES, mapSites, templateById, templateDoc, templateScaffold, type PlayTemplate } from '../lib/playTemplates'
import { createPlay, deletePlay, getPlay, updatePlay, type PlayInput } from '../lib/plays'
import type { ReplayBundle, ReplayRound } from '../lib/replayBundle'
import {
  createFrameIds,
  formatRoundClock,
  frameStep,
  roundAt,
  roundSide,
  roundSpan,
  roundTicks,
  type FrameIds,
} from '../lib/replayFrame'
import { replayContext, replayRoundToPlay, type ReplayContext } from '../lib/replayMatches'
import { getReplayBundle } from '../lib/replays'
import type { ReplayPlay } from '../lib/replayToPlay'
import type { PlaySide } from '../lib/types'
import { createValueStore, type ValueStore } from '../lib/valueStore'

/** A boolean kept per device; the fallback when storage is blocked or empty. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* a flag is not worth an error */
  }
}

const UNTITLED = 'Untitled play'
const DEFAULT_SPEED_MS = 1800
const SAVED_FLASH_MS = 1500
const HINT_MS = 2500
const TITLE_MAX = 60
const MAX_STEPS = 10
const MAX_COMP = 5

/** The role filter's keys, 1 to 4. */
const ROLE_KEYS: AgentRole[] = ['Duelist', 'Initiator', 'Controller', 'Sentinel']

const TOOL_KEYS: Record<string, Tool> = { v: 'select', p: 'pen', a: 'arrow', t: 'text', e: 'eraser' }

/** Space let go within this toggles playback; held longer, it was the canvas' pan key. */
const SPACE_TAP_MS = 300

/** How often the replay's clock and scrubber follow the playing frame (§2.8). */
const CLOCK_MS = 50
/** What `,` and `.` move the replay by. */
const NUDGE_MS = 1000
/** A tick this close to a captured moment names it in the step's caption. */
const TICK_NEAR_MS = 2000
const TOAST_MS = 1500

/** What a new step at this index is called, per side, before falling back to "Step N". */
const STEP_NAMES: Record<PlaySide, string[]> = {
  attack: ['Setup', 'Execute', 'Post-plant'],
  defense: ['Setup', 'Hold', 'Retake'],
}

const card = 'bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3'
const errorBox = 'border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2'

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Registry agent names the brief mentions, in the order written, at most five:
 * the comp for a blank play when the composer cannot run. Whole words only, so
 * "Sage" does not match inside "message".
 */
function agentsInBrief(brief: string, names: string[]): string[] {
  const hits: { name: string; at: number }[] = []
  for (const name of names) {
    const at = brief.search(new RegExp(`(?<![a-z0-9])${escapeRegExp(name)}(?![a-z0-9])`, 'i'))
    if (at !== -1) hits.push({ name, at })
  }
  return hits
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_COMP)
    .map(h => h.name)
}

/** Inputs, text areas, selects and editable text keep their keys: the editor's shortcuts stay out. */
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable)

/** The Playbook panel runs its own player: Space and the arrows there are its keys, not the editor's. */
const inPlaybookPanel = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[data-playbook-panel]') !== null

const PLAYBOOK_OPEN_KEY = 'plays.playbookOpen'

function readPlaybookOpen(): boolean {
  try {
    return window.localStorage.getItem(PLAYBOOK_OPEN_KEY) === 'true'
  } catch {
    // Private mode or blocked storage: the panel starts closed.
    return false
  }
}

/** Tailwind's `lg`: the editor is a grid with side columns from here up, stacked below. */
const LG_QUERY = '(min-width: 64rem)'
/** The canvas column never gets narrower than this while a side panel is dragged. */
const CANVAS_MIN_PX = 420

/** The rendered width of the editor grid's column marked `data-plays-column={name}`; 0 when hidden. */
function columnWidth(grid: HTMLElement, name: 'rail' | 'playbook' | 'drawer'): number {
  const el = grid.querySelector(`:scope > [data-plays-column="${name}"]`)
  return el ? el.getBoundingClientRect().width : 0
}

function persistPlaybookOpen(open: boolean) {
  try {
    window.localStorage.setItem(PLAYBOOK_OPEN_KEY, String(open))
  } catch {
    /* ignore — a panel's open state is not worth an error */
  }
}

const snapshotOf = (s: { title: string; map: string; side: PlaySide; brief: string; doc: PlayDoc }) =>
  JSON.stringify({ ...s, comp: s.doc.comp })

const hasElements = (doc: PlayDoc) => doc.steps.some(s => s.elements.length > 0)

/** The doc with at least one step: the canvas always draws one. */
function ensureStep(doc: PlayDoc, side: PlaySide): PlayDoc {
  if (doc.steps.length > 0) return doc
  return { ...doc, steps: [{ id: newId(), name: STEP_NAMES[side][0], caption: '', elements: [] }] }
}

/**
 * The comp without the allies no step shows any more, so deleting an agent
 * everywhere frees its comp slot. Called only after something was removed:
 * a composed comp agent the model left off the map is not dropped by a drag.
 */
function pruneComp(doc: PlayDoc): PlayDoc {
  const comp = doc.comp.filter(name =>
    doc.steps.some(s => s.elements.some(e => e.kind === 'agent' && e.team === 'ally' && sameName(e.agent, name))),
  )
  return comp.length === doc.comp.length ? doc : { ...doc, comp }
}

/** True when an element of `before` is missing from `after`. */
const lostElements = (before: PlayStep, after: PlayStep) =>
  before.elements.some(e => !after.elements.some(n => n.id === e.id))

/** The untouched blank play of this side: switching side swaps it for the other side's. */
function isPristine(doc: PlayDoc, side: PlaySide): boolean {
  if (hasElements(doc) || doc.comp.length > 0 || doc.summary || doc.assumptions.length > 0) return false
  const blank = emptyPlayDoc([], side)
  return (
    doc.steps.length === blank.steps.length &&
    doc.steps.every((s, i) => s.name === blank.steps[i].name && s.caption === blank.steps[i].caption)
  )
}

// ── Replay mode (§2.8) ──────────────────────────────────────────────────────

/** A match open in the replay mode, with what its frames are built from, made once per bundle. */
interface OpenReplay extends ReplayContext {
  matchId: string
  bundle: ReplayBundle
  /** Stable element ids per player, effect and plant, so the canvas keys them across frames. */
  ids: FrameIds
  /** A player's agent name, for the ticks and the captions. */
  nameOf(subject: string): string
}

/** The paused frame once edited, and whether this version of it is already a step. */
interface LiveFrame {
  step: PlayStep
  captured: boolean
}

/** What the frame store holds: the replay's frame and its map-control grid (§2.9), null with the overlay off. */
interface ReplayFrame {
  step: PlayStep
  control: ControlGrid | null
}

/**
 * The replay's map-control grid (§2.9): one per round, simulated up to
 * `simulatedTo`. A new match, round or mask, or a time before `simulatedTo`
 * (a backwards scrub, a jump), starts it over from the round's buy start.
 */
interface ReplayControl {
  bundle: ReplayBundle
  roundN: number
  grid: ControlGrid
  simulatedTo: number
}

/**
 * The replay's grid at `t` inside `round`, advanced in place from where it was
 * left (or started over, see `ReplayControl`). Started over from the buy start,
 * it is a few hundred 0.03 ms ticks at most: cheap enough for one frame.
 */
function advanceControl(
  held: { current: ReplayControl | null },
  open: OpenReplay,
  round: ReplayRound,
  t: number,
  mask: Uint8Array,
): ControlGrid {
  let at = held.current
  if (!at || at.bundle !== open.bundle || at.roundN !== round.n || at.grid.mask !== mask || t < at.simulatedTo) {
    // From the scrubber's start, like `controlTimeline`, so the readout and the track agree.
    at = { bundle: open.bundle, roundN: round.n, grid: emptyGrid(mask), simulatedTo: roundSpan(open.bundle, round).start }
    held.current = at
  }
  simulateControl(open.bundle, round, at.simulatedTo, t, at.grid, open.transform)
  at.simulatedTo = t
  return at.grid
}

/** Round 1, where a match opens. */
const firstRound = (bundle: ReplayBundle): ReplayRound => bundle.rounds.find(r => r.n === 1) ?? bundle.rounds[0]

/** A round's barrier drop: where a jump to the round lands. */
const barrierOf = (bundle: ReplayBundle, round: ReplayRound): number =>
  roundTicks(bundle, round).find(t => t.kind === 'barrier')?.t ?? roundSpan(bundle, round).start

/** The round's side and how it went, for a caption no tick explains: "attack, won by elimination". */
function roundFacts(round: ReplayRound): string {
  const result = round.winner === 'ALLY' ? 'won' : round.winner === 'ENEMY' ? 'lost' : null
  const how = round.how ? round.how.replace(/_/g, ' ').toLowerCase() : null
  return result ? `${roundSide(round)}, ${result}${how ? ` by ${how}` : ''}` : roundSide(round)
}

/**
 * A captured frame's allies joined to the comp while it has room. One left
 * over is dropped from the step: a saved play with an ally outside the comp
 * would not open again.
 */
function fitComp(comp: string[], step: PlayStep): { comp: string[]; step: PlayStep } {
  const next = [...comp]
  const inComp = (name: string) => next.some(c => sameName(c, name))
  for (const e of step.elements) {
    if (e.kind === 'agent' && e.team === 'ally' && !inComp(e.agent) && next.length < MAX_COMP) next.push(e.agent)
  }
  const elements = step.elements.filter(e => e.kind !== 'agent' || e.team !== 'ally' || inComp(e.agent))
  return { comp: next, step: elements.length === step.elements.length ? step : { ...step, elements } }
}

const noSubscribe = () => () => {}

/**
 * The canvas, fed from the frame store when one is given: a playing replay
 * renders this and the canvas each animation frame and leaves the rest of the
 * editor alone (§2.8). The store's map-control grid goes with its frame
 * (§2.9). `edited`, the paused frame once changed, is drawn over the store's
 * frame, which still lends it the grid: the edits are what-ifs over the
 * space really held. Without a store, or before its first frame, it draws the
 * step and the grid it is given. The page keeps one of these mounted in both
 * views, so the canvas keeps its zoom across them.
 */
function FrameCanvas({
  frames,
  edited,
  step,
  control,
  ref,
  ...props
}: PlayCanvasProps & {
  frames: ValueStore<ReplayFrame | null> | null
  edited?: PlayStep | null
  ref?: Ref<PlayCanvasHandle>
}) {
  const frame = useSyncExternalStore(frames?.subscribe ?? noSubscribe, () => frames?.get() ?? null)
  return <PlayCanvas ref={ref} {...props} step={edited ?? frame?.step ?? step} control={frame ? frame.control : control} />
}

/**
 * `/plays/new` and `/plays/:id`. A play created here keeps its editor: the URL
 * becomes `/plays/:id` but the state, the step shown and the "Saved" flash
 * stay. Any other change of route mounts a fresh editor.
 */
export default function PlayDesigner() {
  const { id } = useParams()
  const [createdId, setCreatedId] = useState<string | null>(null)
  const loadId = id && id !== createdId ? id : undefined
  return <Designer key={loadId ?? 'new'} loadId={loadId} onCreated={setCreatedId} />
}

/** `failed` is a load error: the editor stays closed so a blank state cannot be saved over the play. */
type LoadState = 'loading' | 'ready' | 'missing' | 'failed'

/**
 * The v2 editor (docs/plays-editor-v2.md §2.5): the map fills the middle, the
 * rail on the left drives steps and tools, the strip at the bottom places
 * agents and their abilities, and the brief and composer sit in the drawer.
 * Every change of the play goes through `commitWith`, which keeps the undo stack.
 */
function Designer({ loadId, onCreated }: { loadId: string | undefined; onCreated(id: string): void }) {
  const navigate = useNavigate()
  const { registry, status: registryStatus } = useGameContent()
  const { mapNames } = useGameContentNames()
  // `/plays/new?template=retake&site=B`, or `?replay=<match id>` (the replay mode, at
  // `&round=7`'s barrier when given; `&mode=steps` imports that round's snapshots instead),
  // read once: applied when the map (the registry, for a replay) is known, then cleared.
  const [searchParams, setSearchParams] = useSearchParams()
  const [deepLink] = useState(() => ({
    template: searchParams.get('template'),
    site: searchParams.get('site'),
    replay: searchParams.get('replay'),
    round: searchParams.get('round'),
    mode: searchParams.get('mode'),
  }))
  const deepLinked = useRef(false)

  const [load, setLoad] = useState<LoadState>(loadId ? 'loading' : 'ready')
  const [savedId, setSavedId] = useState<string | null>(loadId ?? null)
  const [title, setTitle] = useState(UNTITLED)
  // '' until picked or loaded: a new play falls back to the registry's first map.
  const [mapPick, setMapPick] = useState('')
  const [side, setSide] = useState<PlaySide>('attack')
  const [brief, setBrief] = useState('')
  const [history, setHistory] = useState<History<PlayDoc>>(() => historyOf(emptyPlayDoc([], 'attack')))
  const [composedWith, setComposedWith] = useState<string | null>(null)
  /** What was last saved; null for a play never saved, which counts as unsaved. */
  const [snapshot, setSnapshot] = useState<string | null>(null)

  const [stepIndex, setStepIndex] = useState(0)
  const [tool, setTool] = useState<Tool>('select')
  const [pending, setPending] = useState<{ agent: string; slot: AbilitySlot } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [team, setTeam] = useState<Team>('ally')
  const [role, setRole] = useState<AgentRole | null>(null)
  /** The agent whose ability popover is open. */
  const [popoverAgent, setPopoverAgent] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(!loadId)
  const [playbookOpen, setPlaybookOpen] = useState(readPlaybookOpen)
  // On by default, saved plays included: the callout names are how a play is read. Remembered per device.
  const [showCallouts, setShowCalloutsState] = useState(() => readFlag('plays.showCallouts', true))
  const setShowCallouts = (next: boolean | ((prev: boolean) => boolean)) =>
    setShowCalloutsState(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      writeFlag('plays.showCallouts', value)
      return value
    })
  // The map-control overlay (§2.9), on by default and remembered per device like the callouts.
  const [showControl, setShowControlState] = useState(() => readFlag('plays.showControl', true))
  const toggleControl = () =>
    setShowControlState(prev => {
      writeFlag('plays.showControl', !prev)
      return !prev
    })
  const [playing, setPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS)
  /** False while an arrow key is held down: the steps flick by without the walk animation. */
  const [animate, setAnimate] = useState(true)
  const [unresolved, setUnresolved] = useState<string[]>([])
  const [hint, setHint] = useState<string | null>(null)

  // Replay mode (§2.8). The replay time lives in `replayMsRef`; the page renders when the
  // mode, the view or the playing state changes, never per frame.
  const [replay, setReplay] = useState<OpenReplay | null>(null)
  /** The match the play was built from (`doc.replay`): kept after Exit, so it saves and reopens. */
  const [replayLink, setReplayLink] = useState<string | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [live, setLive] = useState<LiveFrame | null>(null)
  const [view, setView] = useState<ReplayView>('replay')
  const [openingReplay, setOpeningReplay] = useState(false)
  /** "Step captured", over the canvas for a moment. */
  const [toast, setToast] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [composing, setComposing] = useState(false)
  const [composeError, setComposeError] = useState<ComposeFailure | null>(null)

  /** The canvas keeps its own zoom: the page's `+` / `-` / `0` keys and the strip's placement ask it. */
  const canvas = useRef<PlayCanvasHandle>(null)
  /** When Space went down (event time), until its keyup decides whether it was a tap. */
  const spaceDownAt = useRef<number | null>(null)

  /** The replay time, ms: the loop advances it, every replay action reads it. */
  const replayMsRef = useRef(0)
  /**
   * The round shown, set by every jump. Kept rather than read back from the
   * time: a round without an end runs to the next one's buy start, which
   * `roundAt` already counts as the next round.
   */
  const replayRoundRef = useRef<ReplayRound | null>(null)
  /** Bumped by every jump of the replay time: a frame loop started before it stops. */
  const replayEpoch = useRef(0)
  /** The replay's frame and its control grid, each animation frame while it plays: only the canvas reads it. */
  const [frames] = useState(() => createValueStore<ReplayFrame | null>(null))
  /** The replay time, round and control share a few times a second while it plays, and on every jump: only the transport reads it. */
  const [clock] = useState(() => createValueStore<ReplayClock | null>(null))
  /** The replay's map-control grid, advanced by the frame loop and every jump (§2.9). */
  const replayControl = useRef<ReplayControl | null>(null)

  // Resizable side panels (lg and up). Each panel's room is the grid less the rail and the
  // other panel when it is open: the grid has no flex-grow for the hook to read, and its
  // agent strip spans every column. A closed panel or a stacked layout is not re-clamped.
  const isLg = useMediaQuery(LG_QUERY)
  const editorGrid = useRef<HTMLDivElement>(null)
  const playbookRoom = useCallback(() => {
    const grid = editorGrid.current
    if (!grid || !isLg || !playbookOpen) return Number.POSITIVE_INFINITY
    return grid.clientWidth - columnWidth(grid, 'rail') - (drawerOpen ? columnWidth(grid, 'drawer') : 0)
  }, [isLg, playbookOpen, drawerOpen])
  const drawerRoom = useCallback(() => {
    const grid = editorGrid.current
    if (!grid || !isLg || !drawerOpen) return Number.POSITIVE_INFINITY
    return grid.clientWidth - columnWidth(grid, 'rail') - (playbookOpen ? columnWidth(grid, 'playbook') : 0)
  }, [isLg, playbookOpen, drawerOpen])
  const playbookSplit = useSplitter({
    initialWidth: 400,
    minWidth: 280,
    maxWidth: 900,
    storageKey: 'plays.playbookWidth',
    side: 'left',
    minOtherSide: CANVAS_MIN_PX,
    available: playbookRoom,
    label: 'Resize the playbook panel',
  })
  const drawerSplit = useSplitter({
    initialWidth: 360,
    minWidth: 280,
    maxWidth: 720,
    storageKey: 'plays.drawerWidth',
    side: 'right',
    minOtherSide: CANVAS_MIN_PX,
    available: drawerRoom,
    label: 'Resize the brief',
  })
  const playbookSized = isLg && playbookOpen
  const drawerSized = isLg && drawerOpen

  const doc = history.present
  const map = mapPick || (loadId ? '' : (mapNames[0] ?? ''))
  const gameMap = map ? registry?.maps.byName.get(map.trim().toLowerCase()) : undefined
  const mapDrawable = Boolean(gameMap?.transform && gameMap.callouts.length > 0)
  const sites = useMemo(() => mapSites(gameMap?.callouts ?? []), [gameMap])
  const registryAgents = useMemo(() => (registry ? [...registry.agents.byId.values()] : []), [registry])
  const agentByName = (name: string): GameAgent | undefined => registry?.agents.byName.get(name.trim().toLowerCase())

  const stepCount = doc.steps.length
  const stepAt = Math.min(stepIndex, Math.max(0, stepCount - 1))
  const step: PlayStep | undefined = doc.steps[stepAt]
  const previous = stepAt > 0 ? doc.steps[stepAt - 1] : null
  const isPlaying = playing && stepCount > 1
  const empty = !hasElements(doc)
  /** The canvas shows the replay rather than a step of the play. */
  const inReplay = replay !== null && view === 'replay'

  /** The map's playable cells, for the control overlay (§2.9); null while it loads. */
  const mask = useMapMask(gameMap)
  /** On a designed or captured step, the overlay is the steady state of its agents; the replay view's comes with its frame. */
  const stepControl = useMemo(() => {
    const transform = gameMap?.transform
    if (!showControl || inReplay || !mask || !step || !gameMap || !transform) return null
    return instantControl(mask, presencesOf(step, gameMap.callouts, transform), sigmaFor(transform))
  }, [showControl, inReplay, mask, step, gameMap])
  /**
   * The mask a replay's overlay runs on: the map's, with the overlay on, once
   * the map shown is the replay's own (opening a match switches the map, and
   * its mask loads after).
   */
  const controlMaskFor = (open: OpenReplay | null): Uint8Array | null => {
    if (!showControl || !mask || !open) return null
    const own = open.bundle.match.mapUuid ? registry?.maps.byId.get(open.bundle.match.mapUuid) : undefined
    return own && own !== gameMap ? null : mask
  }
  const replayMask = controlMaskFor(replay)

  /** What Save writes: the doc, with the match it was built from. */
  const savedDoc: PlayDoc = replayLink ? { ...doc, replay: { matchId: replayLink } } : doc
  const dirty = snapshotOf({ title, map, side, brief, doc: savedDoc }) !== snapshot

  // ── History ───────────────────────────────────────────────────────────────

  /** Every change of the play: pushed on the undo stack. A key coalesces a run of typing into one step. */
  const commitWith = (fn: (d: PlayDoc) => PlayDoc, key: string | null = null) =>
    setHistory(h => pushHistory(h, fn(h.present), key))

  const commit = (next: PlayDoc) => commitWith(() => next)

  /** The active step through `fn`, by id so playback moving on cannot hit the wrong one. */
  const editStep = (fn: (s: PlayStep) => PlayStep, key: string | null = null, prune = false) => {
    const stepId = step?.id
    commitWith(d => {
      const next = { ...d, steps: d.steps.map(s => (s.id === stepId ? fn(s) : s)) }
      return prune ? pruneComp(next) : next
    }, key)
  }

  const undo = () => {
    setHistory(undoHistory)
    setSelectedId(null)
    setPending(null)
  }

  const redo = () => {
    setHistory(redoHistory)
    setSelectedId(null)
    setPending(null)
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!loadId) return
    let cancelled = false
    getPlay(loadId)
      .then(play => {
        if (cancelled) return
        if (!play) {
          setLoad('missing')
          return
        }
        let parsed: PlayDoc | null = null
        if (play.play != null) {
          try {
            parsed = parsePlayDoc(play.play)
          } catch (e) {
            if (!(e instanceof PlayDocError)) throw e
            // Shown, and the doc left blank so the user can recompose from the brief.
            setError(e.message)
          }
        }
        const loaded = ensureStep(parsed ?? emptyPlayDoc([], play.side), play.side)
        setTitle(play.title)
        setMapPick(play.map)
        setSide(play.side)
        setBrief(play.brief)
        setHistory(historyOf(loaded))
        setReplayLink(loaded.replay?.matchId ?? null)
        setComposedWith(play.composed_with)
        // A play with something drawn opens on the map; an empty one on its brief.
        setDrawerOpen(!hasElements(loaded))
        setSnapshot(snapshotOf({ title: play.title, map: play.map, side: play.side, brief: play.brief, doc: loaded }))
        setLoad('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(messageOf(e))
        setLoad('failed')
      })
    return () => {
      cancelled = true
    }
  }, [loadId])

  // Playback loops through the steps until paused or a step is picked.
  useEffect(() => {
    if (!isPlaying) return
    const timer = setInterval(() => setStepIndex(i => (Math.min(i, stepCount - 1) + 1) % stepCount), speedMs)
    return () => clearInterval(timer)
  }, [isPlaying, stepCount, speedMs])

  useEffect(() => {
    if (!savedFlash) return
    const timer = setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
    return () => clearTimeout(timer)
  }, [savedFlash])

  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(null), HINT_MS)
    return () => clearTimeout(timer)
  }, [hint])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // The replay plays: wall time × speed, a frame per animation frame into the canvas' store
  // with the control grid advanced to it (§2.9), the clock and the share every 50 ms, until
  // the end of the round shown, where it pauses.
  useEffect(() => {
    if (!replay || !replayPlaying) return
    const { bundle, lookup, transform, ids } = replay
    const round = replayRoundRef.current ?? roundAt(bundle, replayMsRef.current)
    const { end } = roundSpan(bundle, round)
    const epoch = replayEpoch.current
    let raf = 0
    let last: number | null = null
    let clockAt = Number.NEGATIVE_INFINITY
    let share: ControlShare | null = clock.get()?.share ?? null
    const tick = (now: number) => {
      if (replayEpoch.current !== epoch) return
      const t = Math.min(end, replayMsRef.current + (last === null ? 0 : (now - last) * replaySpeed))
      last = now
      replayMsRef.current = t
      const control = replayMask ? advanceControl(replayControl, replay, round, t, replayMask) : null
      frames.set({ step: frameStep(bundle, t, lookup, transform, ids, round), control })
      const over = t >= end
      if (over || now - clockAt >= CLOCK_MS) {
        share = control ? controlShare(control) : null
        clock.set({ ms: t, round, share })
        clockAt = now
      }
      if (over) setReplayPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      // Paused: the clock shows the very frame the canvas holds.
      if (replayEpoch.current === epoch) clock.set({ ms: replayMsRef.current, round, share })
    }
  }, [replay, replayPlaying, replaySpeed, replayMask, frames, clock])

  // Paused, the overlay follows the toggle and the mask (which loads after the replay opens)
  // on the frame shown; an edited frame keeps it, drawn as of the replay time.
  useEffect(() => {
    if (!replay || replayPlaying) return
    const shown = frames.get()
    if (!shown) return
    const t = replayMsRef.current
    const round = replayRoundRef.current ?? roundAt(replay.bundle, t)
    const control = replayMask ? advanceControl(replayControl, replay, round, t, replayMask) : null
    if (control === shown.control) return
    frames.set({ step: shown.step, control })
    clock.set({ ms: t, round, share: control ? controlShare(control) : null })
  }, [replay, replayPlaying, replayMask, frames, clock])

  // ── Steps ─────────────────────────────────────────────────────────────────

  /** A step from the rail or the arrows; with a replay open it pauses it and shows the step. */
  const pickStep = (i: number) => {
    setPlaying(false)
    setStepIndex(Math.max(0, Math.min(stepCount - 1, i)))
    if (replay) {
      setReplayPlaying(false)
      setView('steps')
    }
  }

  /** A copy of the active step (ids kept, so agents walk) right after it. */
  const addStep = () => {
    if (!step || stepCount >= MAX_STEPS) return
    const at = stepAt + 1
    const added = copyStep(step, STEP_NAMES[side][at] ?? `Step ${at + 1}`)
    commitWith(d => ({ ...d, steps: [...d.steps.slice(0, at), added, ...d.steps.slice(at)] }))
    setPlaying(false)
    setStepIndex(at)
  }

  const removeStep = (i: number) => {
    if (stepCount <= 1) return
    const stepId = doc.steps[i]?.id
    commitWith(d => pruneComp({ ...d, steps: d.steps.filter(s => s.id !== stepId) }))
    setPlaying(false)
    setStepIndex(i < stepAt ? stepAt - 1 : Math.min(stepAt, stepCount - 2))
  }

  const clearStep = () => {
    editStep(s => ({ ...s, elements: [] }), null, true)
    setSelectedId(null)
    setPending(null)
  }

  const clearAll = () => {
    commitWith(d => pruneComp({ ...d, steps: d.steps.map(s => ({ ...s, elements: [] })) }))
    setSelectedId(null)
    setPending(null)
  }

  // ── Map edits ─────────────────────────────────────────────────────────────

  const onCanvasChange = (next: PlayStep) => {
    commitWith(d => {
      const before = d.steps.find(s => s.id === next.id)
      if (!before) return d
      const changed = { ...d, steps: d.steps.map(s => (s.id === next.id ? next : s)) }
      return lostElements(before, next) ? pruneComp(changed) : changed
    })
  }

  /** What the canvas shows: the active step, or in the replay view the edited frame, else the frame. */
  const shownStep = (): PlayStep | undefined => (inReplay ? (live?.step ?? frames.get()?.step) : step)

  /**
   * An edit of the paused replay frame. The first copies the frame into the
   * live frame with a step id of its own and its replay time; the next ones
   * edit that copy. Not on the undo stack: Capture is what enters the play.
   */
  const onFrameChange = (next: PlayStep) => {
    const t = replayMsRef.current
    setLive(l => ({ step: l ? next : { ...next, id: newId(), replayMs: t }, captured: false }))
  }

  /** An edit of what the canvas shows: the active step through history, or the paused frame. None while a replay plays. */
  const editShown = (fn: (s: PlayStep) => PlayStep, prune = false) => {
    if (!inReplay) {
      editStep(fn, null, prune)
      return
    }
    const base = replayPlaying ? undefined : shownStep()
    if (base) onFrameChange(fn(base))
  }

  /** From the drawer's list, which is the active step's. */
  const removeElement = (id: string) => {
    editStep(s => withoutElement(s, id), null, true)
    if (selectedId === id) setSelectedId(null)
  }

  /** Delete / Backspace: the selection off what the canvas shows, the paused replay frame included. */
  const removeShown = (id: string) => {
    if (inReplay && replayPlaying) return
    editShown(s => withoutElement(s, id), true)
    if (selectedId === id) setSelectedId(null)
  }

  /** Selecting an agent on the map opens its abilities; clicking empty map closes them unless one is armed. */
  const onCanvasSelect = (id: string | null) => {
    setSelectedId(id)
    const shown = shownStep()
    const el = id && shown ? elementAt(shown, id) : null
    if (el?.kind === 'agent') setPopoverAgent(el.agent)
    else if (id === null && !pending) setPopoverAgent(null)
  }

  const chooseTool = (next: Tool) => {
    setTool(next)
    setPending(null)
  }

  /**
   * A tile of the strip: an agent already on the map for the current team is
   * selected; otherwise it is placed at the middle of the view, joining the
   * comp when it is an ally. A sixth ally is refused, not placed: a saved play
   * with an ally outside the comp would not open again. On a paused replay
   * frame the agent joins the frame, and the comp when the frame is captured.
   */
  const pickAgent = (agent: GameAgent) => {
    const shown = shownStep()
    if (!shown || !gameMap || (inReplay && replayPlaying)) return
    const existing = shown.elements.find(
      (e): e is AgentElement => e.kind === 'agent' && e.team === team && sameName(e.agent, agent.name),
    )
    if (existing) {
      setSelectedId(existing.id)
      setPopoverAgent(existing.agent)
      return
    }
    const compName = doc.comp.find(name => sameName(name, agent.name))
    if (!inReplay && team === 'ally' && !compName && doc.comp.length >= MAX_COMP) {
      setHint('Comp is full')
      return
    }
    // The middle of what the canvas shows, zoomed or not; the map's centre before it is mounted.
    const centre =
      canvas.current?.visibleCentre() ?? viewToImage(sceneViewport(gameMap), 500, 500, sceneTurns(gameMap, side))
    const el: AgentElement = {
      kind: 'agent',
      id: newId(),
      agent: compName ?? agent.name,
      team,
      at: { u: centre.u, v: centre.v },
    }
    if (inReplay) {
      onFrameChange(withElement(shown, el))
    } else {
      const joins = team === 'ally' && !compName
      const stepId = shown.id
      commitWith(d => ({
        ...d,
        comp: joins ? [...d.comp, agent.name] : d.comp,
        steps: d.steps.map(s => (s.id === stepId ? withElement(s, el) : s)),
      }))
    }
    setSelectedId(el.id)
    setPopoverAgent(el.agent)
    setPending(null)
  }

  // ── Drawer edits ──────────────────────────────────────────────────────────

  const setNote = (id: string, note: string) =>
    editStep(s => {
      const el = elementAt(s, id)
      return el?.kind === 'agent' ? withElement(s, { ...el, note: note || undefined }) : s
    }, `note:${step?.id}:${id}`)

  /** One spike carrier per step: giving it to one ally takes it from the others. */
  const toggleSpike = (id: string) =>
    editStep(s => ({
      ...s,
      elements: s.elements.map(e => {
        if (e.kind !== 'agent' || e.team !== 'ally') return e
        if (e.id === id) return { ...e, spike: e.spike ? undefined : true }
        return e.spike ? { ...e, spike: undefined } : e
      }),
    }))

  const abilityName = (agent: string, slot: AbilitySlot | null) =>
    slot ? (agentByName(agent)?.abilities.find(a => a.slot === slot)?.name ?? null) : null

  // ── Brief, templates, compose ─────────────────────────────────────────────

  const resetView = () => {
    setStepIndex(0)
    setSelectedId(null)
    setPending(null)
    setPlaying(false)
  }

  const changeSide = (next: PlaySide) => {
    if (next === side) return
    // On the doc as it is by then: a replay jump can capture a step just before it turns the side.
    commitWith(d => (isPristine(d, side) ? emptyPlayDoc([], next) : d))
    setSide(next)
  }

  const startBlank = () => {
    commit(ensureStep(emptyPlayDoc(agentsInBrief(brief, registryAgents.map(a => a.name)), side), side))
    resetView()
    setComposedWith(null)
    setComposeError(null)
  }

  /**
   * The template's steps, with the comp kept when there is one and taken from
   * the brief otherwise. An empty brief gets the template's scaffold to fill in.
   */
  const applyTemplate = (template: PlayTemplate, site: string | null) => {
    setSide(template.side)
    const agents = doc.comp.length ? doc.comp : agentsInBrief(brief, registryAgents.map(a => a.name))
    commit(ensureStep(templateDoc(template, agents, site), template.side))
    resetView()
    setComposedWith(null)
    setComposeError(null)
    setShowCallouts(true)
    if (brief.trim() === '') setBrief(templateScaffold(template, map, site))
  }

  /**
   * A round of a replay, converted (§2.7): its map when the registry knows it,
   * its side, its steps as one undo step, its title and brief.
   */
  const loadReplayPlay = (play: ReplayPlay) => {
    const mapName = play.mapUuid ? registry?.maps.byId.get(play.mapUuid)?.name : undefined
    if (mapName) setMapPick(mapName)
    setSide(play.side)
    commit(ensureStep(play.doc, play.side))
    resetView()
    setComposedWith(null)
    setComposeError(null)
    setTitle(truncate(play.title, TITLE_MAX) || UNTITLED)
    setBrief(play.brief)
  }

  // ── Replay mode (§2.8) ────────────────────────────────────────────────────

  const currentRound = (open: OpenReplay) => replayRoundRef.current ?? roundAt(open.bundle, replayMsRef.current)

  /**
   * The replay at `t`, held inside `round` (by default the round of `t`): the
   * frame into the canvas' store, the clock, and the round's side through the
   * rail's own setter, so the map turns with it. A frame loop still running
   * stops here.
   */
  const showReplayAt = (open: OpenReplay, t: number, round: ReplayRound = roundAt(open.bundle, t)) => {
    const span = roundSpan(open.bundle, round)
    const at = Math.max(span.start, Math.min(span.end, t))
    replayEpoch.current += 1
    replayMsRef.current = at
    replayRoundRef.current = round
    const openMask = controlMaskFor(open)
    const control = openMask ? advanceControl(replayControl, open, round, at, openMask) : null
    frames.set({ step: frameStep(open.bundle, at, open.lookup, open.transform, open.ids, round), control })
    clock.set({ ms: at, round, share: control ? controlShare(control) : null })
    changeSide(roundSide(round))
  }

  /**
   * The frame shown, edited or not, as a new step after the active one: named
   * by its round clock, captioned by the nearest tick within 2 s (else the
   * round's side and outcome), its allies joined to the comp, one undo step,
   * selected in the rail. Into an untouched blank play it replaces the blank
   * steps instead of landing among them. False when the play is full.
   */
  const capture = (source: PlayStep | null = live?.step ?? frames.get()?.step ?? null): boolean => {
    if (!replay || !source) return false
    const pristine = isPristine(doc, side)
    if (!pristine && stepCount >= MAX_STEPS) return false
    const t = source.replayMs ?? replayMsRef.current
    const round = currentRound(replay)
    const name = formatRoundClock(round, t)
    const near = roundTicks(replay.bundle, round, replay.nameOf)
      .filter(tick => Math.abs(tick.t - t) <= TICK_NEAR_MS)
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]
    const fitted = fitComp(pristine ? [] : doc.comp, {
      ...source,
      // A throw caught mid-air is kept as thrown: the strat shows where it lands, not the frame.
      elements: source.elements.map(el => {
        if (el.kind !== 'ability' || el.progress === undefined) return el
        const { progress: _inFlight, ...landed } = el
        void _inFlight
        return landed
      }),
      id: newId(),
      name,
      caption: `${name} · ${near?.label ?? roundFacts(round)}`,
      replayMs: t,
    })
    const at = pristine ? 0 : stepAt + 1
    const steps = pristine ? [fitted.step] : [...doc.steps.slice(0, at), fitted.step, ...doc.steps.slice(at)]
    commit({ ...doc, comp: fitted.comp, steps })
    setStepIndex(at)
    setPlaying(false)
    setLive(l => (l && l.step === source ? { ...l, captured: true } : l))
    return true
  }

  /** Before the replay time moves: an edited frame not captured yet becomes a step (with a toast), then the live frame goes. */
  const settleLive = () => {
    if (live && !live.captured) setToast(capture(live.step) ? 'Step captured' : 'The play is full: the edit was not captured')
    setLive(null)
  }

  /** Opens a match in the replay mode at `t`, paused, on its map. The error line says why when its positions cannot be placed. */
  const enterReplay = (matchId: string, bundle: ReplayBundle, t: number) => {
    if (!registry) return
    let context: ReplayContext
    try {
      context = replayContext(bundle, registry)
    } catch (e) {
      setError(messageOf(e))
      return
    }
    if (replay) settleLive()
    const agentOf = new Map(bundle.players.map(p => [p.subject, p.agentId]))
    const open: OpenReplay = {
      ...context,
      matchId,
      bundle,
      ids: createFrameIds(),
      nameOf: subject => context.lookup(agentOf.get(subject) ?? null)?.name ?? 'Agent',
    }
    const mapName = bundle.match.mapUuid ? registry.maps.byId.get(bundle.match.mapUuid)?.name : undefined
    if (mapName) setMapPick(mapName)
    // A strat started from a match is named after it until the user renames it.
    if (title === UNTITLED) setTitle(truncate(`${mapName ?? 'Match'} · ${bundle.match.recordedAt.slice(0, 10)} · from replay`, TITLE_MAX))
    setReplay(open)
    setReplayLink(matchId)
    setReplayPlaying(false)
    setPlaying(false)
    setLive(null)
    setView('replay')
    setSelectedId(null)
    setPending(null)
    showReplayAt(open, t)
  }

  /** **Play match** from the picker: round 1's barrier drop. */
  const playMatch = (bundle: ReplayBundle, matchId: string) => enterReplay(matchId, bundle, barrierOf(bundle, firstRound(bundle)))

  /** **Open replay** on a play built from one: at the active step's moment, else round 1's barrier drop. */
  const openReplay = () => {
    if (!replayLink || openingReplay) return
    const matchId = replayLink
    const at = step?.replayMs
    setOpeningReplay(true)
    getReplayBundle(matchId)
      .then(bundle => {
        if (!bundle) throw new Error('The match this play came from has no replay attached any more.')
        enterReplay(matchId, bundle, at ?? barrierOf(bundle, firstRound(bundle)))
      })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setOpeningReplay(false))
  }

  /** Exit keeps the captured steps and drops the live frame. */
  const exitReplay = () => {
    replayEpoch.current += 1
    replayRoundRef.current = null
    replayControl.current = null
    clock.set(null)
    setReplay(null)
    setReplayPlaying(false)
    setLive(null)
    setView('replay')
    setSelectedId(null)
    frames.set(null)
  }

  const playReplay = () => {
    if (!replay) return
    settleLive()
    setView('replay')
    setPlaying(false)
    const round = currentRound(replay)
    const span = roundSpan(replay.bundle, round)
    // At the round's end, play starts it over, the way a video player does.
    if (replayMsRef.current >= span.end) showReplayAt(replay, span.start, round)
    setReplayPlaying(true)
  }

  const toggleReplay = () => (replayPlaying ? setReplayPlaying(false) : playReplay())

  /** The replay at `t`, paused, in the replay view: the scrubber, a nudge, a round chip, Back to replay. */
  const seekReplay = (t: number, round?: ReplayRound) => {
    if (!replay) return
    settleLive()
    setReplayPlaying(false)
    setPlaying(false)
    setView('replay')
    showReplayAt(replay, t, round)
  }

  const jumpToRound = (n: number) => {
    const round = replay?.bundle.rounds.find(r => r.n === n)
    if (replay && round) seekReplay(barrierOf(replay.bundle, round), round)
  }

  const nudgeReplay = (ms: number) => {
    if (replay) seekReplay(replayMsRef.current + ms, currentRound(replay))
  }

  /** From the steps view: the replay at the active step's moment when it has one, else where it was. */
  const backToReplay = () => {
    if (step?.replayMs !== undefined) seekReplay(step.replayMs)
    else setView('replay')
  }

  useEffect(() => {
    if (deepLinked.current || loadId !== undefined || !registry || !empty || !deepLink.replay) return
    deepLinked.current = true
    const matchId = deepLink.replay
    const said = deepLink.round
    const round = said === null ? null : Number(said)
    const snapshots = deepLink.mode === 'steps'
    // Cleared at once, so a reload does not load the match over the user's work.
    setSearchParams({}, { replace: true })
    const bundleLoad =
      (round !== null && !(Number.isInteger(round) && round >= 1)) || (snapshots && round === null)
        ? Promise.reject(new Error('The replay link names no round.'))
        : getReplayBundle(matchId)
    bundleLoad
      .then(bundle => {
        if (!bundle) throw new Error('That match has no replay attached.')
        const picked = round === null ? firstRound(bundle) : bundle.rounds.find(r => r.n === round)
        if (!picked) throw new Error(`The replay has no round ${round}.`)
        // `&mode=steps` is the §2.7 snapshot import; otherwise the replay mode at the round's barrier, paused.
        if (snapshots) loadReplayPlay(replayRoundToPlay(bundle, picked.n, registry))
        else enterReplay(matchId, bundle, barrierOf(bundle, picked))
      })
      .catch((e: unknown) => setError(messageOf(e)))
  })

  useEffect(() => {
    if (deepLinked.current || loadId !== undefined || !gameMap || !empty || deepLink.replay) return
    const template = templateById(deepLink.template ?? '')
    if (!template) return
    deepLinked.current = true
    const wanted = deepLink.site?.trim().toUpperCase()
    applyTemplate(template, wanted && sites.includes(wanted) ? wanted : (sites[0] ?? null))
    // So a reload does not apply it over the user's work.
    setSearchParams({}, { replace: true })
  })

  const compose = async () => {
    if (!gameMap || gameMap.callouts.length === 0 || !brief.trim() || composing) return
    setComposing(true)
    setComposeError(null)
    try {
      const comp = doc.comp
      const result = await composePlay({
        map,
        side,
        brief,
        comp: comp.length === MAX_COMP ? comp : undefined,
        abilities: abilitiesForComp(comp, name => agentByName(name)?.abilities ?? null),
        callouts: gameMap.callouts.map(c => c.name),
        previous: empty ? null : doc,
      })
      commit(ensureStep(result.play, side))
      resetView()
      setComposedWith(result.model || null)
      setShowCallouts(true)
      if (title === UNTITLED) setTitle(truncate(result.play.summary, TITLE_MAX) || `${map} ${side} play`)
    } catch (e) {
      setComposeError({ message: messageOf(e), notConfigured: e instanceof ComposerNotConfiguredError })
    } finally {
      setComposing(false)
    }
  }

  // ── Save, delete ──────────────────────────────────────────────────────────

  const save = async () => {
    if (!dirty || saving || !map) return
    const savedTitle = title.trim() || UNTITLED
    const input: PlayInput = {
      title: savedTitle,
      map,
      map_uuid: gameMap?.uuid ?? null,
      side,
      comp: doc.comp,
      brief,
      play: savedDoc,
      composed_with: composedWith,
    }
    setSaving(true)
    setError(null)
    try {
      if (savedId) {
        await updatePlay(savedId, input)
      } else {
        const created = await createPlay(input)
        setSavedId(created.id)
        onCreated(created.id)
        navigate(`/plays/${created.id}`, { replace: true })
      }
      setTitle(savedTitle)
      setMapPick(map)
      setSnapshot(snapshotOf({ title: savedTitle, map, side, brief, doc: savedDoc }))
      setSavedFlash(true)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  /** False when the delete failed; the error line says why. */
  const remove = async (): Promise<boolean> => {
    if (!savedId) return false
    setError(null)
    try {
      await deletePlay(savedId)
      navigate('/plays')
      return true
    } catch (e) {
      setError(messageOf(e))
      return false
    }
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  // Re-bound every render so the handlers see the current play.
  useEffect(() => {
    if (load !== 'ready') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target) || inPlaybookPanel(e.target)) return
      const key = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (e.altKey) return
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault()
          undo()
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault()
          redo()
        }
        return
      }
      if (e.altKey) return
      if (e.key === 'Escape') {
        setPending(null)
        setSelectedId(null)
        setPopoverAgent(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedId) return
        e.preventDefault()
        removeShown(selectedId)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (e.repeat) setAnimate(false)
        pickStep(stepAt + (e.key === 'ArrowLeft' ? -1 : 1))
      } else if (e.key === ' ') {
        // Also keeps a focused button from being clicked by the same key.
        e.preventDefault()
        // Playback waits for the keyup: Space held is the canvas' pan key.
        if (!e.repeat) spaceDownAt.current = e.timeStamp
      } else if (e.key === '+' || e.key === '=') {
        canvas.current?.zoomIn()
      } else if (e.key === '-') {
        canvas.current?.zoomOut()
      } else if (e.key === '0') {
        canvas.current?.resetZoom()
      } else if ((e.key === ',' || e.key === '.') && replay) {
        e.preventDefault()
        nudgeReplay(e.key === ',' ? -NUDGE_MS : NUDGE_MS)
      } else if (!e.shiftKey && TOOL_KEYS[key]) {
        chooseTool(TOOL_KEYS[key])
      } else if (key.length === 1 && key >= '1' && key <= '4') {
        const picked = ROLE_KEYS[Number(key) - 1]
        setRole(r => (r === picked ? null : picked))
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setAnimate(true)
      } else if (e.key === ' ') {
        const downAt = spaceDownAt.current
        spaceDownAt.current = null
        if (downAt === null || isEditable(e.target) || inPlaybookPanel(e.target)) return
        e.preventDefault()
        if (e.timeStamp - downAt >= SPACE_TAP_MS) return
        // In the replay view Space plays the match, not the step walk.
        if (replay && view === 'replay') toggleReplay()
        else if (stepCount > 1) setPlaying(p => !p)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────

  const placed = useMemo(() => {
    const byAgent = new Map<string, Team[]>()
    for (const e of step?.elements ?? []) {
      if (e.kind !== 'agent') continue
      const key = e.agent.toLowerCase()
      byAgent.set(key, [...(byAgent.get(key) ?? []), e.team])
    }
    return byAgent
  }, [step])

  const popoverGameAgent = popoverAgent ? agentByName(popoverAgent) : undefined
  const abilityCounts: Partial<Record<AbilitySlot, number>> = {}
  if (popoverAgent && step) {
    for (const e of step.elements) {
      if (e.kind === 'ability' && e.slot && sameName(e.agent, popoverAgent)) {
        abilityCounts[e.slot] = (abilityCounts[e.slot] ?? 0) + 1
      }
    }
  }

  if (load === 'loading') {
    return (
      <div className="-mx-4 -my-6 h-[calc(100vh-57px)] flex flex-col" aria-hidden="true">
        <div className="h-11 border-b border-bg-elevated bg-bg-secondary" />
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <div className="h-full aspect-square max-w-full rounded-xl bg-bg-card animate-pulse" />
        </div>
      </div>
    )
  }

  if (load === 'missing' || load === 'failed') {
    return (
      <div className="max-w-6xl mx-auto">
        <div className={card}>
          {load === 'missing' ? (
            <p className="text-sm text-text-secondary">This play does not exist or is not yours.</p>
          ) : (
            <div className={errorBox}>Couldn't load this play: {error}</div>
          )}
          <Link to="/plays" className="inline-flex items-center gap-1.5 text-sm text-val-cyan hover:underline">
            <ArrowLeft className="w-4 h-4" />
            Back to plays
          </Link>
        </div>
      </div>
    )
  }

  return (
    // The app's main column pads its pages; the editor takes the whole area under the 57 px header.
    <div className="-mx-4 -my-6 h-[calc(100vh-57px)] flex flex-col bg-bg-primary">
      <EditorToolbar
        title={title}
        onTitle={setTitle}
        map={map}
        side={side}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onUndo={undo}
        onRedo={redo}
        showCallouts={showCallouts}
        onToggleCallouts={() => setShowCallouts(s => !s)}
        showControl={showControl}
        onToggleControl={toggleControl}
        playbookOpen={playbookOpen}
        onTogglePlaybook={() => {
          persistPlaybookOpen(!playbookOpen)
          setPlaybookOpen(!playbookOpen)
        }}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen(o => !o)}
        briefHint={composedWith === null}
        onOpenReplay={replayLink && !replay && registry ? openReplay : undefined}
        openingReplay={openingReplay}
        canSave={dirty && Boolean(map)}
        saving={saving}
        savedFlash={savedFlash}
        onSave={save}
        onDelete={savedId ? remove : undefined}
      />

      {error && (
        <div className="shrink-0 border-b border-val-red/25 bg-val-red/10 text-val-red text-sm px-3 py-1.5">{error}</div>
      )}

      {replay && (
        <ReplayTransport
          bundle={replay.bundle}
          clock={clock}
          nameOf={replay.nameOf}
          playing={replayPlaying}
          onTogglePlay={toggleReplay}
          speed={replaySpeed}
          onSpeed={setReplaySpeed}
          onSeek={ms => seekReplay(ms, currentRound(replay))}
          onRound={jumpToRound}
          controlMask={replayMask}
          transform={replay.transform}
          canCapture={isPristine(doc, side) || stepCount < MAX_STEPS}
          onCapture={() => capture()}
          view={view}
          onBackToReplay={backToReplay}
          onExit={exitReplay}
        />
      )}

      <div
        ref={editorGrid}
        className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[112px_auto_minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)_64px]"
      >
        <aside data-plays-column="rail" className="shrink-0 min-h-0 bg-bg-secondary border-b border-bg-elevated lg:border-b-0 lg:border-r lg:row-start-1 lg:col-start-1">
          <EditorRail
            mapNames={mapNames}
            map={map}
            onMap={setMapPick}
            side={side}
            onSide={changeSide}
            steps={doc.steps}
            stepIndex={stepAt}
            onPickStep={pickStep}
            onAddStep={addStep}
            onRemoveStep={removeStep}
            playing={isPlaying}
            onTogglePlay={() => {
              if (replay) {
                setReplayPlaying(false)
                setView('steps')
              }
              setPlaying(p => !p)
            }}
            speedMs={speedMs}
            onSpeed={setSpeedMs}
            onStepName={name => editStep(s => ({ ...s, name }), `name:${step?.id}`)}
            tool={tool}
            onTool={chooseTool}
            onClearStep={clearStep}
            onClearAll={clearAll}
          />
        </aside>

        {/* Rail, playbook, canvas, drawer (§2.6). Under lg a block between the rail and the canvas. */}
        {/* On lg its width is the splitter's (written during a drag, committed on release); the column is auto. */}
        <aside
          ref={playbookSplit.panelProps.ref}
          style={playbookSized ? playbookSplit.panelProps.style : undefined}
          data-plays-column="playbook"
          className={`shrink-0 min-h-0 bg-bg-card border-bg-elevated lg:row-start-1 lg:col-start-2 lg:overflow-y-auto lg:overflow-x-hidden ${
            playbookOpen ? 'block border-b lg:border-b-0 lg:border-r' : 'hidden'
          }`}
        >
          {/* Keyed by map: a new map starts the panel's hooks fresh instead of showing the last map's rows. */}
          {playbookOpen && map && <PlaybookPanel key={map} map={map} />}
        </aside>

        {/* The canvas fills the column inside its padding and measures itself. */}
        <div
          className="relative shrink-0 h-[70vh] lg:h-auto min-h-0 min-w-0 p-3 flex items-center justify-center overflow-hidden lg:row-start-1 lg:col-start-3"
        >
          {!registry && registryStatus === 'loading' ? (
            <div className="absolute inset-3 rounded-xl bg-bg-card animate-pulse" aria-hidden="true" />
          ) : gameMap && mapDrawable && step ? (
            <div className={`absolute inset-3 transition-opacity ${composing ? 'opacity-60 pointer-events-none' : ''}`}>
              {/* In the replay view: the frame from its store (the edited copy once paused and
                  changed), no ghosts, no walk, read-only while the match plays. */}
              <FrameCanvas
                ref={canvas}
                frames={inReplay ? frames : null}
                edited={inReplay ? live?.step : null}
                control={stepControl}
                map={gameMap}
                side={side}
                step={step}
                previous={inReplay ? null : previous}
                tool={tool}
                pending={pending}
                selectedId={selectedId}
                showCallouts={showCallouts}
                animate={inReplay ? false : animate}
                onSelect={onCanvasSelect}
                onChange={inReplay ? (replayPlaying ? undefined : onFrameChange) : onCanvasChange}
                onPendingDone={() => setPending(null)}
                onUnresolved={setUnresolved}
              />
              {toast && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none">
                  <span
                    role="status"
                    className="inline-block whitespace-nowrap rounded-full border border-val-cyan/25 bg-bg-primary/85 px-3 py-1 text-[11px] font-medium text-val-cyan"
                  >
                    {toast}
                  </span>
                </div>
              )}
              {/* Over the canvas, its right end clear of the zoom overlay at the canvas' top-right. */}
              {unresolved.length > 0 && (
                <div className="absolute top-2 left-2 right-36 pointer-events-none">
                  <span className="inline-block max-w-full truncate rounded-md bg-bg-primary/85 px-2 py-1 text-[11px] text-val-yellow">
                    Not on this map: {unresolved.join(', ')}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-sm rounded-xl border border-bg-elevated bg-bg-card p-6 text-center text-sm text-text-muted">
              This map’s minimap data is not available right now.
            </div>
          )}

          {popoverGameAgent && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
              <AbilityPopover
                agent={popoverGameAgent}
                counts={abilityCounts}
                pendingSlot={pending && sameName(pending.agent, popoverGameAgent.name) ? pending.slot : null}
                onPick={slot => setPending(slot ? { agent: popoverGameAgent.name, slot } : null)}
                onClose={() => {
                  setPopoverAgent(null)
                  setPending(null)
                }}
              />
            </div>
          )}
        </div>

        {/* The splitters share their panel's grid cell, laid over its inner edge: they neither
            scroll with the panel's content nor take a column of their own. Painted after the
            canvas so the half of the grip over the canvas column stays on top. */}
        {playbookSized && (
          <div className="relative z-10 flex row-start-1 col-start-2 justify-self-end translate-x-1/2">
            <SplitterHandle {...playbookSplit.dragHandlers} />
          </div>
        )}
        {drawerSized && (
          <div className="relative z-10 flex row-start-1 col-start-4 justify-self-start -translate-x-1/2">
            <SplitterHandle {...drawerSplit.dragHandlers} />
          </div>
        )}

        <aside
          ref={drawerSplit.panelProps.ref}
          style={drawerSized ? drawerSplit.panelProps.style : undefined}
          data-plays-column="drawer"
          className={`min-h-0 bg-bg-card border-bg-elevated lg:row-start-1 lg:col-start-4 lg:overflow-y-auto lg:overflow-x-hidden ${
            drawerOpen ? 'block border-t lg:border-t-0 lg:border-l' : 'hidden lg:block lg:w-0'
          }`}
        >
          {drawerOpen && (
            <BriefDrawer
              showTemplates={empty}
              templates={PLAY_TEMPLATES}
              sites={sites}
              onApplyTemplate={applyTemplate}
              map={map}
              onLoadReplay={loadReplayPlay}
              onPlayReplay={playMatch}
              brief={brief}
              onBrief={setBrief}
              canCompose={brief.trim().length > 0 && (gameMap?.callouts.length ?? 0) > 0}
              composing={composing}
              onCompose={compose}
              composedWith={composedWith}
              error={composeError}
              onStartBlank={startBlank}
              side={side}
              step={step ?? null}
              stepIndex={stepAt}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCaption={caption => editStep(s => ({ ...s, caption }), `caption:${step?.id}`)}
              onNote={setNote}
              onSpike={toggleSpike}
              onRemoveElement={removeElement}
              abilityName={abilityName}
              assumptions={doc.assumptions}
            />
          )}
        </aside>

        <div className="sticky bottom-0 z-20 shrink-0 lg:static lg:row-start-2 lg:col-start-1 lg:col-span-4">
          <AgentStrip
            agents={registryAgents}
            role={role}
            onRole={setRole}
            team={team}
            onTeam={setTeam}
            placed={placed}
            activeAgent={popoverAgent}
            onPick={pickAgent}
            hint={hint}
            enabled={Boolean(gameMap && mapDrawable) && !(inReplay && replayPlaying)}
          />
        </div>
      </div>
    </div>
  )
}
