import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import PlayMinimap, { type PlaySelection } from '../components/PlayMinimap'
import BriefPanel, { type ComposeFailure } from '../components/play/BriefPanel'
import MapLegend from '../components/play/MapLegend'
import PhasePanel from '../components/play/PhasePanel'
import PhaseStepper from '../components/play/PhaseStepper'
import PlayHeader from '../components/play/PlayHeader'
import { useGameContent, useGameContentNames } from '../hooks/useGameContent'
import { composePlay, ComposerNotConfiguredError } from '../lib/composePlay'
import { emptyPlayDoc, parsePlayDoc, PlayDocError, type PlayDoc, type PlayPhase, type PlayUtility } from '../lib/playDoc'
import { createPlay, deletePlay, getPlay, updatePlay, type PlayInput } from '../lib/plays'
import type { PlaySide } from '../lib/types'

const UNTITLED = 'Untitled play'
const STEP_MS = 1800
const SAVED_FLASH_MS = 1500
const TITLE_MAX = 60

const card = 'bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3'
const errorBox = 'border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2'

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A copy of the doc with one phase replaced: the doc is never mutated, so React sees every edit. */
function updatePhase(doc: PlayDoc, phaseIndex: number, fn: (phase: PlayPhase) => PlayPhase): PlayDoc {
  return { ...doc, phases: doc.phases.map((p, i) => (i === phaseIndex ? fn(p) : p)) }
}

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
    .slice(0, 5)
    .map(h => h.name)
}

const isTextField = (target: EventTarget) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement

const snapshotOf = (s: { title: string; map: string; side: PlaySide; brief: string; doc: PlayDoc | null }) =>
  JSON.stringify({ ...s, comp: s.doc?.comp ?? [] })

/**
 * `/plays/new` and `/plays/:id`. A play created here keeps its editor: the URL
 * becomes `/plays/:id` but the state, the phase shown and the "Saved" flash
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

function Designer({ loadId, onCreated }: { loadId: string | undefined; onCreated(id: string): void }) {
  const navigate = useNavigate()
  const { registry, status: registryStatus } = useGameContent()
  const { mapNames } = useGameContentNames()

  const [load, setLoad] = useState<LoadState>(loadId ? 'loading' : 'ready')
  const [savedId, setSavedId] = useState<string | null>(loadId ?? null)
  const [title, setTitle] = useState(UNTITLED)
  // '' until picked or loaded: a new play falls back to the registry's first map.
  const [mapPick, setMapPick] = useState('')
  const [side, setSide] = useState<PlaySide>('attack')
  const [brief, setBrief] = useState('')
  const [doc, setDoc] = useState<PlayDoc | null>(null)
  const [composedWith, setComposedWith] = useState<string | null>(null)
  /** What was last saved; null for a play never saved, which counts as unsaved. */
  const [snapshot, setSnapshot] = useState<string | null>(null)

  const [phaseIndex, setPhaseIndex] = useState(0)
  const [selected, setSelected] = useState<PlaySelection | null>(null)
  const [showCallouts, setShowCallouts] = useState(!loadId)
  const [playing, setPlaying] = useState(false)
  const [unresolved, setUnresolved] = useState<string[]>([])

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [composing, setComposing] = useState(false)
  const [composeError, setComposeError] = useState<ComposeFailure | null>(null)

  const map = mapPick || (loadId ? '' : (mapNames[0] ?? ''))
  const comp = useMemo(() => doc?.comp ?? [], [doc])
  const gameMap = map ? registry?.maps.byName.get(map.trim().toLowerCase()) : undefined
  const mapDrawable = Boolean(gameMap?.transform && gameMap.callouts.length > 0)

  const phaseCount = doc?.phases.length ?? 0
  const phaseAt = Math.min(phaseIndex, Math.max(0, phaseCount - 1))
  const phase = doc?.phases[phaseAt] ?? null
  // With nothing composed the map still shows, empty, so the user can write against it.
  const blank = useMemo(() => emptyPlayDoc([], side), [side])

  const dirty = snapshotOf({ title, map, side, brief, doc }) !== snapshot

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
            // Shown, and the doc left empty so the user can recompose from the brief.
            setError(e.message)
          }
        }
        setTitle(play.title)
        setMapPick(play.map)
        setSide(play.side)
        setBrief(play.brief)
        setDoc(parsed)
        setComposedWith(play.composed_with)
        setSnapshot(snapshotOf({ title: play.title, map: play.map, side: play.side, brief: play.brief, doc: parsed }))
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

  // Playback loops through the phases until paused or a phase is picked.
  useEffect(() => {
    if (!playing || phaseCount < 2) return
    const timer = setInterval(() => setPhaseIndex(i => (Math.min(i, phaseCount - 1) + 1) % phaseCount), STEP_MS)
    return () => clearInterval(timer)
  }, [playing, phaseCount])

  useEffect(() => {
    if (!savedFlash) return
    const timer = setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
    return () => clearTimeout(timer)
  }, [savedFlash])

  const pickPhase = (i: number) => {
    setPlaying(false)
    setPhaseIndex(Math.max(0, Math.min(phaseCount - 1, i)))
  }

  const onMapKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTextField(e.target) || phaseCount === 0) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      pickPhase(phaseAt - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      pickPhase(phaseAt + 1)
    }
  }

  const editPhase = (fn: (phase: PlayPhase) => PlayPhase) => setDoc(d => (d ? updatePhase(d, phaseAt, fn) : d))

  // A drag pins the marker to image units: the callout it stood on no longer applies.
  const onMove = (sel: PlaySelection, pos: { u: number; v: number }) => {
    const at = { u: pos.u, v: pos.v }
    editPhase(p => {
      if (sel.kind === 'actor') return { ...p, actors: p.actors.map((a, i) => (i === sel.index ? { ...a, at } : a)) }
      if (sel.kind === 'utility') return { ...p, utility: p.utility.map((u, i) => (i === sel.index ? { ...u, at } : u)) }
      return { ...p, markers: p.markers.map((m, i) => (i === sel.index ? { ...m, at } : m)) }
    })
  }

  const addUtility = (item: Pick<PlayUtility, 'agent' | 'kind' | 'label'>) => {
    if (!phase) return
    const actor = phase.actors.find(a => a.agent === item.agent)
    editPhase(p => ({ ...p, utility: [...p.utility, { ...item, at: { ...(actor?.at ?? { u: 0.5, v: 0.5 }) } }] }))
    setSelected({ kind: 'utility', index: phase.utility.length })
  }

  const removeUtility = (index: number) => {
    editPhase(p => ({ ...p, utility: p.utility.filter((_, i) => i !== index) }))
    // The selection follows its item when a row above it goes.
    setSelected(s => {
      if (s?.kind !== 'utility') return s
      if (s.index === index) return null
      return s.index > index ? { kind: 'utility', index: s.index - 1 } : s
    })
  }

  // Comp edits touch every phase at once, so an actor never names an agent outside the comp.
  const addAgent = (name: string) => {
    const spawn = side === 'attack' ? 'Attacker Side Spawn' : 'Defender Side Spawn'
    setDoc(d => {
      if (!d || d.comp.length >= 5 || d.comp.some(a => a.toLowerCase() === name.toLowerCase())) return d
      return {
        ...d,
        comp: [...d.comp, name],
        phases: d.phases.map(p => ({ ...p, actors: [...p.actors, { agent: name, at: { callout: spawn }, note: '' }] })),
      }
    })
    setSelected(null)
  }

  const removeAgent = (name: string) => {
    setDoc(d =>
      d
        ? {
            ...d,
            comp: d.comp.filter(a => a !== name),
            phases: d.phases.map(p => ({
              ...p,
              actors: p.actors.filter(a => a.agent !== name),
              utility: p.utility.filter(u => u.agent !== name),
            })),
          }
        : d,
    )
    setSelected(null)
  }

  const startDoc = (next: PlayDoc) => {
    setDoc(next)
    setPhaseIndex(0)
    setSelected(null)
    setPlaying(false)
  }

  const startBlank = () => {
    const names = registry ? [...registry.agents.byId.values()].map(a => a.name) : []
    startDoc(emptyPlayDoc(agentsInBrief(brief, names), side))
    setComposedWith(null)
    setComposeError(null)
  }

  const compose = async () => {
    if (!gameMap || gameMap.callouts.length === 0 || !brief.trim() || composing) return
    setComposing(true)
    setComposeError(null)
    try {
      const result = await composePlay({
        map,
        side,
        brief,
        comp: comp.length === 5 ? comp : undefined,
        callouts: gameMap.callouts.map(c => c.name),
        previous: doc,
      })
      startDoc(result.play)
      setComposedWith(result.model || null)
      setShowCallouts(true)
      if (title === UNTITLED) setTitle(truncate(result.play.summary, TITLE_MAX) || `${map} ${side} play`)
    } catch (e) {
      setComposeError({ message: messageOf(e), notConfigured: e instanceof ComposerNotConfiguredError })
    } finally {
      setComposing(false)
    }
  }

  const save = async () => {
    if (!dirty || saving || !map) return
    const savedTitle = title.trim() || UNTITLED
    const input: PlayInput = {
      title: savedTitle,
      map,
      map_uuid: gameMap?.uuid ?? null,
      side,
      comp,
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

  /** False when the delete failed; the error box says why. */
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

  if (load === 'loading') {
    return (
      <div className="max-w-6xl mx-auto space-y-6" aria-hidden="true">
        <div className="h-9 w-64 rounded-lg bg-bg-card animate-pulse" />
        <div className="aspect-square max-w-xl rounded-xl bg-bg-card animate-pulse" />
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
    <div className="max-w-6xl mx-auto space-y-6">
      <PlayHeader
        title={title}
        onTitle={setTitle}
        map={map}
        side={side}
        comp={comp}
        canSave={dirty && Boolean(map)}
        saving={saving}
        savedFlash={savedFlash}
        onSave={save}
        onDelete={savedId ? remove : undefined}
      />

      {error && <div className={errorBox}>{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6 items-start">
        <div tabIndex={-1} onKeyDown={onMapKeyDown} className="space-y-3 outline-none">
          {doc && (
            <PhaseStepper
              phases={doc.phases}
              index={phaseAt}
              playing={playing}
              onTogglePlay={() => setPlaying(p => !p)}
              onPick={pickPhase}
            />
          )}
          <div className={`relative transition-opacity ${composing ? 'opacity-60 pointer-events-none' : ''}`}>
            {!registry && registryStatus === 'loading' ? (
              <div className="aspect-square rounded-xl bg-bg-card animate-pulse" aria-hidden="true" />
            ) : gameMap && mapDrawable ? (
              <>
                <PlayMinimap
                  map={gameMap}
                  doc={doc ?? blank}
                  phaseIndex={phaseAt}
                  selected={doc ? selected : null}
                  onSelect={setSelected}
                  onMove={doc ? onMove : undefined}
                  showCallouts={showCallouts}
                  side={side}
                  onUnresolved={setUnresolved}
                />
                {!doc && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="bg-bg-primary/80 px-3 py-1.5 rounded-lg text-sm text-text-secondary">
                      Write the brief and compose, or start blank
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="aspect-square rounded-xl border border-bg-elevated bg-bg-card flex items-center justify-center p-6 text-center text-sm text-text-muted">
                This map’s minimap data is not available right now.
              </div>
            )}
          </div>
          <MapLegend
            phase={phase}
            showCallouts={showCallouts}
            onToggleCallouts={() => setShowCallouts(s => !s)}
            unresolved={doc && mapDrawable ? unresolved : []}
          />
        </div>

        <div className="space-y-6">
          <BriefPanel
            mapNames={mapNames}
            map={map}
            onMap={setMapPick}
            side={side}
            onSide={setSide}
            brief={brief}
            onBrief={setBrief}
            canCompose={brief.trim().length > 0 && (gameMap?.callouts.length ?? 0) > 0}
            composing={composing}
            onCompose={compose}
            composedWith={composedWith}
            hasDoc={doc !== null}
            error={composeError}
            onStartBlank={startBlank}
          />
          <PhasePanel
            key={phase?.id ?? 'none'}
            phase={phase}
            phaseIndex={phaseAt}
            comp={comp}
            selected={selected}
            onSelect={setSelected}
            onCaption={caption => editPhase(p => ({ ...p, caption }))}
            onNote={(index, note) =>
              editPhase(p => ({ ...p, actors: p.actors.map((a, i) => (i === index ? { ...a, note } : a)) }))
            }
            onAddUtility={addUtility}
            onRemoveUtility={removeUtility}
            onAddAgent={addAgent}
            onRemoveAgent={removeAgent}
          />
          {doc && doc.assumptions.length > 0 && (
            <section className={card}>
              <div className="text-[11px] uppercase tracking-widest text-text-secondary">Assumptions</div>
              <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
                {doc.assumptions.map((a, i) => (
                  <li key={`${i}-${a}`}>{a}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
