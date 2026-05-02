---
title: "VAL Master Phase 4 Sprint 4 — Claude Code Implementation Spec"
date: 2026-04-05
created: 2026-04-05T23:00
type: project-doc
status: processed
tags:
  - val-master
  - phase-4
  - sprint-4
  - claude-code-prompt
aliases:
  - sprint 4 cc spec
  - sprint 4 implementation
source: "Claude conversation"
project: "[[Valorant Performance Hub]]"
related:
  - "[[2026-04-05-VAL-Master-Phase4-Sprint4-HierarchicalRounds-InlineDebrief]]"
  - "[[2026-03-30-VAL-Master-Phase4-PostMatch-Pivot]]"
  - "[[2026-04-03-VAL-Master-Phase4-Sprint3-TimestampedTags]]"
cssclasses:
  - obsidian-ready
action-items: 1
---

# VAL Master Phase 4 Sprint 4 — Claude Code Implementation Spec

> [!abstract] Essence
> Implementation prompt for Sprint 4. Companion to [[2026-04-05-VAL-Master-Phase4-Sprint4-HierarchicalRounds-InlineDebrief|Sprint 4 Reasoning Doc]]. Copy the Claude Code prompt section into Claude Code after running the SQL migration.

---

## Pre-requisites

### SQL Migration — Run in Supabase SQL Editor FIRST:

```sql
CREATE TABLE IF NOT EXISTS vod_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  vod_review_id UUID NOT NULL REFERENCES vod_reviews(id) ON DELETE CASCADE,
  timestamp_seconds INTEGER NOT NULL,
  round_number SMALLINT,
  tags JSONB DEFAULT '[]'::jsonb,
  free_text TEXT,
  is_strength BOOLEAN DEFAULT false
);

ALTER TABLE vod_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vod_comments"
  ON vod_comments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vod_comments"
  ON vod_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own vod_comments"
  ON vod_comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own vod_comments"
  ON vod_comments FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_vod_comments_vod_review_id ON vod_comments(vod_review_id);
CREATE INDEX IF NOT EXISTS idx_vod_comments_round_number ON vod_comments(round_number);
```

---

## Claude Code Prompt

> [!important] Copy everything below this line into Claude Code

---

**Context:** VAL Master Phase 4 Sprint 4. We're transforming the VOD Review page from a flat tag list into a hierarchical round-grouped view with structured comments and inline debrief.

**Repo:** `bastienr1/VAL-Master` on `main` branch.

**Stack:** React 19, Vite, TypeScript, Tailwind 4 (using `@theme` in `index.css` for design tokens), Supabase, lucide-react for icons.

**Design tokens (from `src/index.css`):**
- Colors: `val-red` (#FF4655), `val-cyan` (#53CADC), `val-yellow` (#FFCA3A), `val-green` (#3DD598), `bg-primary` (#0A0E17), `bg-secondary` (#111827), `bg-card` (#1A1F2E), `bg-elevated` (#242938), `text-primary` (#F1F5F9), `text-secondary` (#94A3B8), `text-muted` (#64748B)
- Fonts: `font-heading` (Rajdhani), `font-body` (Inter), `font-stats` (JetBrains Mono)

**Current state:**
- `VodReview.tsx` (~900 lines) has: YouTube player, playback controls, barrier sync, manual tagging (T key), timeline scrubber with round ticks + manual tag dots, flat tag list, match context sidebar, Sprint 4 placeholder for inline debrief.
- `matchSync.ts` fetches round data from Henrik API, stores in `match_rounds` with `kill_events`/`death_events` JSONB and `round_start_ms` for precise timing. `generateAutoTags` creates round marker tags. **DO NOT MODIFY matchSync.ts.**
- `match_rounds` table already has per-round data: kills, deaths, side, round_won, kill_events, death_events, round_start_ms.
- `vod_reviews` table already has debrief columns: peak_moment, key_lesson, themes, match_quality, notes, barrier_drop_offset.
- New `vod_comments` table created via migration: tags (JSONB), free_text, round_number, timestamp_seconds, is_strength.

**What this sprint does:**
1. Replace the flat tag list below the timeline scrubber with a **hierarchical round view** (ATK/DEF sections → collapsible round cards → nested kill/death events → expandable comments)
2. Add **structured comments** on kills/rounds with seeded tag chips
3. Add **inline debrief** at the bottom replacing the Sprint 4 placeholder
4. Add **round highlight badges** (2K/3K/4K/ACE, First Blood)
5. Keep everything above the tag list UNCHANGED: video player, playback controls, URL input, sync bar, manual tag pills, timeline scrubber

**Critical: DO NOT modify `src/lib/matchSync.ts`. The round sync and auto-tag system must remain untouched.**

**Files to CREATE:**
- `src/lib/commentTags.ts` — Seeded comment tag vocabulary
- `src/components/RoundCard.tsx` — Collapsible round card component
- `src/components/InlineDebrief.tsx` — Inline debrief form component

**Files to MODIFY:**
- `src/lib/types.ts` — Update VodComment interface
- `src/pages/VodReview.tsx` — Replace flat tag list with hierarchical view, replace debrief placeholder, add comment state/CRUD

---

### Task 1: Create `src/lib/commentTags.ts`

New file with seeded comment tag vocabulary:

```typescript
export const COMMENT_TAG_CATEGORIES = {
  technique: {
    label: 'Technique',
    color: '#53CADC',
    tags: ['Flick', 'Spray Transfer', '1-Tap', 'Hold Angle', 'Burst', 'Counter-strafe', 'Jiggle Peek', 'Wide Swing'],
  },
  positioning: {
    label: 'Positioning',
    color: '#6EE7B7',
    tags: ['Hold', 'Off-angle', 'Angle Advantage', 'Rush', 'Rotate', 'Anchor', 'Lurk', 'Peek'],
  },
  equipment: {
    label: 'Equipment',
    color: '#F97316',
    tags: ['Classic', 'Sheriff', 'Spectre', 'Vandal', 'Phantom', 'Operator', 'Satchels', 'Ultimate', 'Shorty', 'Marshal'],
  },
  play_type: {
    label: 'Play Type',
    color: '#FFCA3A',
    tags: ['Entry', 'Trade', 'Clutch', 'Retake', 'Post-plant', 'Support', 'Anti-eco', 'Save'],
  },
} as const

export type CommentTagCategory = keyof typeof COMMENT_TAG_CATEGORIES

export const DEBRIEF_THEMES = [
  'Crosshair Placement', 'Game Sense', 'Utility Usage', 'Positioning',
  'Communication', 'Economy', 'Clutch Factor', 'Trading',
  'Map Control', 'Entry Fragging', 'Patience', 'Aggression',
] as const
```

---

### Task 2: Update `src/lib/types.ts`

Find the existing `VodComment` interface:
```typescript
export interface VodComment {
  id: string
  created_at: string
  user_id: string
  vod_review_id: string
  timestamp_seconds: number
  round_number: number | null
  content: string
  is_strength: boolean
}
```

Replace with:
```typescript
export interface VodComment {
  id: string
  created_at: string
  user_id: string
  vod_review_id: string
  timestamp_seconds: number
  round_number: number | null
  tags: string[]
  free_text: string | null
  is_strength: boolean
}
```

---

### Task 3: Create `src/components/RoundCard.tsx`

New file. This component renders a single round as a collapsible card with nested kill/death events and comments.

```typescript
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
  round, roundVideoTime, r1StartMs, manualTags, comments,
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
```

---

### Task 4: Create `src/components/InlineDebrief.tsx`

New file. Inline debrief form that saves to existing `vod_reviews` columns.

```typescript
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
```

---

### Task 5: Modify `src/pages/VodReview.tsx`

Read the file first. Apply these surgical changes using `str_replace`. **Everything above the tag list (video, controls, URL, sync bar, tag pills, timeline scrubber) stays exactly as-is.**

#### 5a. Add imports

Add to the existing imports at the top:
```typescript
import RoundCard from '../components/RoundCard'
import InlineDebrief from '../components/InlineDebrief'
import type { VodComment } from '../lib/types'
```

Note: `VodComment` needs to be added to the type import line alongside the existing types.

#### 5b. Add comment state

After the existing match sync state variables (`showAutoTags` line), add:

```typescript
  // Comments state
  const [comments, setComments] = useState<VodComment[]>([])
```

#### 5c. Add comments loading effect

After the existing tag loading `useEffect`, add:

```typescript
  // Load comments when vod_review is available
  useEffect(() => {
    if (!vodReview) return

    async function loadComments() {
      const { data, error } = await supabase
        .from('vod_comments')
        .select('*')
        .eq('vod_review_id', vodReview!.id)
        .order('timestamp_seconds', { ascending: true })

      if (!error && data) setComments(data)
    }
    loadComments()
  }, [vodReview])
```

#### 5d. Add comment handlers

After the `handleBarrierSync` function, add:

```typescript
  // Comment handlers
  const handleCommentAdded = (comment: VodComment) => {
    setComments(prev => [...prev, comment].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds))
  }

  const handleCommentDeleted = (commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId))
  }
```

#### 5e. Add round video time computation helper

After the comment handlers, add:

```typescript
  // Compute video timestamps for rounds (same logic as generateAutoTags)
  const getRoundVideoTime = useCallback((round: MatchRound): number => {
    if (!vodReview?.barrier_drop_offset) return 0
    const r1StartMs = matchRounds[0]?.round_start_ms
    if (r1StartMs && round.round_start_ms) {
      return vodReview.barrier_drop_offset + (round.round_start_ms - r1StartMs) / 1000
    }
    // Fallback: estimate from round index
    return vodReview.barrier_drop_offset + ((round.round_number - 1) * 110)
  }, [vodReview?.barrier_drop_offset, matchRounds])
```

#### 5f. Replace the flat tag list with the hierarchical round view

Find this exact block (the tag list IIFE):

```tsx
              {/* Tag list */}
              {(() => {
                const visibleTags = showAutoTags
                  ? tags
                  : tags.filter(t => !t.is_auto)
                if (visibleTags.length === 0) return null

                return (
                  <div className="bg-bg-card border border-bg-elevated rounded-lg overflow-hidden">
                    <div className="max-h-60 overflow-y-auto divide-y divide-bg-elevated">
                      {visibleTags.map(tag => {
```

Find the **entire tag list block** from `{/* Tag list */}` through its closing `})()}` and replace it with:

```tsx
              {/* Hierarchical Round View */}
              {vodReview.barrier_drop_offset != null && matchRounds.length > 0 && (
                <div className="space-y-3">
                  {/* ATK section */}
                  {(() => {
                    const atkRounds = matchRounds.filter(r => r.side === 'attack')
                    if (atkRounds.length === 0) return null
                    return (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-val-red uppercase tracking-widest">Attack</span>
                          <div className="flex-1 h-px bg-val-red/20" />
                        </div>
                        <div className="space-y-1">
                          {atkRounds.map(round => (
                            <RoundCard
                              key={round.round_number}
                              round={round}
                              roundVideoTime={getRoundVideoTime(round)}
                              r1StartMs={matchRounds[0]?.round_start_ms}
                              manualTags={tags.filter(t => !t.is_auto && t.round_number === round.round_number)}
                              comments={comments.filter(c => c.round_number === round.round_number)}
                              vodReviewId={vodReview.id}
                              onSeek={seekToTag}
                              onCommentAdded={handleCommentAdded}
                              onCommentDeleted={handleCommentDeleted}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* DEF section */}
                  {(() => {
                    const defRounds = matchRounds.filter(r => r.side === 'defense')
                    if (defRounds.length === 0) return null
                    return (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-val-cyan uppercase tracking-widest">Defense</span>
                          <div className="flex-1 h-px bg-val-cyan/20" />
                        </div>
                        <div className="space-y-1">
                          {defRounds.map(round => (
                            <RoundCard
                              key={round.round_number}
                              round={round}
                              roundVideoTime={getRoundVideoTime(round)}
                              r1StartMs={matchRounds[0]?.round_start_ms}
                              manualTags={tags.filter(t => !t.is_auto && t.round_number === round.round_number)}
                              comments={comments.filter(c => c.round_number === round.round_number)}
                              vodReviewId={vodReview.id}
                              onSeek={seekToTag}
                              onCommentAdded={handleCommentAdded}
                              onCommentDeleted={handleCommentDeleted}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Unlinked manual tags (tags without a round_number) */}
                  {(() => {
                    const unlinkedTags = tags.filter(t => !t.is_auto && !t.round_number)
                    if (unlinkedTags.length === 0) return null
                    return (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">General Tags</span>
                          <div className="flex-1 h-px bg-bg-elevated" />
                        </div>
                        <div className="bg-bg-card border border-bg-elevated rounded-lg overflow-hidden">
                          <div className="divide-y divide-bg-elevated">
                            {unlinkedTags.map(tag => {
                              const tagColor = ALL_TAG_COLORS[tag.tag_type]
                              return (
                                <div
                                  key={tag.id}
                                  className="flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/50 cursor-pointer group transition-colors"
                                  onClick={() => seekToTag(tag.timestamp_seconds)}
                                >
                                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagColor?.dotColor || '#64748B' }} />
                                  <span className="font-stats text-[11px] text-val-cyan w-10 shrink-0">{formatTime(tag.timestamp_seconds)}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${tagColor?.color}/15 ${tagColor?.textColor} shrink-0`}>{tag.tag_type}</span>
                                  <span className="text-xs text-text-secondary truncate flex-1">{tag.label}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteTag(tag.id) }}
                                    className="p-1 text-text-muted hover:text-val-red opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Flat tag list fallback — when no barrier sync yet */}
              {(vodReview.barrier_drop_offset == null || matchRounds.length === 0) && tags.length > 0 && (
                <div className="bg-bg-card border border-bg-elevated rounded-lg overflow-hidden">
                  <div className="max-h-60 overflow-y-auto divide-y divide-bg-elevated">
                    {(showAutoTags ? tags : tags.filter(t => !t.is_auto)).map(tag => {
                      const tagMeta = ALL_TAG_COLORS[tag.tag_type]
                      return (
                        <div
                          key={tag.id}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/50 cursor-pointer group transition-colors"
                          onClick={() => seekToTag(tag.timestamp_seconds)}
                        >
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagMeta?.dotColor || '#64748B' }} />
                          <span className="font-stats text-[11px] text-val-cyan w-10 shrink-0">{formatTime(tag.timestamp_seconds)}</span>
                          {tag.round_number && <span className="text-[9px] text-text-muted w-6 shrink-0">R{tag.round_number}</span>}
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${tagMeta?.color}/15 ${tagMeta?.textColor} shrink-0`}>{tag.tag_type}</span>
                          <span className="text-xs text-text-secondary truncate flex-1">{tag.label}</span>
                          {tag.is_auto ? (
                            <span className="text-[9px] text-text-muted shrink-0">auto</span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteTag(tag.id) }}
                              className="p-1 text-text-muted hover:text-val-red opacity-0 group-hover:opacity-100 transition-all shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
```

#### 5g. Replace the Sprint 4 placeholder with InlineDebrief

Find this block in the right panel:

```tsx
          {/* Sprint 4 preview — inline debrief placeholder */}
          <div className="bg-bg-card border border-dashed border-bg-elevated rounded-lg px-4 py-6 text-center">
            <p className="text-text-muted text-xs">
              📝 Inline debrief — Sprint 4. Peak moment, key lesson, themes, quality rating.
            </p>
          </div>
```

Replace with:

```tsx
          {/* Inline debrief */}
          {vodReview && (
            <InlineDebrief vodReview={vodReview} onUpdate={setVodReview} />
          )}
```

---

### Commit message:
```
Phase 4 Sprint 4: Hierarchical round view + structured comments + inline debrief

- Replace flat tag list with ATK/DEF grouped round cards
- Collapsible round cards with nested kill/death events
- Round highlight badges: 2K/3K/4K/ACE, First Blood, First Death
- Structured comments with seeded tag chips (technique/positioning/equipment/play type)
- Comments stored as JSON tags in vod_comments table
- Inline debrief: peak moment, key lesson, theme chips, quality stars
- Debrief saves to existing vod_reviews columns
- Flat tag list preserved as fallback when no barrier sync
- New components: RoundCard.tsx, InlineDebrief.tsx, commentTags.ts
```

---

## Verification After Running

1. **Build passes:** `npm run build` — zero TypeScript errors
2. **Navigate:** Open a match with synced round data
3. **ATK/DEF sections visible:** Rounds grouped under Attack and Defense headers
4. **Round cards:** Each round shows timestamp, round number, side, Won/Lost, kill count
5. **Expand a round:** Click → shows kill events (green crosshair) and death events (red skull) with timestamps
6. **Click a kill timestamp:** Video seeks to that moment
7. **Highlight badges:** Rounds with 2+ kills show 2K/3K/4K/ACE badge
8. **Add comment on kill:** Hover a kill → click + → tag chips appear → select some → Save
9. **Comment persists:** Reload page → comment still shows under the kill
10. **Delete comment:** Hover comment → X button → removed
11. **Inline debrief:** Right panel shows peak moment, key lesson, themes, quality stars
12. **Save debrief:** Fill fields → click Save Debrief → shows "Saved!" → reload → data persists
13. **Fallback:** Open a match WITHOUT barrier sync → flat tag list still works
14. **Manual tags:** Tags created with T key appear under their round (if round_number matches) or in General Tags section
15. **Timeline scrubber unchanged:** Round ticks and manual tag dots still work

---

## Action Items

- [ ] Execute this Claude Code prompt after running the SQL migration

> [!question]- Open Loops
> - Manual tags from Sprint 3 don't have `round_number` set (they were created before the hierarchical view). They'll appear in the "General Tags" section. Future improvement: auto-assign round_number based on timestamp proximity to round start times.
> - The `getRoundVideoTime` helper duplicates logic from `generateAutoTags` in matchSync.ts. Could extract to a shared utility, but keeping it separate avoids touching matchSync.ts.
