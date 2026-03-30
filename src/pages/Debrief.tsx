import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ChevronRight, ChevronLeft, BarChart3, MessageSquare, Star, Loader2, Download } from 'lucide-react'
import { fetchLastMatch } from '../lib/henrik'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/auth'
import { AGENTS, MAPS } from '../lib/constants'

type Result = 'win' | 'loss' | 'draw'
type DurationFeel = 'Quick' | 'Normal' | 'Marathon' | 'Overtime'
type StuckToFocus = 'Yes' | 'Partially' | 'No'

const THEMES = [
  'Crosshair Placement', 'Utility Usage', 'Positioning', 'Communication',
  'Economy Decisions', 'Tilt Management', 'First Duel Confidence',
  'Map Control', 'Patience', 'Agent Mastery', 'Team Synergy', 'Clutch Situations',
]

const EMOJIS = ['🔥', '😤', '😐', '🧊', '🎯']

const CHECKIN_ID_KEY = 'val-master-last-checkin-id'

export default function Debrief() {
  const navigate = useNavigate()
  const { user } = useSession()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Screen 1 — Match Summary (auto-fill from session)
  const [result, setResult] = useState<Result | null>(null)
  const [map, setMap] = useState(() => localStorage.getItem('val_map') || MAPS[0])
  const [agentPlayed, setAgentPlayed] = useState(() => localStorage.getItem('val_agent') || AGENTS[0])
  const [roundsWon, setRoundsWon] = useState(13)
  const [roundsLost, setRoundsLost] = useState(0)
  const [durationFeel, setDurationFeel] = useState<DurationFeel | null>(null)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [loadingMatch, setLoadingMatch] = useState(false)
  const [matchLoaded, setMatchLoaded] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [matchStats, setMatchStats] = useState<{
    acs: number; kills: number; deaths: number; assists: number;
    headshot_pct: number; kd: number; kda: number; agent_role: string | null;
    match_id: string; match_date: string; map: string; agent: string;
    rounds_won: number; rounds_lost: number; rounds_played: number;
    headshots: number; bodyshots: number; legshots: number;
    kpr: number; dpr: number; raw_score: number; result: 'W' | 'L' | 'draw';
    score: string; mode: string;
  } | null>(null)

  // Screen 2 — Reflection
  const [wentWell, setWentWell] = useState('')
  const [toPolish, setToPolish] = useState('')
  const [primaryTheme, setPrimaryTheme] = useState<string | null>(null)
  const [secondaryTheme, setSecondaryTheme] = useState<string | null>(null)
  const [emojiReaction, setEmojiReaction] = useState<string | null>(null)

  // Screen 3 — Session Quality
  const [matchQuality, setMatchQuality] = useState(0)
  const [stuckToFocus, setStuckToFocus] = useState<StuckToFocus | null>(null)
  const [keyTakeaway, setKeyTakeaway] = useState('')
  const [queueAgain, setQueueAgain] = useState(false)

  const handleLoadMatch = async () => {
    setLoadingMatch(true)
    setMatchError(null)
    try {
      const data = await fetchLastMatch()
      if (!data) {
        setMatchError('No recent competitive match found. You can fill in the details manually.')
        setLoadingMatch(false)
        return
      }
      if (data) {
        const m = data.match
        setResult(m.result === 'W' ? 'win' : m.result === 'L' ? 'loss' : 'draw')
        setMap(m.map)
        setAgentPlayed(m.agent)
        setRoundsWon(m.rounds_won)
        setRoundsLost(m.rounds_lost)
        setMatchStats({
          acs: m.acs,
          kills: m.kills,
          deaths: m.deaths,
          assists: m.assists,
          headshot_pct: m.headshot_pct,
          kd: m.kd,
          kda: m.kda,
          agent_role: m.agent_role,
          match_id: m.match_id,
          match_date: m.match_date,
          map: m.map,
          agent: m.agent,
          rounds_won: m.rounds_won,
          rounds_lost: m.rounds_lost,
          rounds_played: m.rounds_played,
          headshots: m.headshots,
          bodyshots: m.bodyshots,
          legshots: m.legshots,
          kpr: m.kpr,
          dpr: m.dpr,
          raw_score: m.raw_score,
          result: m.result,
          score: m.score,
          mode: m.mode,
        })
        setMatchLoaded(true)
      }
    } catch (err) {
      console.error('Failed to load match:', err)
      setMatchError('Failed to connect to match data. You can fill in the details manually.')
    } finally {
      setLoadingMatch(false)
    }
  }

  const handleSubmit = async () => {
    if (!result || !wentWell.trim() || !keyTakeaway.trim() || !primaryTheme) return
    setSubmitting(true)
    setError(null)

    const checkinId = localStorage.getItem(CHECKIN_ID_KEY)

    const nextFocus = [primaryTheme, secondaryTheme].filter(Boolean).join(', ')

    const { error: dbError } = await supabase.from('match_debriefs').insert({
      user_id: user!.id,
      match_checkin_id: checkinId || null,
      result,
      rounds_won: roundsWon,
      rounds_lost: roundsLost,
      goal_met: stuckToFocus === 'Yes',
      peak_moment: wentWell.trim(),
      tilt_moment: toPolish.trim() || null,
      key_lesson: keyTakeaway.trim(),
      next_focus: nextFocus,
      mvp_play: emojiReaction,
      youtube_url: youtubeUrl.trim() || null,
    })

    if (dbError) {
      setError(dbError.message)
      setSubmitting(false)
      return
    }

    // Upsert loaded match data to Supabase matches table
    if (matchStats && matchStats.match_id) {
      try {
        const { data: debriefData } = await supabase
          .from('match_debriefs')
          .select('id')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const debriefId = debriefData?.id || null

        const { error: upsertError } = await supabase.from('matches').upsert({
          match_id: matchStats.match_id,
          user_id: user!.id,
          match_date: matchStats.match_date,
          map: matchStats.map,
          agent: matchStats.agent,
          agent_role: matchStats.agent_role,
          mode: matchStats.mode,
          result: matchStats.result,
          score: matchStats.score,
          rounds_won: matchStats.rounds_won,
          rounds_lost: matchStats.rounds_lost,
          rounds_played: matchStats.rounds_played,
          kills: matchStats.kills,
          deaths: matchStats.deaths,
          assists: matchStats.assists,
          kd: matchStats.kd,
          kda: matchStats.kda,
          acs: matchStats.acs,
          headshot_pct: matchStats.headshot_pct,
          headshots: matchStats.headshots,
          bodyshots: matchStats.bodyshots,
          legshots: matchStats.legshots,
          kpr: matchStats.kpr,
          dpr: matchStats.dpr,
          raw_score: matchStats.raw_score,
          match_checkin_id: checkinId || null,
          match_debrief_id: debriefId,
        }, { onConflict: 'match_id' })

        if (upsertError) {
          console.warn('Match upsert failed (non-blocking):', upsertError.message)
        }
      } catch (err) {
        console.warn('Match upsert error (non-blocking):', err)
      }
    }

    // Clear session data
    localStorage.removeItem('val_agent')
    localStorage.removeItem('val_map')
    localStorage.removeItem(CHECKIN_ID_KEY)
    navigate(queueAgain ? '/checkin' : '/')
  }

  const canProceedStep0 = result !== null
  const canProceedStep1 = wentWell.trim().length > 0 && primaryTheme !== null
  const canSubmit = canProceedStep0 && canProceedStep1 && keyTakeaway.trim().length > 0

  const STEPS = [
    { label: 'Match Summary', icon: BarChart3 },
    { label: 'Reflection', icon: MessageSquare },
    { label: 'Session Quality', icon: Star },
  ]

  const btnBase = 'px-4 py-2 rounded-lg text-sm font-heading font-bold tracking-wide transition-all border'

  const checkinIdExists = !!localStorage.getItem(CHECKIN_ID_KEY)

  if (!checkinIdExists) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-8 text-center space-y-4">
          <h1 className="font-heading text-2xl font-bold text-val-cyan">
            No Active Session
          </h1>
          <p className="text-sm text-text-secondary">
            Start a check-in before debriefing a match.
          </p>
          <Link
            to="/checkin"
            className="inline-block py-3 px-6 rounded-lg bg-val-red text-white font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all"
          >
            Start Check-In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          return (
            <div key={s.label} className="flex items-center gap-2">
              <button
                onClick={() => setStep(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  i === step
                    ? 'bg-val-cyan/15 text-val-cyan border border-val-cyan/30'
                    : i < step
                      ? 'bg-val-green/10 text-val-green border border-val-green/20'
                      : 'bg-bg-elevated text-text-muted border border-transparent'
                }`}
              >
                <Icon size={14} />
                {s.label}
              </button>
              {i < STEPS.length - 1 && (
                <ChevronRight size={14} className="text-text-muted" />
              )}
            </div>
          )
        })}
      </div>

      {/* Screen 1 — Match Summary */}
      {step === 0 && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-val-cyan">
              Match Summary
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              How did the match go?
            </p>
          </div>

          <button
            onClick={handleLoadMatch}
            disabled={loadingMatch || matchLoaded}
            className={`w-full py-2.5 rounded-lg font-heading font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2 border ${
              matchLoaded
                ? 'bg-val-green/10 text-val-green border-val-green/30 cursor-default'
                : 'bg-val-cyan/10 text-val-cyan border-val-cyan/30 hover:bg-val-cyan/20'
            } disabled:opacity-50`}
          >
            {loadingMatch ? (
              <><Loader2 size={16} className="animate-spin" /> Fetching match data...</>
            ) : matchLoaded ? (
              <><Download size={16} /> Match loaded — override below if needed</>
            ) : (
              <><Download size={16} /> Load Last Match</>
            )}
          </button>
          {matchError && (
            <p className="text-xs text-val-yellow mt-1">{matchError}</p>
          )}

          {/* Result */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">Result</span>
            <div className="flex gap-2">
              {(['win', 'loss', 'draw'] as const).map((r) => {
                const colors: Record<Result, string> = {
                  win: result === 'win' ? 'bg-val-green/15 text-val-green border-val-green/40' : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-green/20',
                  loss: result === 'loss' ? 'bg-val-red/15 text-val-red border-val-red/40' : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-red/20',
                  draw: result === 'draw' ? 'bg-text-muted/15 text-text-secondary border-text-muted/40' : 'bg-bg-elevated text-text-muted border-transparent hover:border-text-muted/20',
                }
                return (
                  <button
                    key={r}
                    onClick={() => setResult(r)}
                    className={`flex-1 ${btnBase} ${colors[r]}`}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Map & Agent */}
          <div className="grid grid-cols-2 gap-3">
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
            <label className="block space-y-2">
              <span className="text-sm text-text-secondary">Agent</span>
              <select
                value={agentPlayed}
                onChange={(e) => setAgentPlayed(e.target.value)}
                className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-val-cyan/50 transition-colors"
              >
                {AGENTS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Rounds */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">Score</span>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={99}
                value={roundsWon}
                onChange={(e) => setRoundsWon(Math.max(0, Number(e.target.value)))}
                className="flex-1 bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-center font-stats text-lg text-val-green focus:outline-none focus:border-val-cyan/50 transition-colors"
              />
              <span className="text-text-muted font-stats text-lg">—</span>
              <input
                type="number"
                min={0}
                max={99}
                value={roundsLost}
                onChange={(e) => setRoundsLost(Math.max(0, Number(e.target.value)))}
                className="flex-1 bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-center font-stats text-lg text-val-red focus:outline-none focus:border-val-cyan/50 transition-colors"
              />
            </div>
          </div>

          {matchStats && (
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-bg-elevated rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-text-muted uppercase">ACS</p>
                <p className="font-stats text-lg text-val-cyan">{matchStats.acs}</p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-text-muted uppercase">K/D/A</p>
                <p className="font-stats text-sm text-text-primary">
                  {matchStats.kills}/{matchStats.deaths}/{matchStats.assists}
                </p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-text-muted uppercase">K/D</p>
                <p className={`font-stats text-lg ${matchStats.kd >= 1.0 ? 'text-val-green' : 'text-val-red'}`}>
                  {matchStats.kd}
                </p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-text-muted uppercase">HS%</p>
                <p className="font-stats text-lg text-val-yellow">{matchStats.headshot_pct}%</p>
              </div>
            </div>
          )}

          {/* Duration Feel */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">Match feel</span>
            <div className="flex gap-2">
              {(['Quick', 'Normal', 'Marathon', 'Overtime'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDurationFeel(d)}
                  className={`flex-1 py-2 rounded-lg text-xs font-heading font-bold tracking-wide transition-all border ${
                    durationFeel === d
                      ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40'
                      : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-cyan/20'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* YouTube VOD */}
          <label className="block space-y-2">
            <span className="text-sm text-text-secondary">
              YouTube VOD Link <span className="text-text-muted">(optional)</span>
            </span>
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
            />
          </label>

          <button
            onClick={() => setStep(1)}
            disabled={!canProceedStep0}
            className="w-full py-3 rounded-lg bg-val-cyan text-bg-primary font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Screen 2 — Reflection */}
      {step === 1 && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-val-cyan">
              Reflection
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              Break down what happened.
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-sm text-text-secondary">What went well?</span>
            <textarea
              value={wentWell}
              onChange={(e) => setWentWell(e.target.value)}
              rows={3}
              placeholder="e.g. Hit my one-taps, great comms on B site..."
              className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors resize-none"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm text-text-secondary">What could be polished?</span>
            <textarea
              value={toPolish}
              onChange={(e) => setToPolish(e.target.value)}
              rows={3}
              placeholder="e.g. Over-peeked too many times, forgot smokes..."
              className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors resize-none"
            />
          </label>

          {/* Primary theme */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">Primary theme</span>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    if (primaryTheme === t) { setPrimaryTheme(null); return }
                    if (secondaryTheme === t) setSecondaryTheme(null)
                    setPrimaryTheme(t)
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                    primaryTheme === t
                      ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40'
                      : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-cyan/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Secondary theme */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">
              Secondary theme <span className="text-text-muted">(optional)</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {THEMES.filter((t) => t !== primaryTheme).map((t) => (
                <button
                  key={t}
                  onClick={() => setSecondaryTheme(secondaryTheme === t ? null : t)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                    secondaryTheme === t
                      ? 'bg-val-yellow/15 text-val-yellow border-val-yellow/40'
                      : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-yellow/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Emoji reaction */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">Vibe check</span>
            <div className="flex gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmojiReaction(emojiReaction === e ? null : e)}
                  className={`flex-1 py-2.5 rounded-lg text-xl transition-all border ${
                    emojiReaction === e
                      ? 'bg-bg-elevated border-val-cyan/40 scale-110'
                      : 'bg-bg-elevated/50 border-transparent hover:border-bg-elevated'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(0)}
              className="flex-1 py-3 rounded-lg border border-bg-elevated text-text-secondary font-heading font-bold text-sm tracking-wide hover:border-text-muted transition-all flex items-center justify-center gap-2"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!canProceedStep1}
              className="flex-1 py-3 rounded-lg bg-val-cyan text-bg-primary font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Screen 3 — Session Quality */}
      {step === 2 && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-val-cyan">
              Session Quality
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              Rate this match and plan your next move.
            </p>
          </div>

          {/* Star rating */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">Match quality</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setMatchQuality(matchQuality === star ? 0 : star)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    size={28}
                    className={star <= matchQuality ? 'text-val-yellow fill-val-yellow' : 'text-bg-elevated'}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Stuck to focus */}
          <div className="space-y-2">
            <span className="text-sm text-text-secondary">Did you stick to your session focus?</span>
            <div className="flex gap-2">
              {(['Yes', 'Partially', 'No'] as const).map((opt) => {
                const colors: Record<StuckToFocus, string> = {
                  Yes: stuckToFocus === 'Yes' ? 'bg-val-green/15 text-val-green border-val-green/40' : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-green/20',
                  Partially: stuckToFocus === 'Partially' ? 'bg-val-yellow/15 text-val-yellow border-val-yellow/40' : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-yellow/20',
                  No: stuckToFocus === 'No' ? 'bg-val-red/15 text-val-red border-val-red/40' : 'bg-bg-elevated text-text-muted border-transparent hover:border-val-red/20',
                }
                return (
                  <button
                    key={opt}
                    onClick={() => setStuckToFocus(opt)}
                    className={`flex-1 ${btnBase} ${colors[opt]}`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Key takeaway */}
          <label className="block space-y-2">
            <span className="text-sm text-text-secondary">Key takeaway in one sentence</span>
            <input
              type="text"
              value={keyTakeaway}
              onChange={(e) => setKeyTakeaway(e.target.value)}
              placeholder="e.g. I play better when I slow down my peeks"
              className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
            />
          </label>

          {/* Queue again toggle */}
          <div className="flex items-center justify-between bg-bg-elevated/50 border border-bg-elevated rounded-lg p-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Queue again?</p>
              <p className="text-xs text-text-muted">
                {queueAgain ? 'Start a new check-in' : 'End session, go to dashboard'}
              </p>
            </div>
            <button
              onClick={() => setQueueAgain(!queueAgain)}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                queueAgain ? 'bg-val-green' : 'bg-bg-elevated'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                  queueAgain ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {error && (
            <p className="text-sm text-val-red">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 rounded-lg border border-bg-elevated text-text-secondary font-heading font-bold text-sm tracking-wide hover:border-text-muted transition-all flex items-center justify-center gap-2"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="flex-1 py-3 rounded-lg bg-val-red text-white font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Save Debrief & Session'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
