import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Star, AlertTriangle, Zap, Crosshair, FileText } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { MatchCheckin, MatchDebrief } from '../lib/types'

const WEEKLY_GOAL_KEY = 'val-master-weekly-goal'
const CHECKIN_ID_KEY = 'val-master-last-checkin-id'

const MAP_SLUGS: Record<string, string> = {
  'Abyss': 'abyss',
  'Ascent': 'ascent',
  'Bind': 'bind',
  'Breeze': 'breeze',
  'Corrode': 'corrode',
  'Fracture': 'fracture',
  'Haven': 'haven',
  'Icebox': 'icebox',
  'Lotus': 'lotus',
  'Pearl': 'pearl',
  'Split': 'split',
  'Sunset': 'sunset',
}

function agentSlug(name: string) {
  return name.toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-')
}

type DebriefWithCheckin = MatchDebrief & {
  match_checkins: Pick<MatchCheckin, 'map' | 'agent_pick'> | null
}

export default function Dashboard() {
  const [checkin, setCheckin] = useState<MatchCheckin | null>(null)
  const [debriefs, setDebriefs] = useState<DebriefWithCheckin[]>([])
  const [weeklyGoal, setWeeklyGoal] = useState(
    () => localStorage.getItem(WEEKLY_GOAL_KEY) ?? ''
  )
  const [editingGoal, setEditingGoal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const checkinId = localStorage.getItem(CHECKIN_ID_KEY)

      const [checkinRes, debriefRes] = await Promise.all([
        checkinId
          ? supabase
              .from('match_checkins')
              .select('*')
              .eq('id', checkinId)
              .single()
          : Promise.resolve({ data: null }),
        supabase
          .from('match_debriefs')
          .select('*, match_checkins(map, agent_pick)')
          .order('created_at', { ascending: false })
          .limit(8),
      ])

      if (checkinRes.data) {
        const created = new Date(checkinRes.data.created_at).getTime()
        const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000
        if (created > sixHoursAgo) {
          setCheckin(checkinRes.data)
        }
      }

      if (debriefRes.data) setDebriefs(debriefRes.data as DebriefWithCheckin[])
      setLoading(false)
    }
    load()
  }, [])

  // Coaching nudges
  const wins = debriefs.filter((d) => d.result === 'win').length
  const losses = debriefs.filter((d) => d.result === 'loss').length
  const winrate = debriefs.length > 0 ? wins / debriefs.length : 1
  const avgQuality = 0

  const resultBadge = (result: MatchDebrief['result']) => {
    const styles: Record<string, string> = {
      win: 'bg-val-green/15 text-val-green',
      loss: 'bg-val-red/15 text-val-red',
      draw: 'bg-text-muted/15 text-text-secondary',
    }
    return styles[result]
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-muted text-sm">Loading...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Session Status */}
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Zap size={16} className={checkin ? 'text-val-green' : 'text-text-muted'} />
            <h2 className="font-heading text-lg font-bold">
              {checkin ? 'Session Active' : 'No Active Session'}
            </h2>
            {checkin && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-val-green/15 text-val-green">
                Live
              </span>
            )}
          </div>

          {checkin ? (
            <>
              <div className="flex flex-wrap gap-2">
                <span className="px-2.5 py-1 rounded bg-bg-elevated text-xs font-medium text-text-secondary">
                  {checkin.agent_pick}
                </span>
                <span className="px-2.5 py-1 rounded bg-bg-elevated text-xs font-medium text-text-secondary">
                  {checkin.map}
                </span>
              </div>
              <p className="text-sm text-text-secondary">
                <span className="text-text-muted">Goal:</span> {checkin.goal}
              </p>
              <div className="flex gap-2">
                <Link
                  to="/tactical"
                  className="flex-1 py-2.5 rounded-lg bg-val-cyan text-bg-primary font-heading font-bold text-xs tracking-wide text-center hover:brightness-110 transition-all flex items-center justify-center gap-1.5"
                >
                  <Crosshair size={14} /> Log Tactical Read
                </Link>
                <Link
                  to="/debrief"
                  className="flex-1 py-2.5 rounded-lg bg-val-red text-white font-heading font-bold text-xs tracking-wide text-center hover:brightness-110 transition-all flex items-center justify-center gap-1.5"
                >
                  <FileText size={14} /> Debrief Match
                </Link>
              </div>
            </>
          ) : (
            <Link
              to="/checkin"
              className="block w-full py-3 rounded-lg bg-val-red text-white font-heading font-bold text-sm tracking-wide text-center hover:brightness-110 transition-all"
            >
              Start Check-In
            </Link>
          )}
        </div>

        {/* Weekly Goal */}
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-val-yellow">
              Weekly Goal
            </h2>
            <button
              onClick={() => setEditingGoal(!editingGoal)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {editingGoal ? 'Done' : 'Edit'}
            </button>
          </div>
          {editingGoal ? (
            <input
              type="text"
              value={weeklyGoal}
              onChange={(e) => setWeeklyGoal(e.target.value)}
              onBlur={() => {
                if (weeklyGoal.trim()) {
                  localStorage.setItem(WEEKLY_GOAL_KEY, weeklyGoal.trim())
                }
                setEditingGoal(false)
              }}
              placeholder="e.g. Reach Immortal 2 by Friday"
              className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-yellow/50"
              autoFocus
            />
          ) : (
            <p className="text-sm text-text-secondary">
              {weeklyGoal || 'No weekly goal set — tap Edit to add one.'}
            </p>
          )}
        </div>
      </div>

      {/* Coaching Nudges */}
      {debriefs.length >= 3 && (
        <div className="space-y-2">
          {winrate < 0.4 && (
            <div className="flex items-start gap-3 bg-val-yellow/5 border border-val-yellow/20 rounded-lg p-4">
              <AlertTriangle size={16} className="text-val-yellow mt-0.5 shrink-0" />
              <p className="text-sm text-val-yellow">
                Tough stretch — review your last debrief and reset your session intent.
                <span className="text-text-muted ml-1">
                  ({wins}W {losses}L last {debriefs.length})
                </span>
              </p>
            </div>
          )}
          {avgQuality < 3 && (
            <div className="flex items-start gap-3 bg-val-cyan/5 border border-val-cyan/20 rounded-lg p-4">
              <Zap size={16} className="text-val-cyan mt-0.5 shrink-0" />
              <p className="text-sm text-val-cyan">
                Quality has been low — consider shortening your session or taking a break.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Session History — Notion Gallery */}
      <div className="space-y-4">
        <h2 className="font-heading text-xl font-bold text-text-primary uppercase tracking-wider">
          Session History
        </h2>

        {debriefs.length === 0 ? (
          <div className="bg-bg-card border border-bg-elevated rounded-xl p-8 text-center">
            <p className="text-text-muted text-sm">No matches debriefed yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {debriefs.map((d) => {
              const mapName = d.match_checkins?.map ?? ''
              const agentName = d.match_checkins?.agent_pick ?? ''
              const slug = MAP_SLUGS[mapName] ?? ''
              const mapImgUrl = slug
                ? `https://bastienr1.github.io/valorant-assets/maps/${slug}.jpg`
                : ''
              const agentImgUrl = agentName
                ? `https://bastienr1.github.io/valorant-assets/agents/${agentSlug(agentName)}.png`
                : ''
              const imgFailed = failedImages.has(d.id)

              return (
                <div
                  key={d.id}
                  className="rounded-lg overflow-hidden bg-bg-card border border-white/5 hover:border-val-cyan/30 transition-colors"
                >
                  {/* Map splash */}
                  {mapImgUrl && !imgFailed ? (
                    <img
                      src={mapImgUrl}
                      alt={mapName}
                      className="w-full h-36 object-cover object-center"
                      onError={() => setFailedImages((prev) => new Set(prev).add(d.id))}
                    />
                  ) : (
                    <div className="w-full h-36 bg-gradient-to-br from-bg-elevated to-bg-primary flex items-center justify-center">
                      <span className="font-heading text-lg font-bold text-text-muted/50">
                        {mapName || 'Unknown Map'}
                      </span>
                    </div>
                  )}

                  {/* Card details */}
                  <div className="p-3 space-y-2">
                    {/* Map — Agent row */}
                    <div className="flex items-center gap-2">
                      <span className="text-val-red text-xs">▼</span>
                      <span className="font-heading font-bold text-sm text-white">
                        {mapName || 'Unknown'} — {agentName || 'Unknown'}
                      </span>
                    </div>

                    {/* Agent icon + Score + Stars */}
                    <div className="flex items-center gap-2">
                      {agentImgUrl && (
                        <img
                          src={agentImgUrl}
                          alt={agentName}
                          className="w-5 h-5 rounded-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                      <span className="font-stats text-xs text-text-secondary">
                        {d.rounds_won} - {d.rounds_lost}
                      </span>
                      <div className="flex gap-0.5 ml-auto">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            size={12}
                            className={star <= 0 ? 'text-val-yellow fill-val-yellow' : 'text-text-muted/30'}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Result badge + YouTube */}
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${resultBadge(d.result)}`}>
                        {d.result}
                      </span>
                      {d.mvp_play && (
                        <span className="text-sm">{d.mvp_play}</span>
                      )}
                      {d.youtube_url && (
                        <a
                          href={d.youtube_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-auto text-val-red text-xs font-bold hover:brightness-125 transition-all"
                        >
                          ▶ VOD
                        </a>
                      )}
                    </div>

                    {/* Key lesson */}
                    <p className="text-xs text-text-secondary line-clamp-2">
                      {d.key_lesson}
                    </p>

                    {/* Date */}
                    <p className="text-[10px] text-text-muted">
                      {new Date(d.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
