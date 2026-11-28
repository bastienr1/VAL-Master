import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarCheck, Check, Crosshair, Ellipsis, ImagePlus, Layers, MousePointerClick, Move, Pencil, PersonStanding, Trash2, X } from 'lucide-react'
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
function Chips<T extends string | number>({ label, options, value, onPick, bare = false }: {
  label: string
  /** Without its label above: the section's title already says it. */
  bare?: boolean
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onPick(value: T | null): void
}) {
  return (
    <div className="space-y-1">
      {!bare && <div className={LABEL}>{label}</div>}
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
  /** How the last save went, shown beside the line-up's facts: there is no Save button. */
  status?: ReactNode
  /** Open with the fields to fill in rather than as a read view: a line-up just made. */
  startEditing?: boolean
}

/** A date as the table keeps it (YYYY-MM-DD), the way this browser writes dates. */
const shownDate = (iso: string | null) => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString() : null
}

/** One part of the recipe in the read view: what it is, and what it is for this line-up. */
function RecipeTile({ icon: Icon, label, value }: { icon: typeof Move; label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-bg-elevated bg-bg-primary/60 p-2.5 space-y-2 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div
        className={`text-center text-xs rounded-md border px-2 py-1 truncate ${
          value ? 'border-val-cyan/50 bg-val-cyan/10 text-val-cyan' : 'border-bg-elevated text-text-muted'
        }`}
      >
        {value ?? 'Not set'}
      </div>
    </div>
  )
}

/**
 * One line-up, open: its three pictures (paste, drop or pick), its clip, how
 * it is thrown and what it is for. Every field saves as it is left.
 */
export default function LineupCard({ lineup, ability, agentIcon, onPatch, onImage, onClearImage, onDelete, onClose, status, startEditing = false }: LineupCardProps) {
  /** The card reads as the line-up; Edit opens its fields. */
  const [editing, setEditing] = useState(startEditing)
  const [menu, setMenu] = useState(false)
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
      if (!file || !target || !editing) return
      e.preventDefault()
      void store(target, file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [store, target, editing])

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

  const menuBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMenu(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

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

  const recipeExtra = [
    lineup.bounces !== null ? (lineup.bounces === 0 ? 'No bounce' : `${lineup.bounces} ${lineup.bounces === 1 ? 'bounce' : 'bounces'}`) : null,
    lineup.charge !== null ? `${lineup.charge} ${lineup.charge === 1 ? 'charge bar' : 'charge bars'}` : null,
  ].filter(Boolean)

  return (
    <div data-lineup-card={lineup.id} data-editing={editing}>
      {/* The card's tabs: the line-up's details, and (not built yet) its flashcards. */}
      <div className="flex">
        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-t-xl border border-b-0 border-val-red/50 bg-val-red/10 font-heading font-semibold">
          <Crosshair className="w-4 h-4 text-val-red" aria-hidden="true" />
          Details
        </span>
        <span aria-disabled="true" title="Not built yet" className="inline-flex items-center gap-2 px-4 py-2 font-heading font-semibold text-text-muted cursor-default">
          <Layers className="w-4 h-4" aria-hidden="true" />
          Flashcards
          <span className="text-[10px] font-sans font-normal uppercase tracking-wider opacity-70">Soon</span>
        </span>
      </div>
    <div className="bg-bg-card border border-bg-elevated rounded-xl rounded-tl-none p-4 space-y-5">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0 w-12 h-12 rounded-lg bg-bg-elevated flex items-center justify-center">
          {ability.icon ? <img src={ability.icon} alt="" className="w-7 h-7 object-contain" /> : null}
          {agentIcon && <img src={agentIcon} alt="" className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-bg-primary border border-bg-elevated object-cover" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {editing ? (
            <DraftField key={lineup.id} label="Name" value={lineup.title} onCommit={title => title.trim() && onPatch({ title: title.trim() })} />
          ) : (
            <h2 className="font-heading font-bold text-xl leading-tight">{lineup.title}</h2>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span className="min-w-0 truncate">
              {lineup.agent} · {ability.name} · {lineup.map} · {lineup.side === 'attack' ? 'Attack' : 'Defense'}
            </span>
            {status}
          </div>
        </div>
        <div ref={menuBox} className="relative shrink-0">
          <button
            type="button"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(m => !m)}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            <Ellipsis className="w-4 h-4" />
          </button>
          {menu && (
            <div role="menu" className="absolute z-30 right-0 mt-1 w-44 rounded-lg border border-bg-elevated bg-bg-card shadow-xl p-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setEditing(e => !e)
                  setMenu(false)
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-bg-elevated transition-colors"
              >
                {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                {editing ? 'Done editing' : 'Edit'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setConfirming(true)
                  setMenu(false)
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left text-val-red hover:bg-val-red/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete…
              </button>
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 text-xs rounded-lg border border-val-red/30 bg-val-red/10 px-3 py-2">
          <span className="text-text-secondary">Delete this line-up and its pictures?</span>
          <button type="button" onClick={onDelete} className="px-2 py-1 rounded-md bg-val-red/15 text-val-red border border-val-red/30 hover:bg-val-red/25 transition-colors">
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="px-2 py-1 rounded-md text-text-secondary hover:text-text-primary transition-colors">
            Keep
          </button>
        </div>
      )}

      {section(
        'Pictures',
        <>
          <div className="grid grid-cols-3 gap-2">
            {LINEUP_IMAGE_SLOTS.map((slot, i) => {
              const path = paths[i]
              const isTarget = editing && target === slot
              return (
                <div key={slot} className="space-y-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={LABEL}>{IMAGE_SLOT_LABELS[slot].title}</span>
                    {path && editing && (
                      <button type="button" onClick={() => void onClearImage(slot).catch(err => setProblem(err instanceof Error ? err.message : 'Could not remove it.'))} className="text-[10px] text-text-muted hover:text-val-red transition-colors">
                        Remove
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={path ? `${IMAGE_SLOT_LABELS[slot].title} picture: open` : `${IMAGE_SLOT_LABELS[slot].title} picture: empty`}
                    onClick={() => (path ? setViewing(slot) : editing && setArmed(slot))}
                    onDoubleClick={() => !path && editing && browse(slot)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      if (!editing) return
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
                        {busy === slot ? 'Saving…' : !editing ? 'No picture' : isTarget ? 'Ctrl+V to paste here' : IMAGE_SLOT_LABELS[slot].hint}
                      </span>
                    )}
                    {busy === slot && path && <span className="absolute inset-0 bg-bg-primary/70 flex items-center justify-center text-[10px] text-text-secondary">Saving…</span>}
                  </button>
                  {editing && (
                    <button type="button" onClick={() => browse(slot)} className="text-[10px] text-text-muted hover:text-val-cyan transition-colors">
                      {path ? 'Replace' : 'Browse'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {editing && <p className="text-[11px] text-text-muted">Paste a screenshot with Ctrl+V: it goes to the highlighted slot. You can also drop a file on a slot.</p>}
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

      {!editing && (
        <>
          {section(
            'How to throw it',
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <RecipeTile icon={PersonStanding} label="Stance" value={lineup.stance ? STANCE_LABELS[lineup.stance] : null} />
                <RecipeTile icon={Move} label="Movement" value={lineup.movement ? MOVEMENT_LABELS[lineup.movement] : null} />
                <RecipeTile icon={MousePointerClick} label="Click" value={lineup.click ? CLICK_LABELS[lineup.click] : null} />
              </div>
              {recipeExtra.length > 0 && <p className="text-xs text-text-secondary">{recipeExtra.join(' · ')}</p>}
            </div>,
          )}
          {section(
            'Purpose',
            <div className="space-y-3">
              <Chips bare label="Purpose" options={LINEUP_PURPOSES.map(value => ({ value, label: PURPOSE_LABELS[value] }))} value={lineup.purpose} onPick={purpose => onPatch({ purpose })} />
              {lineup.note.trim() && <p className="rounded-lg border border-bg-elevated bg-bg-primary/60 px-3 py-2.5 text-sm text-text-secondary whitespace-pre-line">{lineup.note}</p>}
            </div>,
          )}
          {clip && section(
            'Clip',
            <div className="aspect-video rounded-lg overflow-hidden border border-bg-elevated bg-black">
              <iframe key={clip} src={clip} title={`${lineup.title}: clip`} allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen className="w-full h-full" />
            </div>,
          )}
          <div className="grid grid-cols-2 border-t border-bg-elevated pt-3">
            <div className="flex items-center gap-2.5 pr-3">
              <Crosshair className="w-5 h-5 text-text-secondary shrink-0" aria-hidden="true" />
              <div className="leading-tight">
                <div className={LABEL}>Patch</div>
                <div className="font-stats text-sm">{lineup.patch ?? '—'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 pl-3 border-l border-bg-elevated">
              <CalendarCheck className="w-5 h-5 text-text-secondary shrink-0" aria-hidden="true" />
              <div className="leading-tight">
                <div className={LABEL}>Checked</div>
                <div className="font-stats text-sm">{shownDate(lineup.verified_on) ?? '—'}</div>
              </div>
            </div>
          </div>
        </>
      )}

      {editing && (
        <>
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

        </>
      )}

      <button
        type="button"
        onClick={() => setEditing(e => !e)}
        className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-heading font-bold text-lg transition-colors ${
          editing ? 'bg-bg-elevated text-text-primary hover:bg-bg-elevated/70' : 'bg-val-cyan text-bg-primary hover:bg-val-cyan/85'
        }`}
      >
        {editing ? <Check className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
        {editing ? 'Done' : 'Edit'}
      </button>

      {viewing && viewingPath && (
        <div role="dialog" aria-label={`${IMAGE_SLOT_LABELS[viewing].title} picture`} onClick={() => setViewing(null)} className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-3 p-6 cursor-zoom-out">
          <img src={lineupImageUrl(viewingPath)} alt={IMAGE_SLOT_LABELS[viewing].hint} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
          <div className="text-sm text-text-secondary">
            {IMAGE_SLOT_LABELS[viewing].title}: {IMAGE_SLOT_LABELS[viewing].hint.toLowerCase()} · {lineup.title}
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
