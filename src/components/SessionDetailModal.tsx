import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getMapSplash, getAgentIcon } from '../lib/constants'
import type { MatchCheckin, MatchDebrief, TacticalRead } from '../lib/types'

type DebriefWithCheckin = MatchDebrief & {
  match_checkins: Pick<MatchCheckin, 'map' | 'agent_pick'> | null
}

type Tab = 'pre-match' | 'reads' | 'debrief'

interface Props {
  debrief: DebriefWithCheckin
  onClose: () => void
}

function scoreColor(v: number) {
  if (v >= 4) return 'bg-val-green'
  if (v === 3) return 'bg-val-yellow'
  return 'bg-val-red'
}

function scoreTextColor(v: number) {
  if (v >= 4) return 'text-val-green'
  if (v === 3) return 'text-val-yellow'
  return 'text-val-red'
}

const resultStyles: Record<string, string> = {
  win: 'bg-val-green/15 text-val-green',
  loss: 'bg-val-red/15 text-val-red',
  draw: 'bg-text-muted/15 text-text-secondary',
}

const readResultStyles: Record<string, { bg: string; text: string; label: string }> = {
  success: { bg: 'bg-val-green/15', text: 'text-val-green', label: 'Success' },
  partial: { bg: 'bg-val-yellow/15', text: 'text-val-yellow', label: 'Partial' },
  fail: { bg: 'bg-val-red/15', text: 'text-val-red', label: 'Fail' },
}

export default function SessionDetailModal({ debrief, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('debrief')
  const [checkin, setCheckin] = useState<MatchCheckin | null>(null)
  const [reads, setReads] = useState<TacticalRead[]>([])
  const [loading, setLoading] = useState(true)

  const mapName = debrief.match_checkins?.map ?? ''
  const agentName = debrief.match_checkins?.agent_pick ?? ''
  const mapSplash = mapName ? getMapSplash(mapName) : ''
  const agentIcon = agentName ? getAgentIcon(agentName) : ''

  useEffect(() => {
    async function load() {
      const checkinId = debrief.match_checkin_id
      if (!checkinId) { setLoading(false); return }

      const [checkinRes, readsRes] = await Promise.all([
        supabase.from('match_checkins').select('*').eq('id', checkinId).maybeSingle(),
        supabase.from('tactical_reads').select('*').eq('match_checkin_id', checkinId).order('created_at'),
      ])

      if (checkinRes.data) setCheckin(checkinRes.data)
      if (readsRes.data) setReads(readsRes.data)
      setLoading(false)
    }
    load()
  }, [debrief.match_checkin_id])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const themes = debrief.next_focus ? debrief.next_focus.split(', ').filter(Boolean) : []

  const tabAccent: Record<Tab, string> = {
    'pre-match': 'val-cyan',
    'reads': 'val-yellow',
    'debrief': 'val-red',
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-bg-primary/95 flex flex-col overflow-hidden"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-2xl mx-auto h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header banner */}
        <div className="relative shrink-0">
          {mapSplash ? (
            <img
              src={mapSplash}
              alt={mapName}
              className="w-full h-16 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="w-full h-16 bg-bg-elevated" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-bg-primary/60 to-transparent" />

          {/* Header content */}
          <div className="absolute inset-0 flex items-center px-4 gap-3">
            {agentIcon && (
              <img
                src={agentIcon}
                alt={agentName}
                className="w-10 h-10 rounded-full object-cover ring-1 ring-val-red bg-bg-primary/80"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-heading font-bold text-white text-sm truncate">
                  {mapName || 'Unknown'} — {agentName || 'Unknown'}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${resultStyles[debrief.result]}`}>
                  {debrief.result}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-stats text-xs text-text-secondary">
                  {debrief.rounds_won} - {debrief.rounds_lost}
                </span>
                <span className="text-[10px] text-text-muted">
                  {new Date(debrief.created_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-white transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-bg-elevated shrink-0 px-4">
          {([
            { key: 'pre-match' as Tab, label: 'Pre-Match' },
            { key: 'reads' as Tab, label: `Reads${reads.length ? ` (${reads.length})` : ''}` },
            { key: 'debrief' as Tab, label: 'Debrief' },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-xs font-heading font-bold uppercase tracking-wider transition-colors relative
                ${tab === t.key ? `text-${tabAccent[t.key]}` : 'text-text-muted hover:text-text-secondary'}`}
            >
              {t.label}
              {tab === t.key && (
                <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-${tabAccent[t.key]}`} />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-text-muted text-sm">Loading...</span>
            </div>
          ) : tab === 'pre-match' ? (
            <PreMatchTab checkin={checkin} mapName={mapName} agentName={agentName} />
          ) : tab === 'reads' ? (
            <ReadsTab reads={reads} />
          ) : (
            <DebriefTab debrief={debrief} themes={themes} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── PRE-MATCH TAB ─── */

function PreMatchTab({
  checkin, mapName, agentName,
}: {
  checkin: MatchCheckin | null
  mapName: string
  agentName: string
}) {
  if (!checkin) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted text-sm">No check-in data linked to this session.</p>
      </div>
    )
  }

  const scores = [
    { label: 'Mental', value: checkin.mental_score },
    { label: 'Physical', value: checkin.physical_score },
    { label: 'Focus', value: checkin.focus_level },
    { label: 'Calm', value: checkin.tilt_risk },
  ]

  const agentIcon = agentName ? getAgentIcon(agentName) : ''
  const mapSplash = mapName ? getMapSplash(mapName) : ''

  return (
    <>
      {/* Agent + Map */}
      <div className="flex items-center gap-3 bg-bg-card border border-bg-elevated rounded-xl p-4">
        {agentIcon && (
          <img src={agentIcon} alt={agentName}
            className="w-12 h-12 rounded-full object-cover ring-1 ring-val-cyan bg-bg-primary/80"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="flex-1">
          <p className="font-heading font-bold text-white text-sm">{agentName}</p>
          <p className="text-text-muted text-xs">{mapName}</p>
        </div>
        {mapSplash && (
          <img src={mapSplash} alt={mapName}
            className="w-16 h-10 rounded object-cover opacity-60"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>

      {/* Mental state bars */}
      <div className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3">
        <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-val-cyan">
          Mental State
        </h3>
        {scores.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="text-xs text-text-secondary w-16 shrink-0 font-medium">{s.label}</span>
            <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreColor(s.value)}`}
                style={{ width: `${(s.value / 5) * 100}%` }}
              />
            </div>
            <span className={`font-stats text-xs w-4 text-right ${scoreTextColor(s.value)}`}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Goal */}
      {checkin.goal && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-4">
          <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-val-cyan mb-2">
            Session Goal
          </h3>
          <p className="text-sm text-text-primary">{checkin.goal}</p>
        </div>
      )}

      {/* Notes */}
      {checkin.notes && (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-4">
          <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-val-cyan mb-2">
            Notes
          </h3>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{checkin.notes}</p>
        </div>
      )}
    </>
  )
}

/* ─── READS TAB ─── */

function ReadsTab({ reads }: { reads: TacticalRead[] }) {
  if (reads.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted text-sm">No reads logged this session.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {reads.map((r) => (
        <div key={r.id} className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-2.5">
          {/* Top badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-heading font-bold text-text-primary">{r.map}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              r.side === 'attack' ? 'bg-val-red/15 text-val-red' : 'bg-val-cyan/15 text-val-cyan'
            }`}>
              {r.side}
            </span>
            <span className="px-2 py-0.5 rounded bg-val-yellow/15 text-val-yellow text-[10px] font-bold uppercase">
              {r.round_type.replace('_', ' ')}
            </span>
            {r.result && readResultStyles[r.result] && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ml-auto ${readResultStyles[r.result].bg} ${readResultStyles[r.result].text}`}>
                {readResultStyles[r.result].label}
              </span>
            )}
          </div>

          {/* Read description */}
          <p className="text-sm text-text-primary">{r.read_description}</p>

          {/* Counter action */}
          {r.counter_action && (
            <div>
              <span className="text-[10px] font-bold uppercase text-text-muted tracking-wider">Counter</span>
              <p className="text-sm text-text-secondary mt-0.5">{r.counter_action}</p>
            </div>
          )}

          {/* Confidence pips */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted uppercase tracking-wider mr-1">Confidence</span>
            {[1, 2, 3, 4, 5].map((pip) => (
              <div
                key={pip}
                className={`w-2 h-2 rounded-full ${
                  pip <= r.confidence ? 'bg-val-yellow' : 'bg-bg-elevated'
                }`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── DEBRIEF TAB ─── */

function DebriefTab({
  debrief, themes,
}: {
  debrief: DebriefWithCheckin
  themes: string[]
}) {
  return (
    <>
      {/* Peak moment */}
      <div className="bg-val-green/5 border border-val-green/20 rounded-xl p-4">
        <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-val-green mb-2">
          Peak Moment
        </h3>
        <p className="text-sm text-text-primary">{debrief.peak_moment}</p>
      </div>

      {/* Tilt moment */}
      {debrief.tilt_moment && (
        <div className="bg-val-yellow/5 border border-val-yellow/20 rounded-xl p-4">
          <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-val-yellow mb-2">
            To Polish
          </h3>
          <p className="text-sm text-text-primary">{debrief.tilt_moment}</p>
        </div>
      )}

      {/* Themes + Emoji + Stuck to focus */}
      <div className="bg-bg-card border border-bg-elevated rounded-xl p-4 space-y-3">
        {/* Themes */}
        {themes.length > 0 && (
          <div>
            <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-text-muted mb-2">
              Themes
            </h3>
            <div className="flex flex-wrap gap-2">
              {themes.map((t, i) => (
                <span
                  key={t}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    i === 0
                      ? 'bg-val-red/15 text-val-red border border-val-red/20'
                      : 'bg-bg-elevated text-text-secondary'
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Emoji vibe + Stuck to focus */}
        <div className="flex items-center gap-4 pt-1">
          {debrief.mvp_play && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Vibe</span>
              <span className="text-lg">{debrief.mvp_play}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">Stuck to Focus</span>
            <span className={`text-xs font-bold ${debrief.goal_met ? 'text-val-green' : 'text-val-red'}`}>
              {debrief.goal_met ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
      </div>

      {/* Key lesson */}
      <div className="bg-bg-card border border-bg-elevated rounded-xl p-4">
        <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-val-red mb-2">
          Key Lesson
        </h3>
        <p className="text-sm text-text-primary">{debrief.key_lesson}</p>
      </div>

      {/* YouTube VOD */}
      {debrief.youtube_url && (
        <a
          href={debrief.youtube_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-bg-card border border-bg-elevated rounded-xl p-4 hover:border-val-red/30 transition-colors"
        >
          <span className="text-val-red text-xs font-bold">▶ Watch VOD</span>
        </a>
      )}
    </>
  )
}
