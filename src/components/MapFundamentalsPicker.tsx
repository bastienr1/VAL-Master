import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { getMapFundamentals, saveMapFundamentals, type FundamentalsChoice } from '../lib/mapFundamentals'
import { normalizeUrl, isSafeUrl } from '../lib/url'
import { usePlaybooks } from '../hooks/usePlaybooks'

interface MapFundamentalsPickerProps {
  map: string
}

interface Loaded {
  map: string
  choice: FundamentalsChoice
  error: string | null
}

const NONE = 'none'
const URL_OPTION = 'url'
const playbookValue = (id: string) => `playbook:${id}`

/**
 * Map fundamentals for Match Debrief (Sprint 6b): a saved playbook on this
 * map, an external link, or nothing. One choice per map, per user — it loads
 * and saves on its own so a bad link never blocks the rest of the debrief.
 */
export default function MapFundamentalsPicker({ map }: MapFundamentalsPickerProps) {
  const { playbooks, loading: playbooksLoading } = usePlaybooks({ map })

  // Keyed by map so switching reviews never shows the previous map's choice.
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMapFundamentals(map)
      .then(choice => {
        if (!cancelled) setLoaded({ map, choice, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ map, choice: { kind: 'none' }, error: err instanceof Error ? err.message : String(err) })
      })
    return () => { cancelled = true }
  }, [map])

  const current = loaded?.map === map ? loaded : null
  const choice = current?.choice ?? null
  const storedUrl = choice?.kind === 'url' ? choice.url : ''

  // Reset the local editor when the map changes — adjusted during render, not in an effect.
  const [editorMap, setEditorMap] = useState(map)
  if (editorMap !== map) {
    setEditorMap(map)
    setEditingUrl(false)
    setUrlDraft('')
    setSaveError(null)
  }

  const save = async (next: FundamentalsChoice) => {
    setSaving(true)
    setSaveError(null)
    try {
      const stored = await saveMapFundamentals(map, next)
      setLoaded({ map, choice: stored, error: null })
      setEditingUrl(stored.kind === 'none' && next.kind === 'url')
      if (stored.kind === 'url') setUrlDraft(stored.url)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const selectedPlaybook = choice?.kind === 'playbook' ? playbooks.find(p => p.id === choice.playbookId) ?? null : null
  const playbookMissing = choice?.kind === 'playbook' && !playbooksLoading && !selectedPlaybook

  const showUrlEditor = editingUrl || choice?.kind === 'url'
  const selectValue = showUrlEditor
    ? URL_OPTION
    : choice?.kind === 'playbook'
      ? playbookValue(choice.playbookId)
      : NONE

  const handleSelect = (value: string) => {
    setSaveError(null)
    if (value === URL_OPTION) {
      setEditingUrl(true)
      setUrlDraft(storedUrl)
      return
    }
    setEditingUrl(false)
    if (value === NONE) {
      if (choice?.kind !== 'none') save({ kind: 'none' })
      return
    }
    save({ kind: 'playbook', playbookId: value.slice('playbook:'.length) })
  }

  const urlInvalid = !isSafeUrl(urlDraft)
  const urlDirty = urlDraft.trim() !== storedUrl
  const urlHref = choice?.kind === 'url' ? normalizeUrl(choice.url) : null

  return (
    <div>
      <label htmlFor={`fundamentals-${map}`} className="text-[10px] text-text-muted uppercase tracking-wider">
        Map fundamentals — {map}
      </label>

      <div className="flex items-center gap-1.5 mt-1">
        <select
          id={`fundamentals-${map}`}
          value={current ? selectValue : ''}
          onChange={e => handleSelect(e.target.value)}
          disabled={!current || saving}
          className="flex-1 min-w-0 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-val-cyan/30 disabled:opacity-60"
        >
          {!current && <option value="">Loading…</option>}
          {current && (
            <>
              {playbooks.length > 0 && (
                <optgroup label="Playbooks">
                  {playbooks.map(p => (
                    <option key={p.id} value={playbookValue(p.id)}>
                      📖 {p.name} · {p.chapter_count} {p.chapter_count === 1 ? 'chapter' : 'chapters'}
                    </option>
                  ))}
                </optgroup>
              )}
              {choice?.kind === 'playbook' && !selectedPlaybook && (
                <option value={playbookValue(choice.playbookId)}>
                  {playbooksLoading ? 'Loading…' : '📖 Saved playbook (no longer on this map)'}
                </option>
              )}
              <option value={URL_OPTION}>🔗 External link…</option>
              <option value={NONE}>— None</option>
            </>
          )}
        </select>

        {selectedPlaybook && !showUrlEditor && (
          // New tab: the debrief sits beside a paused VOD and this keeps its position.
          <a
            href={`/playbook/${selectedPlaybook.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open playbook in a new tab"
            className="shrink-0 p-1.5 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan hover:bg-val-cyan/20 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>

      {showUrlEditor && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            type="url"
            inputMode="url"
            autoFocus={editingUrl && !storedUrl}
            value={urlDraft}
            onChange={e => setUrlDraft(e.target.value)}
            onBlur={() => {
              const normalized = normalizeUrl(urlDraft)
              if (normalized) setUrlDraft(normalized)
            }}
            placeholder={`Reference link for ${map} — shared by every ${map} review`}
            className={`flex-1 min-w-0 bg-bg-elevated border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${
              urlInvalid ? 'border-val-red/50 focus:border-val-red/60' : 'border-bg-card focus:border-val-cyan/30'
            }`}
          />
          {urlDirty && (
            <button
              onClick={() => save({ kind: 'url', url: urlDraft })}
              disabled={urlInvalid || saving}
              title={`Save this link for ${map}`}
              className="shrink-0 px-2 py-1.5 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan text-[10px] font-medium hover:bg-val-cyan/20 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save link'}
            </button>
          )}
          {urlHref && !urlDirty && (
            <a
              href={urlHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Open map fundamentals in a new tab"
              className="shrink-0 p-1.5 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan hover:bg-val-cyan/20 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      )}

      {urlInvalid && showUrlEditor && (
        <p className="mt-1 text-[10px] text-val-red">Needs to be an http(s) link with a real domain.</p>
      )}
      {!playbooksLoading && playbooks.length === 0 && (
        <p className="mt-1 text-[10px] text-text-muted">
          No {map} playbooks yet —{' '}
          <Link to={`/playbook?map=${encodeURIComponent(map)}`} className="text-val-cyan hover:underline">
            import one in Playbook
          </Link>
        </p>
      )}
      {playbookMissing && (
        <p className="mt-1 text-[10px] text-val-yellow/80">The saved playbook isn't on {map} any more — pick another.</p>
      )}
      {saving && !showUrlEditor && <p className="mt-1 text-[10px] text-text-muted">Saving…</p>}
      {(saveError || current?.error) && (
        <p className="mt-1 text-[10px] text-val-red">{saveError ?? `Couldn't load: ${current?.error}`}</p>
      )}
    </div>
  )
}
