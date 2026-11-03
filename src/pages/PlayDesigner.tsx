import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import PlayCanvas, { type Tool } from '../components/PlayCanvas'
import AbilityPopover from '../components/play/AbilityPopover'
import AgentStrip, { type AgentRole } from '../components/play/AgentStrip'
import BriefDrawer, { type ComposeFailure } from '../components/play/BriefDrawer'
import EditorRail from '../components/play/EditorRail'
import EditorToolbar from '../components/play/EditorToolbar'
import PlaybookPanel from '../components/play/PlaybookPanel'
import { useGameContent, useGameContentNames } from '../hooks/useGameContent'
import { abilitiesForComp } from '../lib/composeAbilities'
import { composePlay, ComposerNotConfiguredError } from '../lib/composePlay'
import type { GameAgent } from '../lib/gameContent'
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
import type { PlaySide } from '../lib/types'

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
  // `/plays/new?template=retake&site=B`, read once: applied when the map is known, then cleared.
  const [searchParams, setSearchParams] = useSearchParams()
  const [deepLink] = useState(() => ({ template: searchParams.get('template'), site: searchParams.get('site') }))
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
  const [showCallouts, setShowCallouts] = useState(!loadId)
  const [playing, setPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS)
  /** False while an arrow key is held down: the steps flick by without the walk animation. */
  const [animate, setAnimate] = useState(true)
  const [unresolved, setUnresolved] = useState<string[]>([])
  const [hint, setHint] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [composing, setComposing] = useState(false)
  const [composeError, setComposeError] = useState<ComposeFailure | null>(null)

  const canvasBox = useRef<HTMLDivElement>(null)
  const [boxSize, setBoxSize] = useState(0)

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

  const dirty = snapshotOf({ title, map, side, brief, doc }) !== snapshot

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

  // The canvas is a square as large as the middle column allows.
  useEffect(() => {
    const el = canvasBox.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setBoxSize(Math.max(0, Math.floor(Math.min(rect.width, rect.height))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [load])

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

  // ── Steps ─────────────────────────────────────────────────────────────────

  const pickStep = (i: number) => {
    setPlaying(false)
    setStepIndex(Math.max(0, Math.min(stepCount - 1, i)))
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

  const removeElement = (id: string) => {
    editStep(s => withoutElement(s, id), null, true)
    if (selectedId === id) setSelectedId(null)
  }

  /** Selecting an agent on the map opens its abilities; clicking empty map closes them unless one is armed. */
  const onCanvasSelect = (id: string | null) => {
    setSelectedId(id)
    const el = id && step ? elementAt(step, id) : null
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
   * with an ally outside the comp would not open again.
   */
  const pickAgent = (agent: GameAgent) => {
    if (!step || !gameMap) return
    const existing = step.elements.find(
      (e): e is AgentElement => e.kind === 'agent' && e.team === team && sameName(e.agent, agent.name),
    )
    if (existing) {
      setSelectedId(existing.id)
      setPopoverAgent(existing.agent)
      return
    }
    const compName = doc.comp.find(name => sameName(name, agent.name))
    if (team === 'ally' && !compName && doc.comp.length >= MAX_COMP) {
      setHint('Comp is full')
      return
    }
    const centre = viewToImage(sceneViewport(gameMap), 500, 500, sceneTurns(gameMap, side))
    const el: AgentElement = {
      kind: 'agent',
      id: newId(),
      agent: compName ?? agent.name,
      team,
      at: { u: centre.u, v: centre.v },
    }
    const joins = team === 'ally' && !compName
    const stepId = step.id
    commitWith(d => ({
      ...d,
      comp: joins ? [...d.comp, agent.name] : d.comp,
      steps: d.steps.map(s => (s.id === stepId ? withElement(s, el) : s)),
    }))
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
    if (isPristine(doc, side)) commit(emptyPlayDoc([], next))
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

  useEffect(() => {
    if (deepLinked.current || loadId !== undefined || !gameMap || !empty) return
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
      play: doc,
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
      setSnapshot(snapshotOf({ title: savedTitle, map, side, brief, doc }))
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
        removeElement(selectedId)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (e.repeat) setAnimate(false)
        pickStep(stepAt + (e.key === 'ArrowLeft' ? -1 : 1))
      } else if (e.key === ' ') {
        // Also keeps a focused button from being clicked by the same key.
        e.preventDefault()
        if (stepCount > 1) setPlaying(p => !p)
      } else if (!e.shiftKey && TOOL_KEYS[key]) {
        chooseTool(TOOL_KEYS[key])
      } else if (key.length === 1 && key >= '1' && key <= '4') {
        const picked = ROLE_KEYS[Number(key) - 1]
        setRole(r => (r === picked ? null : picked))
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setAnimate(true)
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
        playbookOpen={playbookOpen}
        onTogglePlaybook={() => {
          persistPlaybookOpen(!playbookOpen)
          setPlaybookOpen(!playbookOpen)
        }}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen(o => !o)}
        briefHint={composedWith === null}
        canSave={dirty && Boolean(map)}
        saving={saving}
        savedFlash={savedFlash}
        onSave={save}
        onDelete={savedId ? remove : undefined}
      />

      {error && (
        <div className="shrink-0 border-b border-val-red/25 bg-val-red/10 text-val-red text-sm px-3 py-1.5">{error}</div>
      )}

      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[112px_auto_minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)_64px]">
        <aside className="shrink-0 min-h-0 bg-bg-secondary border-b border-bg-elevated lg:border-b-0 lg:border-r lg:row-start-1 lg:col-start-1">
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
            onTogglePlay={() => setPlaying(p => !p)}
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
        <aside
          className={`shrink-0 min-h-0 bg-bg-card border-bg-elevated lg:row-start-1 lg:col-start-2 lg:overflow-y-auto lg:overflow-x-hidden ${
            playbookOpen ? 'block border-b lg:border-b-0 lg:border-r lg:w-[400px]' : 'hidden'
          }`}
        >
          {/* Keyed by map: a new map starts the panel's hooks fresh instead of showing the last map's rows. */}
          {playbookOpen && map && <PlaybookPanel key={map} map={map} />}
        </aside>

        <div
          ref={canvasBox}
          className="relative shrink-0 h-[70vh] lg:h-auto min-h-0 min-w-0 p-3 flex items-center justify-center overflow-hidden lg:row-start-1 lg:col-start-3"
        >
          {!registry && registryStatus === 'loading' ? (
            <div style={{ width: boxSize, height: boxSize }} className="rounded-xl bg-bg-card animate-pulse" aria-hidden="true" />
          ) : gameMap && mapDrawable && step ? (
            <div
              style={{ width: boxSize, height: boxSize }}
              className={`transition-opacity ${composing ? 'opacity-60 pointer-events-none' : ''}`}
            >
              {boxSize > 0 && (
                <PlayCanvas
                  map={gameMap}
                  side={side}
                  step={step}
                  previous={previous}
                  tool={tool}
                  pending={pending}
                  selectedId={selectedId}
                  showCallouts={showCallouts}
                  animate={animate}
                  onSelect={onCanvasSelect}
                  onChange={onCanvasChange}
                  onPendingDone={() => setPending(null)}
                  onUnresolved={setUnresolved}
                />
              )}
            </div>
          ) : (
            <div className="max-w-sm rounded-xl border border-bg-elevated bg-bg-card p-6 text-center text-sm text-text-muted">
              This map’s minimap data is not available right now.
            </div>
          )}

          {mapDrawable && unresolved.length > 0 && (
            <div className="absolute top-3 left-3 right-3 pointer-events-none">
              <span className="inline-block max-w-full truncate rounded-md bg-bg-primary/85 px-2 py-1 text-[11px] text-val-yellow">
                Not on this map: {unresolved.join(', ')}
              </span>
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

        <aside
          className={`min-h-0 bg-bg-card border-bg-elevated lg:row-start-1 lg:col-start-4 lg:overflow-y-auto lg:overflow-x-hidden ${
            drawerOpen ? 'block border-t lg:border-t-0 lg:border-l lg:w-[360px]' : 'hidden lg:block lg:w-0'
          }`}
        >
          {drawerOpen && (
            <BriefDrawer
              showTemplates={empty}
              templates={PLAY_TEMPLATES}
              sites={sites}
              onApplyTemplate={applyTemplate}
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
            enabled={Boolean(gameMap && mapDrawable)}
          />
        </div>
      </div>
    </div>
  )
}
