import { useState } from 'react'
import type { MatchRound, VodTag, VodComment } from '../lib/types'
import { COMMENT_TAG_CATEGORIES } from '../lib/commentTags'
import { supabase } from '../lib/supabase'
import { ChevronDown, ChevronRight, Skull, Crosshair, MessageSquare, Plus, X, Star } from 'lucide-react'

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

interface RoundCardProps {
  round: MatchRound
  roundVideoTime: number
  r1StartMs: number | null
  manualTags: VodTag[]
  comments: VodComment[]
  vodReviewId: string
  onSeek: (seconds: number) => void
  onCommentAdded: (comment: VodComment) => void
  onCommentDeleted: (commentId: string) => void
}

export default function RoundCard({
  round, roundVideoTime, r1StartMs: _r1StartMs, manualTags, comments,
  vodReviewId, onSeek, onCommentAdded, onCommentDeleted,
}: RoundCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [commentingOn, setCommentingOn] = useState<number | null>(null) // timestamp_seconds of the kill/round being commented
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')
  const [isStrength, setIsStrength] = useState(false)
  const [saving, setSaving] = useState(false)

  const hasContent = round.kills > 0 || round.deaths > 0 || manualTags.length > 0 || comments.length > 0

  // Compute highlight badges
  const badges: Array<{ label: string; color: string }> = []
  if (round.kills >= 5) badges.push({ label: 'ACE', color: 'text-val-green' })
  else if (round.kills >= 4) badges.push({ label: '4K', color: 'text-val-yellow' })
  else if (round.kills >= 3) badges.push({ label: '3K', color: 'text-val-yellow' })
  else if (round.kills >= 2) badges.push({ label: '2K', color: 'text-text-secondary' })

  const killEvents = round.kill_events || []
  if (killEvents.length > 0 && killEvents[0].kill_time_ms <= 15000) {
    badges.push({ label: 'FB', color: 'text-val-cyan' })
  }

  const deathEvents = round.death_events || []
  if (deathEvents.length > 0 && deathEvents[0].kill_time_ms <= 15000) {
    badges.push({ label: 'FD', color: 'text-val-red' })
  }

  // Compute video timestamps for kills/deaths
  const getKillVideoTime = (killTimeMs: number) => roundVideoTime + (killTimeMs / 1000)

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const startCommenting = (timestampSeconds: number) => {
    setCommentingOn(timestampSeconds)
    setSelectedTags([])
    setFreeText('')
    setIsStrength(false)
  }

  const cancelComment = () => {
    setCommentingOn(null)
    setSelectedTags([])
    setFreeText('')
  }

  const saveComment = async () => {
    if (selectedTags.length === 0 && !freeText.trim()) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('vod_comments')
        .insert({
          user_id: user.id,
          vod_review_id: vodReviewId,
          timestamp_seconds: commentingOn!,
          round_number: round.round_number,
          tags: selectedTags,
          free_text: freeText.trim() || null,
          is_strength: isStrength,
        })
        .select()
        .single()

      if (error) throw error
      if (data) onCommentAdded(data)
      cancelComment()
    } catch (err) {
      console.error('Failed to save comment:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    try {
      const { error } = await supabase.from('vod_comments').delete().eq('id', commentId)
      if (!error) onCommentDeleted(commentId)
    } catch (err) {
      console.error('Failed to delete comment:', err)
    }
  }

  const resultColor = round.round_won ? 'val-green' : 'val-red'
  const resultText = round.round_won ? 'Won' : 'Lost'

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      round.round_won ? 'border-val-green/15' : 'border-val-red/15'
    } bg-bg-card`}>
      {/* Round header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/30 transition-colors text-left"
      >
        {hasContent ? (
          expanded ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
        ) : (
          <div className="w-3 h-3 shrink-0" />
        )}

        {/* Timestamp */}
        <span
          className="font-stats text-[11px] text-val-cyan w-10 shrink-0 cursor-pointer hover:underline"
          onClick={(e) => { e.stopPropagation(); onSeek(roundVideoTime) }}
        >
          {formatTime(roundVideoTime)}
        </span>

        {/* Round number + side */}
        <span className="text-xs font-heading font-bold text-text-primary">
          R{round.round_number}
        </span>
        <span className="text-[10px] text-text-muted uppercase">
          {round.side === 'attack' ? 'ATK' : 'DEF'}
        </span>

        {/* Result */}
        <span className={`text-[10px] font-bold text-${resultColor}`}>
          {resultText}
        </span>

        {/* Badges */}
        {badges.map(b => (
          <span key={b.label} className={`text-[9px] font-bold ${b.color} px-1 py-0.5 rounded bg-bg-elevated`}>
            {b.label}
          </span>
        ))}

        {/* Kill/death count summary */}
        {round.kills > 0 && (
          <span className="text-[10px] text-val-green font-stats ml-auto">{round.kills}K</span>
        )}
        {round.deaths > 0 && (
          <span className="text-[10px] text-val-red font-stats">{round.deaths}D</span>
        )}
        {comments.length > 0 && (
          <MessageSquare className="w-3 h-3 text-val-yellow shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && hasContent && (
        <div className="border-t border-bg-elevated px-3 py-2 space-y-1">
          {/* Kill events */}
          {killEvents.map((kill, i) => {
            const killTs = Math.round(getKillVideoTime(kill.kill_time_ms))
            const killComments = comments.filter(c => c.timestamp_seconds === killTs)
            return (
              <div key={`kill-${i}`} className="space-y-1">
                <div className="flex items-center gap-2 pl-4 group">
                  <Crosshair className="w-3 h-3 text-val-green shrink-0" />
                  <span
                    className="font-stats text-[10px] text-val-cyan cursor-pointer hover:underline w-9 shrink-0"
                    onClick={() => onSeek(killTs)}
                  >
                    {formatTime(killTs)}
                  </span>
                  <span className="text-[11px] text-text-secondary">
                    Killed <strong className="text-text-primary">{kill.victim}</strong>
                    {kill.weapon && <span className="text-text-muted"> ({kill.weapon})</span>}
                  </span>
                  <button
                    onClick={() => startCommenting(killTs)}
                    className="ml-auto p-0.5 text-text-muted hover:text-val-cyan opacity-0 group-hover:opacity-100 transition-all"
                    title="Add note"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {/* Existing comments on this kill */}
                {killComments.map(c => (
                  <div key={c.id} className={`ml-8 px-2 py-1 rounded text-[10px] border ${c.is_strength ? 'border-val-green/20 bg-val-green/5' : 'border-bg-elevated bg-bg-elevated/30'} group/comment`}>
                    <div className="flex items-center gap-1 flex-wrap">
                      {(c.tags || []).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[9px]">
                          {tag}
                        </span>
                      ))}
                      {c.free_text && <span className="text-text-muted italic">{c.free_text}</span>}
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="ml-auto p-0.5 text-text-muted hover:text-val-red opacity-0 group-hover/comment:opacity-100 transition-all"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Comment input for this kill */}
                {commentingOn === killTs && (
                  <CommentInput
                    selectedTags={selectedTags}
                    freeText={freeText}
                    isStrength={isStrength}
                    saving={saving}
                    onToggleTag={toggleTag}
                    onFreeTextChange={setFreeText}
                    onStrengthToggle={() => setIsStrength(!isStrength)}
                    onSave={saveComment}
                    onCancel={cancelComment}
                  />
                )}
              </div>
            )
          })}

          {/* Death events */}
          {deathEvents.map((death, i) => {
            const deathTs = Math.round(getKillVideoTime(death.kill_time_ms))
            return (
              <div key={`death-${i}`} className="flex items-center gap-2 pl-4">
                <Skull className="w-3 h-3 text-val-red shrink-0" />
                <span
                  className="font-stats text-[10px] text-val-cyan cursor-pointer hover:underline w-9 shrink-0"
                  onClick={() => onSeek(deathTs)}
                >
                  {formatTime(deathTs)}
                </span>
                <span className="text-[11px] text-text-secondary">
                  Died to <strong className="text-text-primary">{death.killer}</strong>
                  {death.weapon && <span className="text-text-muted"> ({death.weapon})</span>}
                </span>
              </div>
            )
          })}

          {/* Manual tags for this round */}
          {manualTags.length > 0 && (
            <div className="pl-4 pt-1 space-y-1">
              {manualTags.map(tag => (
                <div key={tag.id} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.tag_type === 'strength' ? '#3DD598' : tag.tag_type === 'mistake' ? '#FF4655' : '#94A3B8' }} />
                  <span className="font-stats text-[10px] text-val-cyan w-9 shrink-0 cursor-pointer hover:underline" onClick={() => onSeek(tag.timestamp_seconds)}>
                    {formatTime(tag.timestamp_seconds)}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-bg-elevated text-text-secondary">{tag.tag_type}</span>
                  <span className="text-[11px] text-text-secondary truncate">{tag.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Add comment on round level (not on a specific kill) */}
          {commentingOn === null && (
            <button
              onClick={() => startCommenting(Math.round(roundVideoTime))}
              className="ml-4 flex items-center gap-1 text-[10px] text-text-muted hover:text-val-cyan transition-colors mt-1"
            >
              <Plus className="w-3 h-3" /> Add note to round
            </button>
          )}
          {commentingOn === Math.round(roundVideoTime) && (
            <CommentInput
              selectedTags={selectedTags}
              freeText={freeText}
              isStrength={isStrength}
              saving={saving}
              onToggleTag={toggleTag}
              onFreeTextChange={setFreeText}
              onStrengthToggle={() => setIsStrength(!isStrength)}
              onSave={saveComment}
              onCancel={cancelComment}
            />
          )}

          {/* Round-level comments (not linked to a specific kill) */}
          {comments.filter(c => !killEvents.some(k => Math.round(getKillVideoTime(k.kill_time_ms)) === c.timestamp_seconds) && c.timestamp_seconds === Math.round(roundVideoTime)).map(c => (
            <div key={c.id} className={`ml-4 px-2 py-1 rounded text-[10px] border ${c.is_strength ? 'border-val-green/20 bg-val-green/5' : 'border-bg-elevated bg-bg-elevated/30'} group/comment`}>
              <div className="flex items-center gap-1 flex-wrap">
                {(c.tags || []).map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[9px]">{tag}</span>
                ))}
                {c.free_text && <span className="text-text-muted italic">{c.free_text}</span>}
                <button onClick={() => handleDeleteComment(c.id)} className="ml-auto p-0.5 text-text-muted hover:text-val-red opacity-0 group-hover/comment:opacity-100 transition-all">
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Sub-component: Comment input panel with tag chips
function CommentInput({ selectedTags, freeText, isStrength, saving, onToggleTag, onFreeTextChange, onStrengthToggle, onSave, onCancel }: {
  selectedTags: string[]
  freeText: string
  isStrength: boolean
  saving: boolean
  onToggleTag: (tag: string) => void
  onFreeTextChange: (text: string) => void
  onStrengthToggle: () => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="ml-4 bg-bg-elevated/50 border border-bg-elevated rounded-lg p-2 space-y-2">
      {/* Tag chips by category */}
      {Object.entries(COMMENT_TAG_CATEGORIES).map(([catKey, cat]) => (
        <div key={catKey}>
          <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color: cat.color }}>{cat.label}</span>
          <div className="flex gap-1 flex-wrap mt-0.5">
            {cat.tags.map(tag => (
              <button
                key={tag}
                onClick={() => onToggleTag(tag)}
                className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                  selectedTags.includes(tag)
                    ? 'border-val-cyan/40 bg-val-cyan/10 text-val-cyan'
                    : 'border-transparent bg-bg-card text-text-muted hover:text-text-secondary'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Free text + controls */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={freeText}
          onChange={(e) => onFreeTextChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
          placeholder="Optional note..."
          className="flex-1 bg-bg-card border border-bg-elevated rounded px-2 py-1 text-[10px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/30"
        />
        <button
          onClick={onStrengthToggle}
          className={`p-1 rounded transition-colors ${isStrength ? 'text-val-green bg-val-green/10' : 'text-text-muted hover:text-val-green'}`}
          title="Mark as strength"
        >
          <Star className="w-3 h-3" />
        </button>
        <button
          onClick={onSave}
          disabled={saving || (selectedTags.length === 0 && !freeText.trim())}
          className="px-2 py-1 bg-val-green/10 text-val-green rounded text-[9px] font-medium disabled:opacity-40"
        >
          {saving ? '...' : 'Save'}
        </button>
        <button onClick={onCancel} className="p-1 text-text-muted hover:text-text-secondary">
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
