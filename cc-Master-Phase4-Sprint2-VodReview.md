---
title: "VAL Master Phase 4 Sprint 2 — VOD Review Workstation"
date: 2026-04-03
created: 2026-04-03T22:30
type: project-doc
status: processed
tags:
  - val-master
  - phase-4
  - sprint-2
  - vod-review
  - youtube-iframe-api
  - claude-code-prompt
aliases:
  - sprint 2 vod review
  - phase 4 sprint 2
  - vod workstation
source: "Claude conversation"
project: "[[Valorant Performance Hub]]"
related:
  - "[[2026-03-30-VAL-Master-Phase4-PostMatch-Pivot]]"
  - "[[2026-04-01-VAL-Master-Phase4-Sprint1-MatchLibrary]]"
  - "[[2026-03-28-VAL-Master-Sprint3-Debrief-Upsert-Dashboard-Stats]]"
  - "[[Valorant-Performance-Hub-Project-Status]]"
cssclasses:
  - obsidian-ready
action-items: 4
version: "4.2"
---

# VAL Master Phase 4 Sprint 2 — VOD Review Workstation

> [!abstract] Essence
> Transform the VodReview placeholder into the core analysis workstation: YouTube IFrame API embed with full playback control, a YouTube URL input with `vod_reviews` upsert, and match context panel — the scaffold that Sprint 3 (tags) and Sprint 4 (comments + debrief) will build on.

---

## Sprint 2 Scope

This sprint replaces the current Sprint 2 placeholder in `VodReview.tsx` with the actual VOD review workstation scaffold. The page becomes a two-panel layout: video + controls on the left, match context on the right. No tagging or debrief yet — that's Sprint 3 and 4. This sprint nails the video integration and URL-to-match linking.

### What Ships
1. **YouTube IFrame API integration** — Embed player with programmatic control (`seekTo`, `getCurrentTime`, `pauseVideo`, `getDuration`)
2. **YouTube URL input** — Paste a URL, extract video ID, link it to the match via `vod_reviews` table upsert
3. **Match context sidebar** — Compact stats card that stays visible while watching
4. **SQL migration** — Create `vod_reviews` table + add `youtube_url` column to `matches` table
5. **Playback controls** — Seek ±5s/±10s buttons, current time display, keyboard shortcuts (foundation for Sprint 3 tagging UX)

### What Doesn't Ship (Sprint 3+)
- Tag system (Sprint 3)
- Comments (Sprint 4)
- Inline debrief (Sprint 4)
- Timeline scrubber with tag dots (Sprint 3)

---

## Architecture Reasoning

### Why YouTube IFrame API over a simple `<iframe>`?

A raw `<iframe src="youtube.com/embed/...">` gives zero programmatic control. The YouTube IFrame API loads via a script tag and creates a `YT.Player` instance that exposes:
- `player.seekTo(seconds, true)` — Jump to a timestamp (essential for tag-based navigation in Sprint 3)
- `player.getCurrentTime()` — Capture current position (essential for timestamped tagging)
- `player.pauseVideo()` / `player.playVideo()` — Pause when adding tags, resume after
- `player.getDuration()` — Total video length (for timeline rendering in Sprint 3)
- `player.getPlayerState()` — Know if playing, paused, buffering

Without this, the entire tagging UX (Sprint 3) would be impossible. The IFrame API is the foundation that makes VOD review a *workstation* rather than a passive video embed.

### Why `vod_reviews` as a separate table instead of just adding `youtube_url` to `matches`?

The `vod_reviews` table serves as the anchor for the review session. It holds:
- The YouTube URL (which may differ from a URL auto-attached to the match by n8n)
- Inline debrief fields (Sprint 4): `peak_moment`, `key_lesson`, `themes`, `match_quality`, `notes`
- The FK target for `vod_tags` and `vod_comments` (Sprint 3-4)

The `youtube_url` column on `matches` is a *convenience shortcut* — it lets n8n or the user pre-attach a URL before a review session even starts. When the user opens VodReview, we check `vod_reviews` first, then fall back to `matches.youtube_url`. This dual-source pattern means the URL can come from either direction.

### Two-panel layout choice

Desktop-first for this feature (acknowledged in Phase 4 pivot open loops — VOD review on mobile is impractical). Left panel is the video + playback controls, taking ~65% width. Right panel is the match context stats card at ~35% width. This ratio gives the video enough real estate while keeping stats visible for reference during review.

On screens < 1024px, panels stack vertically (video on top, stats below). This preserves usability on smaller laptops but is not the primary target.

---

## SQL Migration

Run this in Supabase SQL Editor BEFORE executing the Claude Code prompt.

```sql
-- Sprint 2: VOD Review table + youtube_url on matches
-- Non-destructive: no existing tables modified beyond adding a nullable column

-- 1. Create vod_reviews table
CREATE TABLE IF NOT EXISTS vod_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  match_id TEXT NOT NULL REFERENCES matches(match_id),
  youtube_url TEXT NOT NULL,
  -- Inline debrief fields (Sprint 4 will populate these)
  peak_moment TEXT,
  key_lesson TEXT,
  themes TEXT,
  match_quality SMALLINT CHECK (match_quality BETWEEN 1 AND 5),
  notes TEXT,
  UNIQUE(match_id, user_id)
);

-- 2. Enable RLS on vod_reviews
ALTER TABLE vod_reviews ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies for vod_reviews (user can only access own reviews)
CREATE POLICY "Users can view own vod_reviews"
  ON vod_reviews FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own vod_reviews"
  ON vod_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own vod_reviews"
  ON vod_reviews FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own vod_reviews"
  ON vod_reviews FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Add youtube_url column to matches table (nullable, for n8n pre-linking)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS youtube_url TEXT;

-- 5. Index for fast lookup by match_id on vod_reviews
CREATE INDEX IF NOT EXISTS idx_vod_reviews_match_id ON vod_reviews(match_id);
CREATE INDEX IF NOT EXISTS idx_vod_reviews_user_id ON vod_reviews(user_id);
```

### Verification after running:
- `SELECT * FROM vod_reviews LIMIT 0;` should return empty table with correct columns
- `SELECT youtube_url FROM matches LIMIT 1;` should return NULL (column exists)
- RLS check: try inserting without auth — should fail

---

## Claude Code Prompt

> [!important] Copy everything below this line into Claude Code

---

**Context:** VAL Master Phase 4 Sprint 2. We're building the VOD Review workstation — YouTube embed with IFrame API control + match context sidebar. The VodReview placeholder page already exists at `src/pages/VodReview.tsx` from Sprint 1. We're replacing its content entirely.

**Repo:** `bastienr1/VAL-Master` on `main` branch.

**Stack:** React 19, Vite, TypeScript, Tailwind 4 (using `@theme` in `index.css` for design tokens), Supabase, lucide-react for icons.

**Design tokens (from `src/index.css`):**
- Colors: `val-red` (#FF4655), `val-cyan` (#53CADC), `val-yellow` (#FFCA3A), `val-green` (#3DD598), `bg-primary` (#0A0E17), `bg-secondary` (#111827), `bg-card` (#1A1F2E), `bg-elevated` (#242938), `text-primary` (#F1F5F9), `text-secondary` (#94A3B8), `text-muted` (#64748B)
- Fonts: `font-heading` (Rajdhani), `font-body` (Inter), `font-stats` (JetBrains Mono)

**Supabase context:** The `vod_reviews` table and `matches.youtube_url` column have already been created via SQL migration. Types already exist in `src/lib/types.ts` — use `VodReview` interface as-is.

**Existing file to REPLACE:**
- `src/pages/VodReview.tsx` — Currently a placeholder. Replace entirely.

**No other files need changes.** App.tsx routes are already correct (`/review/:matchId` → VodReview). Types already include `VodReview`, `VodTag`, `VodComment`. Constants already have `getMapSplash`, `getAgentIcon`.

---

### Task: Replace `src/pages/VodReview.tsx` with the full VOD Review workstation

**Delete all existing content in VodReview.tsx and replace with the following implementation.**

#### Imports

```typescript
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getMapSplash, getAgentIcon } from '../lib/constants'
import type { Match, VodReview as VodReviewType } from '../lib/types'
import {
  ArrowLeft, Crosshair, Target, Swords, Percent, Play, Pause,
  SkipBack, SkipForward, Link as LinkIcon, Check, Clock, Film
} from 'lucide-react'
```

#### YouTube IFrame API Type Declarations

Add this at the top of the file (after imports) to satisfy TypeScript:

```typescript
// YouTube IFrame API types
declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string,
        config: {
          videoId: string
          playerVars?: Record<string, unknown>
          events?: {
            onReady?: (event: { target: YTPlayer }) => void
            onStateChange?: (event: { data: number; target: YTPlayer }) => void
          }
        }
      ) => YTPlayer
      PlayerState: {
        PLAYING: number
        PAUSED: number
        BUFFERING: number
        ENDED: number
        CUED: number
      }
    }
    onYouTubeIframeAPIReady: (() => void) | undefined
  }
}

interface YTPlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  pauseVideo: () => void
  playVideo: () => void
  destroy: () => void
}
```

#### State

```typescript
const { matchId } = useParams<{ matchId: string }>()
const [match, setMatch] = useState<Match | null>(null)
const [vodReview, setVodReview] = useState<VodReviewType | null>(null)
const [loading, setLoading] = useState(true)
const [notFound, setNotFound] = useState(false)

// YouTube state
const playerRef = useRef<YTPlayer | null>(null)
const [youtubeUrl, setYoutubeUrl] = useState('')
const [videoId, setVideoId] = useState<string | null>(null)
const [playerReady, setPlayerReady] = useState(false)
const [isPlaying, setIsPlaying] = useState(false)
const [currentTime, setCurrentTime] = useState(0)
const [duration, setDuration] = useState(0)
const [urlSaved, setUrlSaved] = useState(false)
const [saving, setSaving] = useState(false)
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
```

#### Helper: Extract YouTube Video ID

```typescript
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}
```

#### Helper: Format timestamp

```typescript
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
```

#### Data Loading (useEffect on mount)

Load match data + check for existing vod_review OR matches.youtube_url:

```typescript
useEffect(() => {
  async function loadData() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Load match
      const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('match_id', matchId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (matchError) throw matchError
      if (!matchData) { setNotFound(true); return }
      setMatch(matchData)

      // Check for existing vod_review
      const { data: reviewData } = await supabase
        .from('vod_reviews')
        .select('*')
        .eq('match_id', matchId!)
        .eq('user_id', user.id)
        .maybeSingle()

      if (reviewData) {
        setVodReview(reviewData)
        setYoutubeUrl(reviewData.youtube_url)
        const vid = extractYouTubeId(reviewData.youtube_url)
        if (vid) setVideoId(vid)
      } else if (matchData.youtube_url) {
        // Fallback: URL pre-linked on the match itself
        setYoutubeUrl(matchData.youtube_url)
        const vid = extractYouTubeId(matchData.youtube_url)
        if (vid) setVideoId(vid)
      }
    } catch (err) {
      console.error('Failed to load match:', err)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }
  loadData()
}, [matchId])
```

#### YouTube IFrame API Loader (useEffect when videoId changes)

```typescript
useEffect(() => {
  if (!videoId) return

  // Reset player state when videoId changes
  setPlayerReady(false)
  setIsPlaying(false)
  setCurrentTime(0)
  setDuration(0)

  const initPlayer = () => {
    // Destroy existing player if any
    if (playerRef.current) {
      try { playerRef.current.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }

    playerRef.current = new window.YT.Player('yt-player', {
      videoId,
      playerVars: {
        autoplay: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
      },
      events: {
        onReady: (event) => {
          setPlayerReady(true)
          setDuration(event.target.getDuration())
        },
        onStateChange: (event) => {
          const playing = event.data === window.YT.PlayerState.PLAYING
          setIsPlaying(playing)
        },
      },
    })
  }

  // Load YT API script if not already loaded
  if (window.YT && window.YT.Player) {
    initPlayer()
  } else {
    window.onYouTubeIframeAPIReady = initPlayer
    if (!document.getElementById('yt-api-script')) {
      const tag = document.createElement('script')
      tag.id = 'yt-api-script'
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
  }

  return () => {
    if (playerRef.current) {
      try { playerRef.current.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
  }
}, [videoId])
```

#### Time Tracking Interval (updates currentTime while playing)

```typescript
useEffect(() => {
  if (isPlaying && playerRef.current) {
    timerRef.current = setInterval(() => {
      if (playerRef.current) {
        setCurrentTime(playerRef.current.getCurrentTime())
      }
    }, 250)
  } else {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }
  return () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }
}, [isPlaying])
```

#### Playback Control Handlers

```typescript
const togglePlay = useCallback(() => {
  if (!playerRef.current || !playerReady) return
  if (isPlaying) {
    playerRef.current.pauseVideo()
  } else {
    playerRef.current.playVideo()
  }
}, [isPlaying, playerReady])

const seek = useCallback((offsetSeconds: number) => {
  if (!playerRef.current || !playerReady) return
  const newTime = Math.max(0, Math.min(playerRef.current.getCurrentTime() + offsetSeconds, duration))
  playerRef.current.seekTo(newTime, true)
  setCurrentTime(newTime)
}, [playerReady, duration])
```

#### Keyboard Shortcuts (useEffect)

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't capture when typing in input fields
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    switch (e.key) {
      case ' ':
        e.preventDefault()
        togglePlay()
        break
      case 'ArrowLeft':
        e.preventDefault()
        seek(e.shiftKey ? -10 : -5)
        break
      case 'ArrowRight':
        e.preventDefault()
        seek(e.shiftKey ? 10 : 5)
        break
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [togglePlay, seek])
```

#### Save YouTube URL Handler

When the user pastes a URL and clicks "Link Video":

```typescript
const handleSaveUrl = async () => {
  const vid = extractYouTubeId(youtubeUrl)
  if (!vid) return // TODO: show validation error

  setSaving(true)
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Upsert vod_review record
    const { data, error } = await supabase
      .from('vod_reviews')
      .upsert({
        user_id: user.id,
        match_id: matchId!,
        youtube_url: youtubeUrl,
      }, { onConflict: 'match_id,user_id' })
      .select()
      .maybeSingle()

    if (error) throw error
    if (data) setVodReview(data)

    // Also update matches.youtube_url for convenience
    await supabase
      .from('matches')
      .update({ youtube_url: youtubeUrl })
      .eq('match_id', matchId!)
      .eq('user_id', user.id)

    setVideoId(vid)
    setUrlSaved(true)
    setTimeout(() => setUrlSaved(false), 2000)
  } catch (err) {
    console.error('Failed to save URL:', err)
  } finally {
    setSaving(false)
  }
}
```

#### JSX Layout

The full render. Use this structure exactly:

```tsx
// Loading state
if (loading) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Not found state
if (notFound || !match) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2 className="text-xl font-heading font-bold mb-4">Match not found</h2>
      <Link to="/" className="flex items-center gap-1 text-text-secondary hover:text-val-cyan transition-colors text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Matches
      </Link>
    </div>
  )
}

const resultColor = match.result === 'W' ? 'val-green' : match.result === 'L' ? 'val-red' : 'val-yellow'
const resultLabel = match.result === 'W' ? 'VICTORY' : match.result === 'L' ? 'DEFEAT' : 'DRAW'
const date = new Date(match.match_date)
const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

return (
  <div className="space-y-4">
    {/* Back link */}
    <Link to="/" className="inline-flex items-center gap-1 text-text-secondary hover:text-val-cyan transition-colors text-sm">
      <ArrowLeft className="w-4 h-4" />
      Back to Matches
    </Link>

    {/* Two-panel layout */}
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">

      {/* === LEFT PANEL: Video + Controls === */}
      <div className="space-y-3">

        {/* YouTube Player OR URL Input */}
        {videoId ? (
          <div className="space-y-2">
            {/* Video embed container — 16:9 aspect ratio */}
            <div className="relative w-full bg-black rounded-xl overflow-hidden" style={{ paddingBottom: '56.25%' }}>
              <div id="yt-player" className="absolute inset-0 w-full h-full" />
            </div>

            {/* Playback controls bar */}
            <div className="bg-bg-card border border-bg-elevated rounded-lg px-4 py-2 flex items-center gap-3">
              {/* Seek backward */}
              <button
                onClick={() => seek(-5)}
                className="text-text-muted hover:text-val-cyan transition-colors"
                title="Back 5s (←)"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="w-9 h-9 rounded-full bg-val-cyan/10 border border-val-cyan/20 flex items-center justify-center text-val-cyan hover:bg-val-cyan/20 transition-colors"
                title="Play/Pause (Space)"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>

              {/* Seek forward */}
              <button
                onClick={() => seek(5)}
                className="text-text-muted hover:text-val-cyan transition-colors"
                title="Forward 5s (→)"
              >
                <SkipForward className="w-4 h-4" />
              </button>

              {/* Time display */}
              <div className="flex items-center gap-1.5 ml-2">
                <Clock className="w-3.5 h-3.5 text-text-muted" />
                <span className="font-stats text-sm text-text-secondary">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Keyboard shortcut hints */}
              <div className="ml-auto text-[10px] text-text-muted hidden md:flex items-center gap-3">
                <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">Space</kbd> play/pause</span>
                <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">←→</kbd> ±5s</span>
                <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">Shift+←→</kbd> ±10s</span>
              </div>
            </div>
          </div>
        ) : (
          /* No video linked — show URL input */
          <div className="bg-bg-card border border-bg-elevated rounded-xl p-8 flex flex-col items-center text-center">
            <Film className="w-12 h-12 text-text-muted mb-3" />
            <h2 className="text-lg font-heading font-bold mb-1">Link Your VOD</h2>
            <p className="text-text-secondary text-sm mb-4 max-w-sm">
              Paste a YouTube URL to start reviewing this match. Record with Insights Capture, upload to YouTube, then link it here.
            </p>
            <div className="flex items-center gap-2 w-full max-w-lg">
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/40"
              />
              <button
                onClick={handleSaveUrl}
                disabled={!youtubeUrl || saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg text-sm font-medium hover:bg-val-cyan/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
                ) : urlSaved ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <LinkIcon className="w-4 h-4" />
                )}
                {urlSaved ? 'Linked!' : 'Link Video'}
              </button>
            </div>
          </div>
        )}

        {/* URL editor — shown when video is already linked, allows changing URL */}
        {videoId && (
          <div className="flex items-center gap-2">
            <LinkIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              className="flex-1 bg-transparent text-xs text-text-muted truncate focus:outline-none focus:text-text-secondary"
              title="YouTube URL — edit and press Update to change"
            />
            {extractYouTubeId(youtubeUrl) !== videoId && (
              <button
                onClick={handleSaveUrl}
                disabled={saving}
                className="text-xs text-val-cyan hover:text-val-cyan/80 font-medium shrink-0"
              >
                {saving ? 'Saving...' : 'Update'}
              </button>
            )}
          </div>
        )}

        {/* Sprint 3 preview — tagging placeholder */}
        {videoId && playerReady && (
          <div className="bg-bg-card border border-dashed border-bg-elevated rounded-lg px-4 py-3 text-center">
            <p className="text-text-muted text-xs">
              🏷️ Timestamped tagging — Sprint 3. Press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> to tag moments while watching.
            </p>
          </div>
        )}
      </div>

      {/* === RIGHT PANEL: Match Context === */}
      <div className="space-y-3">

        {/* Match context card */}
        <div className="bg-bg-card border border-bg-elevated rounded-xl overflow-hidden">
          {/* Map splash header */}
          <div className="relative h-28">
            <img
              src={getMapSplash(match.map)}
              alt={match.map}
              className="absolute inset-0 w-full h-full object-cover opacity-30"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

            {/* Agent + Map */}
            <div className="absolute bottom-2 left-3 flex items-center gap-2">
              <img
                src={getAgentIcon(match.agent)}
                alt={match.agent}
                className="w-10 h-10 rounded-full border-2 border-bg-card"
              />
              <div>
                <h2 className="text-sm font-heading font-bold leading-tight">{match.agent} on {match.map}</h2>
                <p className="text-[10px] text-text-muted">{dateStr} · {timeStr}</p>
              </div>
            </div>

            {/* Score + Result */}
            <div className="absolute bottom-2 right-3 text-right">
              <div className={`text-xl font-stats font-bold text-${resultColor}`}>{match.score}</div>
              <div className={`text-[10px] font-bold text-${resultColor}`}>{resultLabel}</div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="px-3 py-3 border-t border-bg-elevated grid grid-cols-2 gap-y-2 gap-x-4">
            <StatRow icon={Target} label="ACS" value={match.acs} />
            <StatRow icon={Crosshair} label="K/D" value={match.kd} />
            <StatRow icon={Swords} label="KDA" value={`${match.kills}/${match.deaths}/${match.assists}`} />
            <StatRow icon={Percent} label="HS%" value={`${match.headshot_pct}%`} />
            <StatRow icon={Crosshair} label="KPR" value={match.kpr} />
            <StatRow icon={Target} label="DPR" value={match.dpr} />
          </div>
        </div>

        {/* Sprint 4 preview — inline debrief placeholder */}
        <div className="bg-bg-card border border-dashed border-bg-elevated rounded-lg px-4 py-6 text-center">
          <p className="text-text-muted text-xs">
            📝 Inline debrief — Sprint 4. Peak moment, key lesson, themes, quality rating.
          </p>
        </div>
      </div>
    </div>
  </div>
)
```

#### StatRow Sub-component

Add this inside the file (before the default export, or as a named function at the top):

```typescript
function StatRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3 h-3 text-text-muted" />
      <span className="text-[10px] text-text-muted uppercase w-8">{label}</span>
      <span className="text-xs font-stats font-medium text-text-primary">{value}</span>
    </div>
  )
}
```

---

### Commit message:
```
Phase 4 Sprint 2: VOD Review workstation with YouTube IFrame API

- Replace VodReview placeholder with full workstation layout
- YouTube IFrame API: programmatic play/pause, seekTo, getCurrentTime, getDuration
- Two-panel layout: video+controls (left) + match context (right)
- YouTube URL input with vod_reviews table upsert
- Dual-source URL: checks vod_reviews first, falls back to matches.youtube_url
- Playback controls: ±5s/±10s seek, play/pause, time display
- Keyboard shortcuts: Space (play/pause), ←→ (±5s), Shift+←→ (±10s)
- URL editor inline when video already linked
- Sprint 3/4 placeholder cards for tags and inline debrief
- Responsive: stacks vertically on screens < 1024px
```

---

## Verification After Running

After Claude Code executes this, verify:

1. **Build passes:** `npm run build` — zero TypeScript errors
2. **Navigate:** Click a match card from Match Library → VodReview page loads
3. **No video linked state:** Shows "Link Your VOD" card with URL input
4. **Paste URL:** Paste a YouTube URL → click "Link Video" → video appears
5. **Supabase check:** `SELECT * FROM vod_reviews;` shows a row with the correct match_id and youtube_url
6. **Playback controls:** Space toggles play/pause, ←→ seeks ±5s, Shift+←→ seeks ±10s
7. **Time display:** Shows current time / total duration, updates while playing
8. **Match context:** Right panel shows agent, map, score, result, all stats
9. **URL update:** Edit the URL in the inline editor → click "Update" → video changes
10. **Responsive:** Resize to < 1024px width → panels stack vertically
11. **Revisit:** Leave the page, come back → video auto-loads from saved vod_review

### Known Edge Cases to Watch:
- If Supabase RLS on `vod_reviews` blocks inserts, check that the policies were applied correctly in the SQL migration
- The `onConflict: 'match_id,user_id'` in the upsert must match the UNIQUE constraint on the table — verify column names match exactly
- YouTube IFrame API script loads asynchronously — the player div must exist in DOM before `new YT.Player()` fires. The `useEffect` chain handles this, but verify there's no race condition on slow connections

---

## Connections

- [[2026-03-30-VAL-Master-Phase4-PostMatch-Pivot]] — Parent spec for all Phase 4 sprints
- [[2026-04-01-VAL-Master-Phase4-Sprint1-MatchLibrary]] — Sprint 1 that this builds on
- [[2026-03-28-VAL-Master-Sprint3-Debrief-Upsert-Dashboard-Stats]] — Upsert pattern reused from Sprint 3
- [[Valorant-Performance-Hub-Project-Status]] — Update status after completion

## Action Items

- [ ] Run SQL migration in Supabase SQL Editor (see migration section above)
- [ ] Execute this Claude Code prompt in a Claude Code session
- [ ] Verify build passes and all 11 verification checks pass
- [ ] Update Phase 4 pivot doc: mark Sprint 2 checklist items as complete

> [!question]- Open Loops
> - YouTube IFrame API sometimes has CSP issues on certain hosting setups — test on Vercel deploy, not just localhost
> - Should the video auto-play when the page loads? Currently set to `autoplay: 0`. Could add a user preference toggle later.
> - The time tracking interval runs at 250ms (4 updates/sec). This is smooth enough for display but might need adjustment for Sprint 3 tag accuracy — a tag placed "at current time" could be up to 250ms off. Acceptable for V1.
> - Consider adding video playback speed controls (0.5x, 0.75x, 1x, 1.25x) — useful for detailed VOD analysis. Defer to Sprint 6 polish.
> - The `matches.youtube_url` dual-write means two sources of truth. Convention: `vod_reviews.youtube_url` is authoritative; `matches.youtube_url` is a convenience mirror. Document this for future n8n integration work.
