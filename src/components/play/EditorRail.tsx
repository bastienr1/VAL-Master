import { Pause, Play, Plus, X } from 'lucide-react'
import type { Tool } from '../PlayCanvas'
import type { PlayStep } from '../../lib/playDoc'
import type { PlaySide } from '../../lib/types'
import { TOOLS, toolTitle } from './tools'

interface EditorRailProps {
  mapNames: string[]
  map: string
  onMap(map: string): void
  side: PlaySide
  onSide(side: PlaySide): void
  steps: PlayStep[]
  stepIndex: number
  onPickStep(index: number): void
  onAddStep(): void
  /** Already confirmed by the rail when the step had elements. */
  onRemoveStep(index: number): void
  playing: boolean
  onTogglePlay(): void
  speedMs: number
  onSpeed(ms: number): void
  onStepName(name: string): void
  tool: Tool
  onTool(tool: Tool): void
  /** A replay is on screen: T takes a note there. */
  inReplay: boolean
  onClearStep(): void
  /** Already confirmed by the rail. */
  onClearAll(): void
}

/** Most steps a play holds (docs/plays-editor-v2.md §3). */
const MAX_STEPS = 10
const SPEED_MIN = 500
const SPEED_MAX = 3000

const SIDES: { value: PlaySide; label: string; on: string }[] = [
  { value: 'attack', label: 'ATK', on: 'bg-val-red/15 text-val-red' },
  { value: 'defense', label: 'DEF', on: 'bg-val-cyan/15 text-val-cyan' },
]

const label = 'text-[10px] uppercase tracking-widest text-text-secondary'
const field = 'bg-bg-primary border border-bg-elevated rounded-md text-xs focus:border-val-cyan outline-none'
const section = 'shrink-0 w-28 lg:w-auto space-y-1.5'
const smallButton =
  'w-full px-1.5 py-1 rounded-md text-[11px] text-text-secondary border border-bg-elevated hover:text-text-primary hover:border-val-cyan/40 transition-colors'

/**
 * The editor's left rail (docs/plays-editor-v2.md §2.1): map and side, the
 * step sequence with playback, the drawing tools, and Clear. Under `lg` the
 * same sections sit in one horizontal scrolling row above the canvas.
 */
export default function EditorRail(props: EditorRailProps) {
  const { map, mapNames, side, steps, stepIndex, playing, speedMs, tool } = props
  // A saved play on a map the registry no longer lists keeps its own name in the picker.
  const options = map && !mapNames.includes(map) ? [map, ...mapNames] : mapNames
  const active = steps[stepIndex]

  const removeStep = (index: number) => {
    const step = steps[index]
    if (!step || steps.length <= 1) return
    if (step.elements.length > 0 && !window.confirm(`Remove step ${index + 1} (${step.name}) and what is drawn on it?`)) return
    props.onRemoveStep(index)
  }

  const clearAll = () => {
    if (window.confirm('Clear everything drawn on every step?')) props.onClearAll()
  }

  return (
    <div className="flex flex-row lg:flex-col gap-4 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto p-2 h-full">
      <section className="shrink-0 w-32 lg:w-auto space-y-1.5">
        <div className={label}>Map</div>
        <select value={map} onChange={e => props.onMap(e.target.value)} aria-label="Map" className={`${field} w-full px-1 py-1`}>
          {options.length === 0 && <option value="">Loading…</option>}
          {options.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Side" className="grid grid-cols-2 rounded-md border border-bg-elevated p-0.5">
          {SIDES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => props.onSide(s.value)}
              aria-pressed={side === s.value}
              title={s.value === 'attack' ? 'Attack' : 'Defense'}
              className={`text-[10px] font-semibold tracking-wider py-0.5 rounded transition-colors ${
                side === s.value ? s.on : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section className={section}>
        <div className={label}>Steps</div>
        <div className="grid grid-cols-5 gap-0.5">
          {steps.map((step, i) => (
            <div key={step.id} className="relative group">
              <button
                type="button"
                onClick={() => props.onPickStep(i)}
                onContextMenu={e => {
                  e.preventDefault()
                  removeStep(i)
                }}
                aria-current={i === stepIndex ? 'step' : undefined}
                title={step.name}
                className={`w-full h-6 rounded text-[11px] font-semibold tabular-nums transition-colors ${
                  i === stepIndex
                    ? 'bg-val-cyan text-bg-primary'
                    : 'bg-bg-elevated/60 text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                }`}
              >
                {i + 1}
              </button>
              {i !== stepIndex && steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  aria-label={`Remove step ${i + 1}`}
                  title={`Remove step ${i + 1}`}
                  className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-3 h-3 rounded-full bg-bg-primary border border-bg-elevated text-text-muted hover:text-val-red"
                >
                  <X className="w-2 h-2" />
                </button>
              )}
            </div>
          ))}
          {steps.length < MAX_STEPS && (
            <button
              type="button"
              onClick={props.onAddStep}
              aria-label="Add a step"
              title="Add a step (copies this one)"
              className="h-6 rounded border border-dashed border-bg-elevated text-text-muted hover:text-val-cyan hover:border-val-cyan/50 flex items-center justify-center transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={props.onTogglePlay}
            disabled={steps.length < 2}
            aria-label={playing ? 'Pause' : 'Play the steps'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center bg-bg-elevated/60 text-text-secondary hover:text-val-cyan disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={100}
            value={speedMs}
            onChange={e => props.onSpeed(Number(e.target.value))}
            aria-label="Seconds per step"
            title={`${(speedMs / 1000).toFixed(1)} s per step`}
            className="min-w-0 flex-1 accent-val-cyan"
          />
        </div>
        {active && (
          <input
            value={active.name}
            onChange={e => props.onStepName(e.target.value)}
            aria-label="Step name"
            placeholder={`Step ${stepIndex + 1}`}
            className={`${field} w-full px-1.5 py-1`}
          />
        )}
      </section>

      <section className={section}>
        <div className={label}>Tools</div>
        <div className="grid grid-cols-4 gap-0.5">
          {TOOLS.map(({ tool: t, name, key, Icon }) => (
            <button
              key={t}
              type="button"
              onClick={() => props.onTool(t)}
              aria-pressed={tool === t}
              aria-label={name}
              title={toolTitle(name, key, props.inReplay)}
              className={`h-6 rounded flex items-center justify-center transition-colors ${
                tool === t ? 'bg-val-cyan text-bg-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </section>

      <section className={section}>
        <div className={label}>Clear</div>
        <div className="flex lg:flex-col gap-1">
          <button type="button" onClick={props.onClearStep} className={smallButton}>
            This step
          </button>
          <button type="button" onClick={clearAll} className={`${smallButton} hover:text-val-red hover:border-val-red/40`}>
            Everything
          </button>
        </div>
      </section>
    </div>
  )
}
