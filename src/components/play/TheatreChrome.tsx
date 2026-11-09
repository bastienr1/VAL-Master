import { Layers, Minimize2, Sparkles, Tag, UserRound } from 'lucide-react'
import type { Tool } from '../PlayCanvas'
import type { CanvasSizes } from '../../lib/canvasSizes'
import type { CanvasSkinId } from '../../lib/canvasSkins'
import SizePicker from './SizePicker'
import SkinPicker from './SkinPicker'
import { TOOLS, toolTitle } from './tools'

interface TheatreChromeProps {
  title: string
  onExit(): void
  showCallouts: boolean
  onToggleCallouts(): void
  showNames: boolean
  onToggleNames(): void
  /** What each agent has left: given while a replay is open. */
  showKit?: boolean
  onToggleKit?(): void
  showControl: boolean
  onToggleControl(): void
  sizes: CanvasSizes
  onSizes(sizes: CanvasSizes): void
  skin: CanvasSkinId
  onSkin(skin: CanvasSkinId): void
  canSave: boolean
  saving: boolean
  onSave(): void
  tool: Tool
  onTool(tool: Tool): void
  /** The step buttons; null while a replay plays on the page (its transport stands there). */
  steps: { id: string; name: string }[] | null
  /** A replay is on screen: T takes a note there. */
  inReplay: boolean
  stepIndex: number
  onPickStep(index: number): void
}

const panel = 'pointer-events-auto absolute rounded-xl border border-bg-elevated bg-bg-secondary/90 backdrop-blur-sm'
const toggle = (on: boolean) =>
  `flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
    on
      ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/25'
      : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-bg-elevated/60'
  }`

/** Theatre mode's floating controls over the full-bleed map (docs/plays-editor-v2.md §2.12). F or Esc leaves it. */
export default function TheatreChrome(props: TheatreChromeProps) {
  const { tool, steps, stepIndex } = props
  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      <div className={`${panel} left-3 top-3 flex items-center gap-2 px-2.5 py-1.5 max-w-[30%]`}>
        <button type="button" onClick={props.onExit} aria-label="Leave Theatre mode" title="Leave Theatre mode (F)" className="text-text-secondary hover:text-val-cyan transition-colors">
          <Minimize2 className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-base font-bold truncate">{props.title}</h1>
      </div>

      <div className={`${panel} left-1/2 -translate-x-1/2 top-3 flex items-center gap-1 p-1`}>
        <button type="button" onClick={props.onToggleCallouts} aria-pressed={props.showCallouts} className={toggle(props.showCallouts)}>
          <Tag className="w-3.5 h-3.5" />
          Callouts
        </button>
        <button type="button" onClick={props.onToggleNames} aria-pressed={props.showNames} className={toggle(props.showNames)}>
          <UserRound className="w-3.5 h-3.5" />
          Names
        </button>
        {props.onToggleKit && (
          <button type="button" onClick={props.onToggleKit} aria-pressed={props.showKit === true} className={toggle(props.showKit === true)}>
            <Sparkles className="w-3.5 h-3.5" />
            Abilities
          </button>
        )}
        <button type="button" onClick={props.onToggleControl} aria-pressed={props.showControl} className={toggle(props.showControl)}>
          <Layers className="w-3.5 h-3.5" />
          Control
        </button>
        <SizePicker sizes={props.sizes} onSizes={props.onSizes} buttonClass={toggle(false)} />
        <SkinPicker skin={props.skin} onPick={props.onSkin} buttonClass={toggle(false)} />
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.canSave || props.saving}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-val-cyan/10 text-val-cyan border border-val-cyan/25 hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {props.saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <nav aria-label="Tools" className={`${panel} left-3 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 p-1`}>
        {TOOLS.map(({ tool: t, name, key, Icon }) => (
          <button
            key={t}
            type="button"
            onClick={() => props.onTool(t)}
            aria-pressed={tool === t}
            aria-label={name}
            title={toolTitle(name, key, props.inReplay)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              tool === t ? 'bg-val-cyan text-bg-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/60'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </nav>

      {steps && (
        <div role="group" aria-label="Steps" className={`${panel} left-1/2 -translate-x-1/2 bottom-4 flex items-center gap-1 p-1`}>
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => props.onPickStep(i)}
              aria-current={i === stepIndex ? 'step' : undefined}
              title={s.name}
              className={`w-9 h-9 rounded-lg text-sm font-stats transition-colors ${
                i === stepIndex ? 'bg-val-cyan text-bg-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/60'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
