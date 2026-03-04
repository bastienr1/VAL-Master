import { useState, useEffect, useCallback } from 'react'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import ScoreSlider from '../components/ui/ScoreSlider'
import { supabase } from '../lib/supabase'
import { MAPS, WEAPONS, TACTICAL_INTENTS } from '../lib/constants'
import type { TacticalRead } from '../lib/types'

type Side = 'attack' | 'defense'
type RoundType = 'pistol' | 'eco' | 'force' | 'full_buy'
type Result = 'success' | 'partial' | 'fail'

const CHECKIN_ID_KEY = 'val-master-last-checkin-id'
const WEAPON_CATEGORIES = Object.keys(WEAPONS) as (keyof typeof WEAPONS)[]

export default function TacticalReads() {
  const [reads, setReads] = useState<TacticalRead[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [roundNumber, setRoundNumber] = useState('')
  const [map, setMap] = useState<string>(MAPS[0])
  const [side, setSide] = useState<Side>('attack')
  const [roundType, setRoundType] = useState<RoundType>('full_buy')
  const [weaponsBought, setWeaponsBought] = useState<string[]>([])
  const [tacticalIntent, setTacticalIntent] = useState<string | null>(null)
  const [readDescription, setReadDescription] = useState('')
  const [counterAction, setCounterAction] = useState('')
  const [confidence, setConfidence] = useState(3)
  const [result, setResult] = useState<Result | null>(null)

  const checkinId = localStorage.getItem(CHECKIN_ID_KEY)

  const fetchReads = useCallback(async () => {
    if (!checkinId) return
    const { data } = await supabase
      .from('tactical_reads')
      .select('*')
      .eq('match_checkin_id', checkinId)
      .order('created_at', { ascending: false })
    if (data) setReads(data)
  }, [checkinId])

  useEffect(() => { fetchReads() }, [fetchReads])

  const toggleWeapon = (name: string) => {
    setWeaponsBought((prev) =>
      prev.includes(name) ? prev.filter((w) => w !== name) : [...prev, name]
    )
  }

  const resetForm = () => {
    setRoundNumber('')
    setWeaponsBought([])
    setTacticalIntent(null)
    setReadDescription('')
    setCounterAction('')
    setConfidence(3)
    setResult(null)
  }

  const handleSubmit = async () => {
    if (!readDescription.trim() || !counterAction.trim()) return
    setSubmitting(true)
    setError(null)

    const parsed = parseInt(roundNumber, 10)

    const { error: dbError } = await supabase.from('tactical_reads').insert({
      map,
      side,
      round_type: roundType,
      read_description: readDescription.trim(),
      counter_action: counterAction.trim(),
      confidence,
      result,
      match_checkin_id: checkinId || null,
      round_number: parsed >= 1 && parsed <= 25 ? parsed : null,
      weapons_bought: weaponsBought.length > 0 ? weaponsBought : null,
      tactical_intent: tacticalIntent,
    })

    if (dbError) {
      setError(dbError.message)
      setSubmitting(false)
      return
    }

    resetForm()
    setSubmitting(false)
    fetchReads()
  }

  const btnBase = 'px-3 py-2 rounded-lg text-xs font-heading font-bold tracking-wide transition-all border'

  const sideBadge = (s: Side) =>
    s === 'attack'
      ? 'bg-val-red/15 text-val-red border-val-red/30'
      : 'bg-val-cyan/15 text-val-cyan border-val-cyan/30'

  const resultBadge = (r: Result) => {
    const map: Record<Result, string> = {
      success: 'bg-val-green/15 text-val-green',
      partial: 'bg-val-yellow/15 text-val-yellow',
      fail: 'bg-val-red/15 text-val-red',
    }
    return map[r]
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left — New Read form */}
      <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-5 h-fit">
        <div>
          <h1 className="font-heading text-2xl font-bold text-val-cyan">
            Log Tactical Read
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Track what you read and how you countered.
          </p>
        </div>

        {/* Round Number */}
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Round #</span>
          <input
            type="number"
            min={1}
            max={25}
            value={roundNumber}
            onChange={(e) => setRoundNumber(e.target.value)}
            placeholder="e.g. 12"
            className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm font-stats placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
          />
        </label>

        {/* Map */}
        <label className="block space-y-2">
          <span className="text-sm text-text-secondary">Map</span>
          <select
            value={map}
            onChange={(e) => setMap(e.target.value)}
            className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-val-cyan/50 transition-colors"
          >
            {MAPS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>

        {/* Side */}
        <div className="space-y-2">
          <span className="text-sm text-text-secondary">Side</span>
          <div className="flex gap-2">
            {(['attack', 'defense'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`flex-1 ${btnBase} ${
                  side === s
                    ? s === 'attack'
                      ? 'bg-val-red/15 text-val-red border-val-red/40'
                      : 'bg-val-cyan/15 text-val-cyan border-val-cyan/40'
                    : 'bg-bg-elevated text-text-muted border-transparent hover:border-bg-elevated'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Round Type */}
        <div className="space-y-2">
          <span className="text-sm text-text-secondary">Round type</span>
          <div className="flex gap-2">
            {([
              ['pistol', 'Pistol'],
              ['eco', 'Eco'],
              ['force', 'Force'],
              ['full_buy', 'Full Buy'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setRoundType(val)}
                className={`flex-1 ${btnBase} ${
                  roundType === val
                    ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40'
                    : 'bg-bg-elevated text-text-muted border-transparent hover:border-bg-elevated'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Weapons Bought */}
        <div className="space-y-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Weapons Bought This Round
          </span>
          {WEAPON_CATEGORIES.map((cat) => (
            <div key={cat} className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-text-muted/60">
                {cat}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {WEAPONS[cat].map((w) => (
                  <button
                    key={w.name}
                    onClick={() => toggleWeapon(w.name)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-all border ${
                      weaponsBought.includes(w.name)
                        ? 'bg-bg-elevated text-val-cyan border-val-cyan/40'
                        : 'bg-bg-elevated/50 text-text-muted border-transparent hover:border-bg-elevated'
                    }`}
                  >
                    {w.name} <span className="text-text-muted/50">[{w.cost}]</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Tactical Intent */}
        <div className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Tactical Intent
          </span>
          <div className="flex flex-wrap gap-2">
            {TACTICAL_INTENTS.map((intent) => (
              <button
                key={intent}
                onClick={() => setTacticalIntent(tacticalIntent === intent ? null : intent)}
                className={`px-3 py-1.5 rounded-lg text-xs font-heading font-bold tracking-wide transition-all border ${
                  tacticalIntent === intent
                    ? 'bg-val-red/15 text-val-red border-val-red/40'
                    : 'bg-bg-elevated text-text-muted border-transparent hover:border-bg-elevated'
                }`}
              >
                {intent}
              </button>
            ))}
          </div>
        </div>

        {/* Read Description */}
        <label className="block space-y-2">
          <span className="text-sm text-text-secondary">What did you read?</span>
          <textarea
            value={readDescription}
            onChange={(e) => setReadDescription(e.target.value)}
            rows={2}
            placeholder="e.g. They push B main every pistol round with 3 players"
            className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors resize-none"
          />
        </label>

        {/* Counter Action */}
        <label className="block space-y-2">
          <span className="text-sm text-text-secondary">How did you counter?</span>
          <textarea
            value={counterAction}
            onChange={(e) => setCounterAction(e.target.value)}
            rows={2}
            placeholder="e.g. Stacked B with util, held crossfire from market"
            className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors resize-none"
          />
        </label>

        {/* Confidence */}
        <ScoreSlider
          label="Confidence in read"
          value={confidence}
          onChange={setConfidence}
        />

        {/* Result */}
        <div className="space-y-2">
          <span className="text-sm text-text-secondary">
            Result <span className="text-text-muted">(optional)</span>
          </span>
          <div className="flex gap-2">
            {(['success', 'partial', 'fail'] as const).map((r) => {
              const colors: Record<Result, [string, string]> = {
                success: ['bg-val-green/15 text-val-green border-val-green/40', 'hover:border-val-green/20'],
                partial: ['bg-val-yellow/15 text-val-yellow border-val-yellow/40', 'hover:border-val-yellow/20'],
                fail: ['bg-val-red/15 text-val-red border-val-red/40', 'hover:border-val-red/20'],
              }
              return (
                <button
                  key={r}
                  onClick={() => setResult(result === r ? null : r)}
                  className={`flex-1 ${btnBase} ${
                    result === r
                      ? colors[r][0]
                      : `bg-bg-elevated text-text-muted border-transparent ${colors[r][1]}`
                  }`}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              )
            })}
          </div>
        </div>

        {error && <p className="text-sm text-val-red">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!readDescription.trim() || !counterAction.trim() || submitting}
          className="w-full py-3 rounded-lg bg-val-red text-white font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : 'Log Read'}
        </button>
      </div>

      {/* Right — Reads log */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-val-cyan" />
          <h2 className="font-heading text-xl font-bold text-text-primary">
            Reads Log
          </h2>
          <span className="text-xs text-text-muted font-stats">
            ({reads.length})
          </span>
        </div>

        {reads.length === 0 ? (
          <div className="bg-bg-card border border-bg-elevated rounded-xl p-8 text-center">
            <p className="text-text-muted text-sm">
              No reads logged yet. Start tracking your reads.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reads.map((read) => {
              const expanded = expandedId === read.id
              return (
                <button
                  key={read.id}
                  onClick={() => setExpandedId(expanded ? null : read.id)}
                  className="w-full text-left bg-bg-card border border-bg-elevated rounded-lg p-4 hover:border-val-cyan/20 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-bg-elevated text-text-secondary">
                      {read.map}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${sideBadge(read.side)}`}>
                      {read.side}
                    </span>
                    {read.round_number != null && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-stats bg-val-yellow/15 text-val-yellow">
                        R{read.round_number}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-bg-elevated text-text-muted">
                      {read.round_type.replace('_', ' ')}
                    </span>
                    {read.result && (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${resultBadge(read.result)}`}>
                        {read.result}
                      </span>
                    )}
                    <span className="ml-auto text-text-muted">
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </div>

                  {/* Weapons chips */}
                  {read.weapons_bought && read.weapons_bought.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {read.weapons_bought.map((w) => (
                        <span key={w} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-bg-elevated text-text-muted">
                          {w}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Tactical intent */}
                  {read.tactical_intent && (
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold bg-val-red/10 text-val-red">
                      {read.tactical_intent}
                    </span>
                  )}

                  <p className={`text-sm text-text-secondary mt-2 ${expanded ? '' : 'line-clamp-1'}`}>
                    {read.read_description}
                  </p>
                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-bg-elevated space-y-2">
                      <div>
                        <span className="text-[10px] uppercase text-text-muted tracking-wider">Counter</span>
                        <p className="text-sm text-text-primary mt-0.5">{read.counter_action}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] uppercase text-text-muted tracking-wider">Confidence</span>
                        <span className="font-stats text-xs text-val-cyan">{read.confidence}/5</span>
                      </div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
