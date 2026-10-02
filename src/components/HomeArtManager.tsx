import { useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Loader2, Trash2, Upload } from 'lucide-react'
import ArtSlot, { ArtLayer } from './ArtSlot'
import { useArtSlotRows } from '../hooks/useArtSlot'
import { useGameContent } from '../hooks/useGameContent'
import {
  ART_ACCEPT,
  DEFAULT_FOCAL,
  DEFAULT_OVERLAY,
  SLOT_KEYS,
  STATIC_SLOTS,
  agentSlotSpec,
  mapHeaderSlotSpec,
  focalFromClick,
  mapSlotSpec,
  slotRowStatus,
  validateArtFile,
  type ArtSlotRow,
  type ArtSource,
  type SlotRowStatus,
  type SlotSpec,
} from '../lib/artSlots'
import {
  removeArtSlot,
  setArtSlotUrl,
  updateArtSlot,
  uploadArtSlot,
  type ArtSlotOptions,
} from '../lib/artSlotStore'
import { PORTRAIT_CLASS, PORTRAIT_FOCAL } from '../lib/agentPortrait'
import { agentGradientCss } from '../lib/gameContent'
import { extractYouTubeId } from '../lib/youtube'
import { isSafeUrl, normalizeUrl } from '../lib/url'

/** A slot plus the defaults it falls back to, as Home itself would draw it. */
interface ManagedSlot {
  spec: SlotSpec
  apiDefault: string | null
  gradientFallback: string | null
  /** Agent portraits only: the API image is framed differently from an upload. */
  portrait: boolean
}

/** An override being composed. Nothing is written until Save. */
interface Draft {
  slotKey: string
  /** The row being edited, or null for a new override. */
  rowId: string | null
  /** A new upload. Null when the image is a URL or an existing row's. */
  file: File | null
  imageUrl: string
  /** What the preview shows: an object URL for `file`, else `imageUrl`. */
  previewSrc: string
  focal: { x: number; y: number }
  overlay: number
  /** `datetime-local` values. Blank = from now / no end. */
  activeFrom: string
  activeUntil: string
  /** As loaded, so an untouched schedule is left exactly as stored. */
  initialActiveFrom: string
  initialActiveUntil: string
  href: string
}

const SOURCE_BADGE: Record<ArtSource, { label: string; className: string }> = {
  override: { label: 'Override', className: 'bg-val-cyan/15 text-val-cyan' },
  api: { label: 'API', className: 'bg-bg-elevated text-text-secondary' },
  bundled: { label: 'Bundled', className: 'bg-bg-elevated text-text-secondary' },
  gradient: { label: 'Gradient', className: 'bg-val-yellow/15 text-val-yellow' },
}

const STATUS_BADGE: Record<SlotRowStatus, { label: string; className: string }> = {
  live: { label: 'Showing', className: 'bg-val-green/15 text-val-green' },
  scheduled: { label: 'Scheduled', className: 'bg-val-cyan/15 text-val-cyan' },
  covered: { label: 'Covered', className: 'bg-bg-elevated text-text-secondary' },
  expired: { label: 'Expired', className: 'bg-bg-elevated text-text-muted' },
}

const inputClass =
  'w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors'
const smallButton =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-bg-elevated text-xs text-text-secondary hover:text-val-cyan hover:border-val-cyan/40 transition-colors disabled:opacity-40 disabled:pointer-events-none'
const fieldLabel = 'text-xs text-text-secondary uppercase tracking-wider font-medium'

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO timestamp → the local `YYYY-MM-DDTHH:mm` a datetime-local input wants. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromLocalInput = (value: string) => new Date(value).toISOString()

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function draftFromRow(row: ArtSlotRow): Draft {
  const activeFrom = toLocalInput(row.active_from)
  const activeUntil = toLocalInput(row.active_until)
  return {
    slotKey: row.slot_key,
    rowId: row.id,
    file: null,
    imageUrl: row.image_url,
    previewSrc: row.image_url,
    focal: { x: row.focal_x, y: row.focal_y },
    overlay: row.overlay,
    activeFrom,
    activeUntil,
    initialActiveFrom: activeFrom,
    initialActiveUntil: activeUntil,
    href: row.href ?? '',
  }
}

function newDraft(slotKey: string, image: { file: File; previewSrc: string } | { url: string }): Draft {
  const fromFile = 'file' in image
  return {
    slotKey,
    rowId: null,
    file: fromFile ? image.file : null,
    imageUrl: fromFile ? '' : image.url,
    previewSrc: fromFile ? image.previewSrc : image.url,
    focal: DEFAULT_FOCAL,
    overlay: DEFAULT_OVERLAY,
    activeFrom: '',
    activeUntil: '',
    initialActiveFrom: '',
    initialActiveUntil: '',
    href: '',
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Slot row
// ──────────────────────────────────────────────────────────────────────────

interface SlotRowProps {
  slot: ManagedSlot
  liveRow: ArtSlotRow | null
  /** Rows for this slot that aren't showing: scheduled, covered or expired. */
  otherRows: number
  selected: boolean
  disabled: boolean
  onSelect: () => void
  onPickFile: (file: File) => void
  onPasteUrl: (url: string) => string | null
  onRemove: (row: ArtSlotRow) => void
}

function SlotRow({ slot, liveRow, otherRows, selected, disabled, onSelect, onPickFile, onPasteUrl, onRemove }: SlotRowProps) {
  const { spec } = slot
  const fileInput = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<ArtSource | null>(null)
  const [pasting, setPasting] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const submitUrl = () => {
    const refusal = onPasteUrl(url)
    setUrlError(refusal)
    if (!refusal) {
      setPasting(false)
      setUrl('')
    }
  }

  const badge = source ? SOURCE_BADGE[source] : null

  return (
    <div className={`rounded-lg border p-2.5 transition-colors ${selected ? 'border-val-cyan/50 bg-bg-elevated/30' : 'border-bg-elevated'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={onSelect} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-expanded={selected}>
          <ArtSlot
            slotKey={spec.key}
            apiDefault={slot.apiDefault}
            apiFocal={slot.portrait ? PORTRAIT_FOCAL : undefined}
            apiImgClassName={slot.portrait ? PORTRAIT_CLASS : undefined}
            gradientFallback={slot.gradientFallback}
            scrim={spec.scrim}
            onResolve={setSource}
            className="w-20 h-12 rounded-md shrink-0 border border-bg-elevated"
          />
          <span className="min-w-0">
            <span className="block text-sm text-text-primary truncate">{spec.label}</span>
            <span className="block font-stats text-[10px] text-text-muted">
              {spec.width}×{spec.height}
              {otherRows > 0 && ` · ${otherRows} more saved`}
            </span>
          </span>
        </button>

        {badge && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`} title="What this slot is showing right now">
            {badge.label}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled} className={smallButton}>
            <Upload className="w-3 h-3" />
            Upload
          </button>
          <button type="button" onClick={() => setPasting(open => !open)} disabled={disabled} className={smallButton} aria-expanded={pasting}>
            <Link2 className="w-3 h-3" />
            Paste URL
          </button>
          {liveRow &&
            (confirmingRemove ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingRemove(false)
                    onRemove(liveRow)
                  }}
                  className="px-2 py-1.5 rounded-md text-xs text-val-red border border-val-red/25 bg-val-red/10 hover:bg-val-red/20"
                >
                  Remove
                </button>
                <button type="button" onClick={() => setConfirmingRemove(false)} className="px-2 py-1.5 rounded-md text-xs text-text-muted hover:text-text-secondary">
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                disabled={disabled}
                className={`${smallButton} hover:text-val-red hover:border-val-red/40`}
                aria-label={`Remove the override on ${spec.label}`}
                title="Remove this override; the slot falls back to its default"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            ))}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ART_ACCEPT}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = '' // so the same file can be picked again
            if (file) onPickFile(file)
          }}
        />
      </div>

      {pasting && (
        <div className="mt-2.5 space-y-1">
          <div className="flex gap-2">
            <input
              autoFocus
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitUrl()
                }
              }}
              placeholder="https://… link to a WebP, PNG or JPEG"
              aria-label={`Image URL for ${spec.label}`}
              className={inputClass}
            />
            <button type="button" onClick={submitUrl} className={smallButton}>
              Preview
            </button>
          </div>
          {urlError && <p className="text-xs text-val-red">{urlError}</p>}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Editor
// ──────────────────────────────────────────────────────────────────────────

interface SlotEditorProps {
  slot: ManagedSlot
  draft: Draft | null
  /** Every saved row for this slot, newest first. */
  rows: ArtSlotRow[]
  allRows: ArtSlotRow[]
  busy: boolean
  error: string | null
  onChange: (patch: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
  onEditRow: (row: ArtSlotRow) => void
  onRemoveRow: (row: ArtSlotRow) => void
}

function SlotEditor({ slot, draft, rows, allRows, busy, error, onChange, onSave, onCancel, onEditRow, onRemoveRow }: SlotEditorProps) {
  const { spec } = slot
  const isHero = spec.key === SLOT_KEYS.hero
  const previewSrc = draft?.previewSrc ?? null

  // The image's real size, so a click on the cropped preview can be mapped to a
  // point in the image. Keyed by src: a stale size is never applied to a new image.
  const [natural, setNatural] = useState<{ src: string; width: number; height: number } | null>(null)
  useEffect(() => {
    if (!previewSrc) return
    const img = new Image()
    img.onload = () => setNatural({ src: previewSrc, width: img.naturalWidth, height: img.naturalHeight })
    img.src = previewSrc
    return () => {
      img.onload = null
    }
  }, [previewSrc])

  const candidates = useMemo(
    () => (previewSrc ? [{ src: previewSrc, source: 'override' as const }] : []),
    [previewSrc],
  )

  // Which saved image is being asked about before it is removed.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const hrefTrimmed = draft?.href.trim() ?? ''
  const hrefValid = isSafeUrl(hrefTrimmed)
  const hrefNormalized = hrefTrimmed ? normalizeUrl(hrefTrimmed) : null

  return (
    <div className="mt-3 pt-3 border-t border-bg-elevated space-y-4">
      {draft ? (
        <>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className={fieldLabel}>{draft.rowId ? 'Edit override' : 'New override'}</span>
              <span className="text-[11px] text-text-muted">Click the picture to set what stays in frame</span>
            </div>
            {/* The slot's real shape with real text on the real scrim: what is
                judged here is what Home will show. */}
            <div
              className="relative cursor-crosshair rounded-lg overflow-hidden border border-bg-elevated mx-auto"
              style={{ aspectRatio: `${spec.width} / ${spec.height}`, maxHeight: '22rem' }}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                const image = natural && natural.src === previewSrc ? natural : null
                onChange({
                  focal: focalFromClick(
                    { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height },
                    { width: rect.width, height: rect.height },
                    image,
                    draft.focal,
                  ),
                })
              }}
            >
              <ArtLayer
                slotKey={spec.key}
                candidates={candidates}
                focal={draft.focal}
                overlay={draft.overlay}
                scrim={spec.scrim}
                gradientFallback={slot.gradientFallback}
                priority
                className="w-full h-full"
              >
                <div className={`absolute p-[4%] ${spec.scrim === 'left' ? 'inset-y-0 left-0 flex flex-col justify-center' : 'inset-x-0 bottom-0'}`}>
                  <div className={`${isHero || spec.scrim === 'left' ? 'font-display italic font-extrabold text-2xl sm:text-3xl' : 'font-heading font-bold text-lg'} uppercase leading-none`}>
                    {spec.sample.title}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">{spec.sample.sub}</div>
                </div>
                <span
                  aria-hidden="true"
                  className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] pointer-events-none"
                  style={{ left: `${draft.focal.x * 100}%`, top: `${draft.focal.y * 100}%` }}
                />
              </ArtLayer>
            </div>
            <p className="text-[11px] text-text-muted">
              {spec.composition}. Made for {spec.width}×{spec.height}.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className={fieldLabel}>
              Overlay <span className="font-stats normal-case tracking-normal text-text-muted">{draft.overlay.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={draft.overlay}
              onChange={e => onChange({ overlay: Number(e.target.value) })}
              className="w-full accent-val-cyan"
            />
            <span className="block text-[11px] text-text-muted">How dark the shade under the text is. Raise it until the sample text reads easily.</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className={fieldLabel}>Show from</span>
              <input
                type="datetime-local"
                value={draft.activeFrom}
                onChange={e => onChange({ activeFrom: e.target.value })}
                className={inputClass}
              />
              <span className="block text-[11px] text-text-muted">Blank = straight away.</span>
            </label>
            <label className="block space-y-1.5">
              <span className={fieldLabel}>Show until</span>
              <input
                type="datetime-local"
                value={draft.activeUntil}
                onChange={e => onChange({ activeUntil: e.target.value })}
                className={inputClass}
              />
              <span className="block text-[11px] text-text-muted">Blank = until replaced or removed.</span>
            </label>
          </div>

          {isHero && (
            <label className="block space-y-1.5">
              <span className={fieldLabel}>Watch Overview link</span>
              <input
                type="url"
                value={draft.href}
                onChange={e => onChange({ href: e.target.value })}
                placeholder="YouTube link. Blank = no button"
                className={inputClass}
              />
              {!hrefValid ? (
                <span className="block text-[11px] text-val-red">That isn't a web link.</span>
              ) : hrefNormalized && !extractYouTubeId(hrefNormalized) ? (
                <span className="block text-[11px] text-val-yellow">Not a YouTube link: the button will open it in a new tab instead of playing it on the page.</span>
              ) : (
                <span className="block text-[11px] text-text-muted">The hero shows "Watch Overview" only while this is set.</span>
              )}
            </label>
          )}

          {error && <p className="text-xs text-val-red">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={busy || !hrefValid}
              className="inline-flex items-center gap-2 px-4 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {draft.rowId ? 'Save changes' : 'Save override'}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm text-text-muted hover:text-text-secondary">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-text-muted">
          {rows.length === 0
            ? 'This slot is on its default. Upload an image or paste a URL to override it.'
            : 'Pick a saved image below to edit it, or upload a new one.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-1.5">
          <span className={fieldLabel}>Saved for this slot</span>
          {rows.map(row => {
            const status = STATUS_BADGE[slotRowStatus(row, allRows)]
            return (
              <div key={row.id} className="flex items-center gap-2.5 text-xs">
                <img src={row.image_url} alt="" className="w-12 h-8 rounded object-cover border border-bg-elevated shrink-0" />
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${status.className}`}>{status.label}</span>
                <span className="font-stats text-[11px] text-text-secondary min-w-0 truncate flex-1">
                  from {formatWhen(row.active_from)}
                  {row.active_until && ` until ${formatWhen(row.active_until)}`}
                </span>
                {confirmingId === row.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null)
                        onRemoveRow(row)
                      }}
                      disabled={busy}
                      className="px-2 py-1.5 rounded-md text-xs text-val-red border border-val-red/25 bg-val-red/10 hover:bg-val-red/20"
                    >
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirmingId(null)} className="px-2 py-1.5 rounded-md text-xs text-text-muted hover:text-text-secondary">
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => onEditRow(row)} disabled={busy} className={smallButton}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(row.id)}
                      disabled={busy}
                      className={`${smallButton} hover:text-val-red hover:border-val-red/40`}
                      aria-label="Remove this saved image"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Manager
// ──────────────────────────────────────────────────────────────────────────

/** Settings → Home Art: see what every slot shows, and override any of them. */
export default function HomeArtManager() {
  const { rows, active, tableMissing, error: loadError, loading } = useArtSlotRows()
  const { registry } = useGameContent()

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [groupOpen, setGroupOpen] = useState(false)

  // The object URL behind an upload's preview, released when the draft goes.
  const objectUrl = useRef<string | null>(null)
  const releasePreview = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
  }
  useEffect(() => releasePreview, [])

  const staticSlots = useMemo<ManagedSlot[]>(
    () => STATIC_SLOTS.map(spec => ({ spec, apiDefault: null, gradientFallback: null, portrait: false })),
    [],
  )

  const mapSlots = useMemo<ManagedSlot[]>(
    () =>
      registry
        ? [...registry.maps.byId.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(m => ({ spec: mapSlotSpec(m.uuid, m.name), apiDefault: m.listViewIconTall, gradientFallback: null, portrait: false }))
        : [],
    [registry],
  )

  const mapHeaderSlots = useMemo<ManagedSlot[]>(
    () =>
      registry
        ? [...registry.maps.byId.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(m => ({ spec: mapHeaderSlotSpec(m.uuid, m.name), apiDefault: m.splash, gradientFallback: null, portrait: false }))
        : [],
    [registry],
  )

  const agentSlots = useMemo<ManagedSlot[]>(
    () =>
      registry
        ? [...registry.agents.byId.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(a => ({ spec: agentSlotSpec(a.uuid, a.name), apiDefault: a.fullPortrait, gradientFallback: agentGradientCss(a), portrait: true }))
        : [],
    [registry],
  )

  const closeDraft = () => {
    releasePreview()
    setDraft(null)
    setError(null)
  }

  const select = (slotKey: string) => {
    if (busy) return
    releasePreview()
    setError(null)
    if (selectedKey === slotKey) {
      setSelectedKey(null)
      setDraft(null)
      return
    }
    setSelectedKey(slotKey)
    // Opening a slot that has an override goes straight to editing it.
    const live = active.get(slotKey)
    setDraft(live ? draftFromRow(live) : null)
  }

  const pickFile = (slotKey: string, file: File) => {
    const refusal = validateArtFile(file)
    releasePreview()
    setSelectedKey(slotKey)
    if (refusal) {
      setDraft(null)
      setError(refusal)
      return
    }
    objectUrl.current = URL.createObjectURL(file)
    setError(null)
    setDraft(newDraft(slotKey, { file, previewSrc: objectUrl.current }))
  }

  const pasteUrl = (slotKey: string, raw: string): string | null => {
    const url = normalizeUrl(raw)
    if (!url) return 'Paste a full web link to an image, starting with https://'
    releasePreview()
    setSelectedKey(slotKey)
    setError(null)
    setDraft(newDraft(slotKey, { url }))
    return null
  }

  const remove = async (row: ArtSlotRow) => {
    setBusy(true)
    setError(null)
    try {
      await removeArtSlot(row)
      if (draft?.rowId === row.id) closeDraft()
    } catch (err) {
      setSelectedKey(row.slot_key)
      setError(err instanceof Error ? err.message : 'Could not remove that image.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!draft) return

    // An untouched schedule isn't sent: the input drops seconds, and writing
    // that back would quietly reorder rows saved within the same minute.
    const fromChanged = draft.activeFrom !== draft.initialActiveFrom
    const untilChanged = draft.activeUntil !== draft.initialActiveUntil
    const from = draft.activeFrom ? fromLocalInput(draft.activeFrom) : new Date().toISOString()
    const until = draft.activeUntil ? fromLocalInput(draft.activeUntil) : null
    if (until && new Date(until) <= new Date(from)) {
      setError('"Show until" has to be after "Show from".')
      return
    }

    const opts: ArtSlotOptions = {
      focal_x: draft.focal.x,
      focal_y: draft.focal.y,
      overlay: draft.overlay,
      ...(fromChanged && { active_from: from }),
      ...(untilChanged && { active_until: until }),
      ...(draft.slotKey === SLOT_KEYS.hero && { href: draft.href.trim() ? normalizeUrl(draft.href) : null }),
    }

    setBusy(true)
    setError(null)
    try {
      if (draft.rowId) await updateArtSlot(draft.rowId, opts)
      else if (draft.file) await uploadArtSlot(draft.slotKey, draft.file, opts)
      else await setArtSlotUrl(draft.slotKey, draft.imageUrl, opts)
      closeDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that image.')
    } finally {
      setBusy(false)
    }
  }

  const renderSlot = (slot: ManagedSlot) => {
    const key = slot.spec.key
    const slotRows = rows.filter(r => r.slot_key === key)
    const liveRow = active.get(key) ?? null
    const selected = selectedKey === key

    return (
      <div key={key}>
        <SlotRow
          slot={slot}
          liveRow={liveRow}
          otherRows={slotRows.length - (liveRow ? 1 : 0)}
          selected={selected}
          disabled={busy || tableMissing || loading}
          onSelect={() => select(key)}
          onPickFile={file => pickFile(key, file)}
          onPasteUrl={url => pasteUrl(key, url)}
          onRemove={remove}
        />
        {selected && (
          <div className="px-2.5 pb-2.5">
            {error && !draft && <p className="mt-3 text-xs text-val-red">{error}</p>}
            <SlotEditor
              slot={slot}
              draft={draft?.slotKey === key ? draft : null}
              rows={slotRows}
              allRows={rows}
              busy={busy}
              error={error}
              onChange={patch => setDraft(d => (d ? { ...d, ...patch } : d))}
              onSave={save}
              onCancel={closeDraft}
              onEditRow={row => {
                releasePreview()
                setError(null)
                setDraft(draftFromRow(row))
              }}
              onRemoveRow={remove}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tableMissing && (
        <p className="text-xs text-val-yellow border border-val-yellow/25 bg-val-yellow/10 rounded-md px-3 py-2">
          Overrides are off until the <code className="font-stats">20261002_art_slots.sql</code> migration has been run in
          the Supabase SQL editor. Home is using its default art.
        </p>
      )}
      {loadError && (
        <p className="text-xs text-val-red border border-val-red/25 bg-val-red/10 rounded-md px-3 py-2">
          Couldn't load your saved art: {loadError}
        </p>
      )}

      <div className="space-y-2">{staticSlots.map(renderSlot)}</div>

      <details
        className="rounded-lg border border-bg-elevated"
        onToggle={e => setGroupOpen(e.currentTarget.open)}
      >
        <summary className="px-3 py-2.5 text-sm text-text-primary cursor-pointer select-none">
          Maps &amp; Agents
          <span className="ml-2 font-stats text-xs text-text-muted">
            {registry ? `${mapSlots.length} maps · ${agentSlots.length} agents` : 'loading…'}
          </span>
        </summary>
        {/* Forty-odd thumbnails: only built once the group is opened. */}
        {groupOpen && (
          <div className="p-2.5 pt-0 space-y-4">
            <p className="text-[11px] text-text-muted">
              These show the game's own art unless you override one. Maps appear on Home's map cards, and at the top
              of a map's page until that page has a header of its own; agents on Home's agent cards and on map pages.
            </p>
            <div className="space-y-2">
              <span className={fieldLabel}>Maps</span>
              {mapSlots.map(renderSlot)}
            </div>
            <div className="space-y-2">
              <span className={fieldLabel}>Map page headers</span>
              {mapHeaderSlots.map(renderSlot)}
            </div>
            <div className="space-y-2">
              <span className={fieldLabel}>Agents</span>
              {agentSlots.map(renderSlot)}
            </div>
          </div>
        )}
      </details>
    </div>
  )
}
