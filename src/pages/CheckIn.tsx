import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronLeft, Crosshair, Brain, Target } from 'lucide-react'
import ScoreSlider from '../components/ui/ScoreSlider'
import { supabase } from '../lib/supabase'
import { AGENTS, MAPS } from '../lib/constants'

const WEEKLY_GOAL_KEY = 'val-master-weekly-goal'

export default function CheckIn() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Screen 1 — Mental State
  const [mentalScore, setMentalScore] = useState(3)
  const [physicalScore, setPhysicalScore] = useState(3)
  const [focusLevel, setFocusLevel] = useState(3)
  const [tiltRisk, setTiltRisk] = useState(3)

  // Screen 2 — Agent & Map
  const [agentPick, setAgentPick] = useState(AGENTS[0])
  const [map, setMap] = useState(MAPS[0])
  const [notes, setNotes] = useState('')

  // Screen 3 — Goal
  const [goal, setGoal] = useState('')
  const [weeklyGoal, setWeeklyGoal] = useState(
    () => localStorage.getItem(WEEKLY_GOAL_KEY) ?? ''
  )
  const [editingWeekly, setEditingWeekly] = useState(false)

  const handleSubmit = async () => {
    if (!goal.trim()) return
    setSubmitting(true)
    setError(null)

    if (weeklyGoal.trim()) {
      localStorage.setItem(WEEKLY_GOAL_KEY, weeklyGoal.trim())
    }

    const { data, error: dbError } = await supabase
      .from('match_checkins')
      .insert({
        mental_score: mentalScore,
        physical_score: physicalScore,
        focus_level: focusLevel,
        tilt_risk: tiltRisk,
        agent_pick: agentPick,
        map,
        goal: goal.trim(),
        notes: notes.trim() || null,
      })
      .select()
      .single()

    if (dbError) {
      setError(dbError.message)
      setSubmitting(false)
      return
    }

    localStorage.setItem('val-master-last-checkin-id', data.id)
    localStorage.setItem('val_agent', agentPick)
    localStorage.setItem('val_map', map)
    navigate('/tactical')
  }

  const STEPS = [
    { label: 'Mental State', icon: Brain },
    { label: 'Agent & Map', icon: Crosshair },
    { label: 'Session Goal', icon: Target },
  ]

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

      {/* Screen 1 — Mental State */}
      {step === 0 && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-val-cyan">
              Mental State
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              Rate yourself honestly — no wrong answers.
            </p>
          </div>

          <ScoreSlider
            label="How mentally sharp are you?"
            value={mentalScore}
            onChange={setMentalScore}
          />
          <ScoreSlider
            label="How physically energized are you?"
            value={physicalScore}
            onChange={setPhysicalScore}
          />
          <ScoreSlider
            label="How dialed in is your focus?"
            value={focusLevel}
            onChange={setFocusLevel}
          />
          <ScoreSlider
            label="How calm are you?"
            value={tiltRisk}
            onChange={setTiltRisk}
            color="var(--color-val-yellow)"
          />

          <button
            onClick={() => setStep(1)}
            className="w-full py-3 rounded-lg bg-val-cyan text-bg-primary font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all flex items-center justify-center gap-2"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Screen 2 — Agent & Map Intent */}
      {step === 1 && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-val-cyan">
              Agent & Map
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              Lock in your pick and the map.
            </p>
          </div>

          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm text-text-secondary">Agent</span>
              <select
                value={agentPick}
                onChange={(e) => setAgentPick(e.target.value)}
                className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-val-cyan/50 transition-colors"
              >
                {AGENTS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>

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
              <span className="text-sm text-text-secondary">
                Anything specific to focus on?{' '}
                <span className="text-text-muted">(optional)</span>
              </span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Work on crosshair placement"
                className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
              />
            </label>
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
              className="flex-1 py-3 rounded-lg bg-val-cyan text-bg-primary font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all flex items-center justify-center gap-2"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Screen 3 — Session Goal */}
      {step === 2 && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-val-cyan">
              Session Goal
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              Define what you're training today.
            </p>
          </div>

          {/* Weekly goal */}
          <div className="bg-bg-elevated/50 border border-bg-elevated rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-val-yellow uppercase tracking-wider">
                Weekly Goal
              </span>
              <button
                onClick={() => setEditingWeekly(!editingWeekly)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                {editingWeekly ? 'Done' : 'Edit'}
              </button>
            </div>
            {editingWeekly ? (
              <input
                type="text"
                value={weeklyGoal}
                onChange={(e) => setWeeklyGoal(e.target.value)}
                onBlur={() => {
                  if (weeklyGoal.trim()) {
                    localStorage.setItem(WEEKLY_GOAL_KEY, weeklyGoal.trim())
                  }
                  setEditingWeekly(false)
                }}
                placeholder="e.g. Reach Immortal 2 by Friday"
                className="w-full bg-bg-primary border border-bg-elevated rounded px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-yellow/50"
                autoFocus
              />
            ) : (
              <p className="text-sm text-text-secondary">
                {weeklyGoal || 'No weekly goal set — tap Edit to add one.'}
              </p>
            )}
          </div>

          {/* Session goal */}
          <label className="block space-y-2">
            <span className="text-sm text-text-secondary">
              What's your training focus this session?
            </span>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Win pistol rounds, hold site solo"
              className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
            />
          </label>

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
              disabled={!goal.trim() || submitting}
              className="flex-1 py-3 rounded-lg bg-val-red text-white font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Start Session'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
