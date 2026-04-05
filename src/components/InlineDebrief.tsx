import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { DEBRIEF_THEMES } from '../lib/commentTags'
import type { VodReview } from '../lib/types'
import { Star, Save, Check } from 'lucide-react'

interface InlineDebriefProps {
  vodReview: VodReview
  onUpdate: (updated: VodReview) => void
}

export default function InlineDebrief({ vodReview, onUpdate }: InlineDebriefProps) {
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
