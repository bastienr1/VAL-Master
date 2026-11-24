import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import {
  CLICK_LABELS,
  IMAGE_SLOT_LABELS,
  LINEUP_CLICKS,
  LINEUP_IMAGE_SLOTS,
  LINEUP_MOVEMENTS,
  LINEUP_PURPOSES,
  LINEUP_STANCES,
  MOVEMENT_LABELS,
  PURPOSE_LABELS,
  STANCE_LABELS,
  clipEmbedUrl,
  formatClock,
  imageColumn,
  parseClock,
  type Lineup,
  type LineupImageSlot,
  type LineupInput,
} from '../lib/lineupModel'
import { lineupImageUrl } from '../lib/lineups'
import LineColorSwatches from './LineColorSwatches'

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const FIELD = 'w-full bg-bg-primary border border-bg-elevated rounded-md px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-val-cyan/60'
const LABEL = 'text-[10px] uppercase tracking-wider font-semibold text-text-muted'

/** A text field that keeps what is typed to itself and hands it over when left (or on Enter). */
function DraftField({ value, onCommit, placeholder, area, label }: {
  value: string
  onCommit(value: string): void
  placeholder?: string
  area?: boolean
  label: string
}) {
  const [draft, setDraft] = useState(value)
  // What was saved changed under it (another line-up, a refusal): show that.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return area ? (
    <textarea aria-label={label} value={draft} placeholder={placeholder} rows={3} onChange={e => setDraft(e.target.value)} onBlur={commit} className={`${FIELD} resize-y`} />
  ) : (
    <input
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={FIELD}
    />
  )
}

/** One choice of a few, or none: pressing the chosen one again clears it. */
function Chips<T extends string | number>({ label, options, value, onPick }: {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onPick(value: T | null): void
}) {
  return (
    <div className="space-y-1">
      <div className={LABEL}>{label}</div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map(option => {
          const on = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? null : option.value)}
              className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                on ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40' : 'bg-bg-primary text-text-secondary border-bg-elevated hover:border-val-cyan/30'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const COUNTS = [0, 1, 2, 3].map(n => ({ value: n, label: String(n) }))
const LINE_STYLES = [
  { value: 'straight', label: 'Straight' },
  { value: 'curved', label: 'Curved' },
] as const

export interface LineupCardProps {
  lineup: Lineup
  /** The ability's name and icon, from the registry. */
  ability: { name: string; icon: string | null }
  agentIcon: string | null
  onPatch(patch: Partial<LineupInput>): void
  onImage(slot: LineupImageSlot, file: Blob): Promise<void>
  onClearImage(slot: LineupImageSlot): Promise<void>
  onDelete(): void
  onClose(): void
}

/**
 * One line-up, open: its three pictures (paste, drop or pick), its clip, how
 * it is thrown and what it is for. Every field saves as it is left.
 */
export default function LineupCard({ lineup, ability, agentIcon, onPatch, onImage, onClearImage, onDelete, onClose }: LineupCardProps) {
  const paths = LINEUP_IMAGE_SLOTS.map(slot => lineup[imageColumn(slot)])
  const firstEmpty = LINEUP_IMAGE_SLOTS.find((_, i) => !paths[i]) ?? null
  /** The slot a pasted picture goes to: the one last pressed, else the first empty one. */
  const [armed, setArmed] = useState<LineupImageSlot | null>(null)
  const [busy, setBusy] = useState<LineupImageSlot | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [viewing, setViewing] = useState<LineupImageSlot | null>(null)
  const [confirming, setConfirming] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const pickFor = useRef<LineupImageSlot>('stand')

  const store = useCallback(
    async (slot: LineupImageSlot, file: Blob) => {
      setBusy(slot)
      setProblem(null)
      try {
        await onImage(slot, file)
        setArmed(null)
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'That picture could not be saved.')
      } finally {
        setBusy(null)
      }
    },
    [onImage],
  )

  // A screenshot pasted anywhere on the page lands in the armed slot.
  const target = armed ?? firstEmpty
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'))
      if (!file || !target) return
      e.preventDefault()
      void store(target, file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [store, target])

  // The big picture: arrows step through the three, Escape closes it.
  useEffect(() => {
    if (!viewing) return
    const filled = LINEUP_IMAGE_SLOTS.filter(slot => lineup[imageColumn(slot)])
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setViewing(null)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const at = filled.indexOf(viewing)
        const next = filled[(at + (e.key === 'ArrowRight' ? 1 : filled.length - 1)) % filled.length]
        if (next) setViewing(next)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [viewing, lineup])

  const browse = (slot: LineupImageSlot) => {
    pickFor.current = slot
    picker.current?.click()
  }

  const clip = clipEmbedUrl(lineup.video_url, lineup.video_start, lineup.video_end)
  const viewingPath = viewing ? lineup[imageColumn(viewing)] : null

  const section = (title: string, children: ReactNode) => (
    <section className="space-y-2">
      <h3 className="font-heading text-sm font-bold tracking-wide text-text-secondary">{title}</h3>
      {children}
    </section>
  )

  return (
    <div className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-5" data-lineup-card={lineup.id}>
      <div className="flex items-start gap-3">
        <div className="relative shrink-0 w-11 h-11 rounded-lg bg-bg-elevated flex items-center justify-center">
          {ability.icon ? <img src={ability.icon} alt="" className="w-7 h-7 object-contain" /> : null}
          {agentIcon && <img src={agentIcon} alt="" className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-bg-primary border border-bg-elevated object-cover" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <DraftField key={lineup.id} label="Name" value={lineup.title} onCommit={title => title.trim() && onPatch({ title: title.trim() })} />
          <div className="text-xs text-text-muted">
            {lineup.agent} · {ability.name} · {lineup.map} · {lineup.side === 'attack' ? 'Attack' : 'Defense'}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {section(
        'Pictures',
        <>
          <div className="grid grid-cols-3 gap-2">
            {LINEUP_IMAGE_SLOTS.map((slot, i) => {
              const path = paths[i]
              const isTarget = target === slot
              return (
                <div key={slot} className="space-y-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={LABEL}>{IMAGE_SLOT_LABELS[slot].title}</span>
                    {path && (
                      <button type="button" onClick={() => void onClearImage(slot).catch(err => setProblem(err instanceof Error ? err.message : 'Could not remove it.'))} className="text-[10px] text-text-muted hover:text-val-red transition-colors">
                        Remove
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={path ? `${IMAGE_SLOT_LABELS[slot].title} picture: open` : `${IMAGE_SLOT_LABELS[slot].title} picture: empty`}
                    onClick={() => (path ? setViewing(slot) : setArmed(slot))}
                    onDoubleClick={() => !path && browse(slot)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'))
                      if (file) void store(slot, file)
                    }}
                    className={`relative block w-full aspect-video rounded-lg overflow-hidden border text-left transition-colors ${
                      isTarget ? 'border-val-cyan/60 bg-val-cyan/5' : 'border-bg-elevated bg-bg-primary hover:border-val-cyan/30'
                    }`}
                  >
                    {path ? (
                      <img src={lineupImageUrl(path)} alt={IMAGE_SLOT_LABELS[slot].hint} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center text-[10px] leading-tight text-text-muted">
                        <ImagePlus className="w-4 h-4" aria-hidden="true" />
                        {busy === slot ? 'Saving…' : isTarget ? 'Ctrl+V to paste here' : IMAGE_SLOT_LABELS[slot].hint}
                      </span>
                    )}
                    {busy === slot && path && <span className="absolute inset-0 bg-bg-primary/70 flex items-center justify-center text-[10px] text-text-secondary">Saving…</span>}
                  </button>
                  <button type="button" onClick={() => browse(slot)} className="text-[10px] text-text-muted hover:text-val-cyan transition-colors">
                    {path ? 'Replace' : 'Browse'}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-text-muted">Paste a screenshot with Ctrl+V: it goes to the highlighted slot. You can also drop a file on a slot.</p>
          {problem && <p className="text-xs text-val-red">{problem}</p>}
          <input
            ref={picker}
            type="file"
            accept="image/webp,image/png,image/jpeg"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void store(pickFor.current, file)
            }}
          />
        </>,
      )}

      {section(
        'How to throw it',
        <div className="space-y-3">
          <Chips label="Stance" options={LINEUP_STANCES.map(value => ({ value, label: STANCE_LABELS[value] }))} value={lineup.stance} onPick={stance => onPatch({ stance })} />
          <Chips label="Movement" options={LINEUP_MOVEMENTS.map(value => ({ value, label: MOVEMENT_LABELS[value] }))} value={lineup.movement} onPick={movement => onPatch({ movement })} />
          <Chips label="Click" options={LINEUP_CLICKS.map(value => ({ value, label: CLICK_LABELS[value] }))} value={lineup.click} onPick={click => onPatch({ click })} />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Chips
              label="Line on the map"
              options={LINE_STYLES}
              value={lineup.curved ? 'curved' : 'straight'}
              onPick={style => style && onPatch({ curved: style === 'curved' })}
            />
            {lineup.via.length > 0 && (
              <button type="button" onClick={() => onPatch({ via: [] })} className="pb-1 text-xs text-text-muted hover:text-val-red transition-colors">
                Remove {lineup.via.length === 1 ? 'its bend' : `its ${lineup.via.length} bends`}
              </button>
            )}
          </div>
          <div className="space-y-1">
            <div className={LABEL}>Line colour</div>
            <LineColorSwatches label="Line colour" value={lineup.line_color} onPick={line_color => onPatch({ line_color })} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Chips label="Bounces" options={COUNTS} value={lineup.bounces} onPick={bounces => onPatch({ bounces })} />
            <Chips label="Charge bars" options={COUNTS} value={lineup.charge} onPick={charge => onPatch({ charge })} />
          </div>
        </div>,
      )}

      {section(
        'What it is for',
        <div className="space-y-3">
          <Chips label="Purpose" options={LINEUP_PURPOSES.map(value => ({ value, label: PURPOSE_LABELS[value] }))} value={lineup.purpose} onPick={purpose => onPatch({ purpose })} />
          <DraftField key={`note:${lineup.id}`} area label="Note" value={lineup.note} placeholder="When to use it, what to watch for" onCommit={note => onPatch({ note })} />
        </div>,
      )}

      {section(
        'Clip',
        <div className="space-y-2">
          <DraftField key={`url:${lineup.id}`} label="YouTube link" value={lineup.video_url ?? ''} placeholder="YouTube link" onCommit={url => onPatch({ video_url: url.trim() || null })} />
          <div className="grid grid-cols-2 gap-2">
            <DraftField key={`start:${lineup.id}`} label="Clip start" value={formatClock(lineup.video_start)} placeholder="Start, e.g. 1:23" onCommit={text => onPatch({ video_start: parseClock(text) })} />
            <DraftField key={`end:${lineup.id}`} label="Clip end" value={formatClock(lineup.video_end)} placeholder="End, e.g. 1:31" onCommit={text => onPatch({ video_end: parseClock(text) })} />
          </div>
          {clip ? (
            <div className="aspect-video rounded-lg overflow-hidden border border-bg-elevated bg-black">
              <iframe key={clip} src={clip} title={`${lineup.title}: clip`} allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen className="w-full h-full" />
            </div>
          ) : (
            lineup.video_url && <p className="text-xs text-val-red">That link is not a YouTube video.</p>
          )}
        </div>,
      )}

      {section(
        'Checked',
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <DraftField key={`patch:${lineup.id}`} label="Patch" value={lineup.patch ?? ''} placeholder="Patch, e.g. 13.10" onCommit={patch => onPatch({ patch: patch.trim() || null })} />
            <input type="date" aria-label="Checked on" value={lineup.verified_on ?? ''} onChange={e => onPatch({ verified_on: e.target.value || null })} className={FIELD} />
          </div>
          <button type="button" onClick={() => onPatch({ verified_on: today() })} className="text-xs text-text-secondary hover:text-val-cyan transition-colors">
            Checked today
          </button>
        </div>,
      )}

      <div className="pt-1 border-t border-bg-elevated flex items-center justify-between gap-2">
        {confirming ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-secondary">Delete this line-up and its pictures?</span>
            <button type="button" onClick={onDelete} className="px-2 py-1 rounded-md bg-val-red/15 text-val-red border border-val-red/30 hover:bg-val-red/25 transition-colors">
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="px-2 py-1 rounded-md text-text-secondary hover:text-text-primary transition-colors">
              Keep
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-val-red transition-colors mt-2">
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        )}
      </div>

      {viewing && viewingPath && (
        <div role="dialog" aria-label={`${IMAGE_SLOT_LABELS[viewing].title} picture`} onClick={() => setViewing(null)} className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-3 p-6 cursor-zoom-out">
          <img src={lineupImageUrl(viewingPath)} alt={IMAGE_SLOT_LABELS[viewing].hint} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
          <div className="text-sm text-text-secondary">
            {IMAGE_SLOT_LABELS[viewing].title}: {IMAGE_SLOT_LABELS[viewing].hint.toLowerCase()} · {lineup.title}
          </div>
        </div>
      )}
    </div>
  )
}
