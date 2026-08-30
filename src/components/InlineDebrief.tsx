import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { DEBRIEF_THEMES } from '../lib/commentTags'
import { normalizeUrl, isSafeUrl } from '../lib/url'
import { getMapFundamentals, saveMapFundamentals } from '../lib/mapFundamentals'
import type { VodReview } from '../lib/types'
import { Star, Save, Check, ExternalLink } from 'lucide-react'

interface InlineDebriefProps {
  vodReview: VodReview
  map?: string | null
  onUpdate: (updated: VodReview) => void
}

export default function InlineDebrief({ vodReview, map, onUpdate }: InlineDebriefProps) {
  // The map link lives on the map, not the review, so it loads and saves on its
  // own — a bad URL here must never block the rest of the debrief.
  const [mapFundamentals, setMapFundamentals] = useState('')
  const [storedFundamentals, setStoredFundamentals] = useState<string | null>(null)
  const [fundamentalsSaving, setFundamentalsSaving] = useState(false)
  const [fundamentalsError, setFundamentalsError] = useState<string | null>(null)

  const [peakMoment, setPeakMoment] = useState(vodReview.peak_moment || '')
  const [keyLesson, setKeyLesson] = useState(vodReview.key_lesson || '')
  const [themes, setThemes] = useState<string[]>(vodReview.themes ? vodReview.themes.split(',').map(t => t.trim()).filter(Boolean) : [])
  const [quality, setQuality] = useState(vodReview.match_quality || 0)
  const [notes, setNotes] = useState(vodReview.notes || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Reset when vodReview changes
  useEffect(() => {
    setPeakMoment(vodReview.peak_moment || '')
    setKeyLesson(vodReview.key_lesson || '')
    setThemes(vodReview.themes ? vodReview.themes.split(',').map(t => t.trim()).filter(Boolean) : [])
    setQuality(vodReview.match_quality || 0)
    setNotes(vodReview.notes || '')
  }, [vodReview.id])

  // Load the link for whichever map this match was played on.
  useEffect(() => {
    let cancelled = false
    if (!map) {
      setMapFundamentals('')
      setStoredFundamentals(null)
      return
    }
    getMapFundamentals(map).then(url => {
      if (cancelled) return
      setStoredFundamentals(url)
      setMapFundamentals(url ?? '')
    })
    return () => { cancelled = true }
  }, [map])

  const fundamentalsHref = normalizeUrl(mapFundamentals)
  const fundamentalsInvalid = !isSafeUrl(mapFundamentals)
  const fundamentalsDirty = mapFundamentals.trim() !== (storedFundamentals ?? '')

  const handleSaveFundamentals = async () => {
    if (!map || fundamentalsInvalid || !fundamentalsDirty) return
    setFundamentalsSaving(true)
    setFundamentalsError(null)
    try {
      const saved = await saveMapFundamentals(map, mapFundamentals)
      setStoredFundamentals(saved)
      setMapFundamentals(saved ?? '')
    } catch (err) {
      setFundamentalsError(err instanceof Error ? err.message : 'Failed to save link')
    } finally {
      setFundamentalsSaving(false)
    }
  }

  const toggleTheme = (theme: string) => {
    setThemes(prev => prev.includes(theme) ? prev.filter(t => t !== theme) : [...prev, theme])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('vod_reviews')
        .update({
          peak_moment: peakMoment.trim() || null,
          key_lesson: keyLesson.trim() || null,
          themes: themes.length > 0 ? themes.join(', ') : null,
          match_quality: quality || null,
          notes: notes.trim() || null,
        })
        .eq('id', vodReview.id)
        .select()
        .maybeSingle()

      if (error) throw error
      if (data) {
        onUpdate(data)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch (err) {
      console.error('Failed to save debrief:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-heading font-bold text-text-primary">Match Debrief</h3>

      {/* Map fundamentals link — saved per map, not per review */}
      {map && (
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider">
            Map fundamentals — {map}
          </label>
          <div className="flex items-center gap-1.5 mt-1">
            <input
              type="url"
              inputMode="url"
              value={mapFundamentals}
              onChange={(e) => setMapFundamentals(e.target.value)}
              onBlur={() => {
                const normalized = normalizeUrl(mapFundamentals)
                if (normalized) setMapFundamentals(normalized)
              }}
              placeholder={`Reference link for ${map} — shared by every ${map} review`}
              className={`flex-1 min-w-0 bg-bg-elevated border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${
                fundamentalsInvalid
                  ? 'border-val-red/50 focus:border-val-red/60'
                  : 'border-bg-card focus:border-val-cyan/30'
              }`}
            />
            {fundamentalsDirty && (
              <button
                onClick={handleSaveFundamentals}
                disabled={fundamentalsInvalid || fundamentalsSaving}
                title={`Save this link for ${map}`}
                className="shrink-0 px-2 py-1.5 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan text-[10px] font-medium hover:bg-val-cyan/20 disabled:opacity-40 transition-colors"
              >
                {fundamentalsSaving ? 'Saving…' : 'Save link'}
              </button>
            )}
            {fundamentalsHref && (
              <a
                href={fundamentalsHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Open map fundamentals in a new tab"
                className="shrink-0 p-1.5 rounded-lg border border-val-cyan/20 bg-val-cyan/10 text-val-cyan hover:bg-val-cyan/20 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
          {fundamentalsInvalid && (
            <p className="mt-1 text-[10px] text-val-red">Needs to be an http(s) link with a real domain.</p>
          )}
          {fundamentalsError && (
            <p className="mt-1 text-[10px] text-val-red">{fundamentalsError}</p>
          )}
        </div>
      )}

      {/* Peak moment */}
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wider">Peak moment</label>
        <input
          type="text"
          value={peakMoment}
          onChange={(e) => setPeakMoment(e.target.value)}
          placeholder="What was your best play this match?"
          className="w-full mt-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/30"
        />
      </div>

      {/* Key lesson */}
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wider">Key lesson</label>
        <input
          type="text"
          value={keyLesson}
          onChange={(e) => setKeyLesson(e.target.value)}
          placeholder="What's the #1 thing to take from this match?"
          className="w-full mt-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/30"
        />
      </div>

      {/* Theme chips */}
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wider">Themes</label>
        <div className="flex gap-1 flex-wrap mt-1">
          {DEBRIEF_THEMES.map(theme => (
            <button
              key={theme}
              onClick={() => toggleTheme(theme)}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                themes.includes(theme)
                  ? 'border-val-cyan/40 bg-val-cyan/10 text-val-cyan'
                  : 'border-transparent bg-bg-elevated text-text-muted hover:text-text-secondary'
              }`}
            >
              {theme}
            </button>
          ))}
        </div>
      </div>

      {/* Quality stars */}
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wider">Match quality</label>
        <div className="flex gap-1 mt-1">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setQuality(n)}
              className="transition-colors"
            >
              <Star
                className={`w-5 h-5 ${n <= quality ? 'text-val-yellow fill-val-yellow' : 'text-text-muted'}`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wider">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any other thoughts..."
          rows={2}
          className="w-full mt-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/30 resize-none"
        />
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg text-sm font-medium hover:bg-val-cyan/20 disabled:opacity-40 transition-colors"
      >
        {saving ? (
          <div className="w-4 h-4 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
        ) : saved ? (
          <Check className="w-4 h-4" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {saved ? 'Saved!' : 'Save Debrief'}
      </button>
    </div>
  )
}
