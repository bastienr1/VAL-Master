---
title: "VAL Master Phase 4 Sprint 3 — Timestamped Tag System + Match Data Sync"
date: 2026-04-03
created: 2026-04-03T23:30
type: project-doc
status: processed
tags:
  - val-master
  - phase-4
  - sprint-3
  - vod-tags
  - timestamped-tagging
  - match-data-sync
  - auto-tagging
  - claude-code-prompt
aliases:
  - sprint 3 tags
  - phase 4 sprint 3
  - vod tagging
  - match sync
source: "Claude conversation"
project: "[[Valorant Performance Hub]]"
related:
  - "[[2026-03-30-VAL-Master-Phase4-PostMatch-Pivot]]"
  - "[[2026-04-03-VAL-Master-Phase4-Sprint2-VodReview]]"
  - "[[2026-04-01-VAL-Master-Phase4-Sprint1-MatchLibrary]]"
  - "[[Valorant-Performance-Hub-Project-Status]]"
cssclasses:
  - obsidian-ready
action-items: 5
version: "4.3"
---

# VAL Master Phase 4 Sprint 3 — Timestamped Tag System + Match Data Sync

> [!abstract] Essence
> Two systems converge: **manual tagging** (press T to tag what you see) and **auto-tagging from API data** (round markers, kills, deaths, multi-kills, side switches — all placed on the video timeline via a single calibration click). The user sets a "barriers drop" sync point once, and the entire match structure materializes on the timeline. This is the feature that transforms VOD review from "watching a video" into "analyzing a match."

---

## Sprint 3 Scope — Two Halves, One Timeline

### Half A: Manual Tagging (user-driven)
The user tags moments while watching. Press `T` or click a tag type pill → auto-pause → capture timestamp → type a label → save. Tags appear as colored dots on the timeline and in a scrollable list. Click to seek.

### Half B: Match Data Sync (API-driven)
The Henrik API v3 returns per-round data that we're currently ignoring: `rounds[]` with `winning_team`, `end_type`, per-player kills/deaths/economy, and `kill_events[]` with `kill_time_in_round` (ms). By storing this data and syncing it to the video via a single calibration point, we auto-generate structural tags: round markers, attack/defense halves, your kills, your deaths, multi-kills, first bloods, and aces.

**The single calibration point:** The user clicks "Sync: Barriers Drop" while watching the VOD at the exact moment round 1 barriers lift. This stores a `barrier_drop_offset` (seconds into the video). From there, every round and event gets a computed video timestamp.

### What Ships
1. **SQL migrations** — Create `vod_tags` table, create `match_rounds` table, add `barrier_drop_offset` to `vod_reviews`
2. **Round data fetcher** — Client-side function that calls Henrik API v3 `/match/{matchid}` to get round-level detail for a specific match, then stores it in `match_rounds`
3. **Calibration UX** — "Sync Match" button that captures the current video timestamp as `barrier_drop_offset`, saves to `vod_reviews`
4. **Auto-tag generator** — Computes video timestamps for all round events using barrier offset + cumulative round durations, creates auto-tags
5. **Manual tag input bar** — Quick-tag pill buttons, label input, keyboard shortcut `T`
6. **Visual timeline scrubber** — Colored dots for both manual tags and auto-tags, with half-switch markers (attack→defense)
7. **Tag list** — Scrollable list below timeline: all tags (manual + auto) sorted by timestamp, with type badge, label, and click-to-seek
8. **Supabase CRUD** — Insert, fetch, delete tags; upsert round data; update barrier offset

### What Doesn't Ship (Sprint 4+)
- Comments / free-text notes (Sprint 4)
- Inline debrief (Sprint 4)
- Tag analytics / frequency charts (Sprint 5)

---

## Architecture: The Sync Model

### The Calibration Math

Valorant match structure:
- Agent select → buy phase (~30s) → barriers drop → round plays out → post-round → buy phase → repeat
- The Insights Capture VOD records from lobby/agent select through the end of the match
- The Henrik API gives us `game_length` (total match duration in ms) and per-round `kill_time_in_round` (ms from round start)

**Single anchor point:** `barrier_drop_offset` = the video timestamp (in seconds) when round 1 barriers lift.

**Round timestamp estimation:**
```
round_N_start_video = barrier_drop_offset + Σ(estimated_duration[round 1..N-1])
```

For V1, we use a fixed estimate of **~110 seconds per round** (30s buy + ~80s average round play). This is crude but puts us within ±15 seconds per round — close enough that the user can visually orient. Future refinement (Sprint 6) could use actual round durations from the API if Riot exposes them, or the user could manually adjust individual round markers.

**Kill event timestamps within a round:**
```
kill_video_timestamp = round_N_start_video + (kill_time_in_round_ms / 1000)
```

The `kill_time_in_round` from the API is precise — it's the exact millisecond offset from round start. So once we have the round start anchored, kill placement is accurate.

### Why `match_rounds` as a separate table?

The round-level data from the API is too granular for the `matches` table (which stores match-level aggregates). Storing per-round stats enables:
- Auto-tag generation without re-fetching the API
- Round-by-round performance breakdown in Sprint 5 Analytics
- Attack vs defense splits
- Economy tracking per round
- First blood / first death detection

### Data Flow

```
User opens VodReview for a match
  ↓
Check: does match_rounds data exist for this match?
  → YES: skip API call, use stored data
  → NO: fetch from Henrik API v3 /match/{matchid}
        → parse rounds array
        → store in match_rounds (one row per round)
  ↓
Check: does vod_review have barrier_drop_offset?
  → YES: auto-tags are available, render on timeline
  → NO: show "Sync Match" button in playback controls
  ↓
User clicks "Sync: Barriers Drop" at the right moment
  → saves current video timestamp as barrier_drop_offset
  → triggers auto-tag generation
  → round markers + kills + deaths + structural tags appear on timeline
```

---

## SQL Migrations

Run ALL of these in Supabase SQL Editor BEFORE executing the Claude Code prompt.

```sql
-- Sprint 3 Migration: vod_tags + match_rounds + barrier_drop_offset

-- ============================================
-- 1. Create vod_tags table (manual + auto tags)
-- ============================================
CREATE TABLE IF NOT EXISTS vod_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  vod_review_id UUID NOT NULL REFERENCES vod_reviews(id) ON DELETE CASCADE,
  timestamp_seconds INTEGER NOT NULL,
  round_number SMALLINT,
  tag_type TEXT NOT NULL,
  label TEXT NOT NULL,
  side TEXT CHECK (side IN ('attack', 'defense')),
  is_auto BOOLEAN DEFAULT false  -- distinguishes manual tags from auto-generated
);

ALTER TABLE vod_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vod_tags"
  ON vod_tags FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vod_tags"
  ON vod_tags FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own vod_tags"
  ON vod_tags FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own vod_tags"
  ON vod_tags FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_vod_tags_vod_review_id ON vod_tags(vod_review_id);
CREATE INDEX IF NOT EXISTS idx_vod_tags_user_id ON vod_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_vod_tags_timestamp ON vod_tags(timestamp_seconds);

-- ============================================
-- 2. Create match_rounds table (API round data)
-- ============================================
CREATE TABLE IF NOT EXISTS match_rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  match_id TEXT NOT NULL REFERENCES matches(match_id),
  round_number SMALLINT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('attack', 'defense')),
  round_won BOOLEAN NOT NULL,
  end_type TEXT,             -- 'Eliminated', 'Bomb defused', 'Bomb detonated', 'Round timer expired'
  kills SMALLINT DEFAULT 0,
  deaths SMALLINT DEFAULT 0,
  assists SMALLINT DEFAULT 0,
  damage_dealt INTEGER DEFAULT 0,
  damage_received INTEGER DEFAULT 0,
  loadout_value INTEGER DEFAULT 0,
  spent INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  -- Stored kill events as JSONB for flexible querying
  -- Format: [{ "kill_time_ms": 42000, "victim": "agent_name", "weapon": "Vandal" }, ...]
  kill_events JSONB DEFAULT '[]'::jsonb,
  -- Stored death events
  -- Format: [{ "kill_time_ms": 18000, "killer": "agent_name", "weapon": "Operator" }]
  death_events JSONB DEFAULT '[]'::jsonb,
  UNIQUE(match_id, user_id, round_number)
);

ALTER TABLE match_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own match_rounds"
  ON match_rounds FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own match_rounds"
  ON match_rounds FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own match_rounds"
  ON match_rounds FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own match_rounds"
  ON match_rounds FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_match_rounds_match_id ON match_rounds(match_id);
CREATE INDEX IF NOT EXISTS idx_match_rounds_user_id ON match_rounds(user_id);

-- ============================================
-- 3. Add barrier_drop_offset to vod_reviews
-- ============================================
ALTER TABLE vod_reviews ADD COLUMN IF NOT EXISTS barrier_drop_offset INTEGER;
-- Nullable: null means not yet calibrated
```

### Verification:
- `SELECT * FROM vod_tags LIMIT 0;` — columns include `is_auto`
- `SELECT * FROM match_rounds LIMIT 0;` — correct schema with kill_events JSONB
- `SELECT barrier_drop_offset FROM vod_reviews LIMIT 1;` — column exists, returns NULL

---

## Tag Type Taxonomy

| tag_type | Tailwind Color | Hex | Description | Auto? |
|----------|---------------|-----|-------------|-------|
| `strength` | `val-green` | #3DD598 | Peak performance moment | Manual + Auto (multi-kills, aces) |
| `mistake` | `val-red` | #FF4655 | Fixable error | Manual + Auto (first death) |
| `read` | `val-cyan` | #53CADC | Tactical read | Manual only |
| `clutch` | `val-yellow` | #FFCA3A | High-pressure play | Manual + Auto (clutch rounds) |
| `comms` | `text-secondary` | #94A3B8 | Communication moment | Manual only |
| `positioning` | custom `#6EE7B7` | — | Angle/rotation | Manual only |
| `utility` | custom `#F97316` | — | Ability usage | Manual only |
| `economy` | `text-muted` | #64748B | Buy decision | Auto (eco round kills) |
| `aim` | `val-cyan` | #53CADC | Mechanical moment | Manual only |
| `round` | `text-muted` | #64748B | Round marker (structural) | Auto only |
| `kill` | `val-green` | #3DD598 | Your kill event | Auto only |
| `death` | `val-red` | #FF4655 | Your death event | Auto only |
| `half` | `text-secondary` | #94A3B8 | Attack/Defense switch | Auto only |

The `round`, `kill`, `death`, and `half` tag types are auto-only structural markers — they don't appear in the manual tag pills.

---

## Auto-Tag Generation Logic

When `barrier_drop_offset` is set and `match_rounds` data exists, generate these auto-tags:

```typescript
const AVG_ROUND_DURATION = 110 // seconds (30s buy + ~80s play)

function generateAutoTags(
  rounds: MatchRound[],
  barrierOffset: number,
  playerTeam: string  // 'Red' or 'Blue' from the match data
): Omit<VodTag, 'id' | 'created_at' | 'user_id' | 'vod_review_id'>[] {
  const tags: AutoTag[] = []

  // Determine starting side
  // In Valorant: team that starts on the left in agent select is "attack" first
  // The API tells us which team the player is on (Red/Blue)
  // Red team = defenders first half (rounds 1-12), attackers second half
  // Blue team = attackers first half, defenders second half
  const firstHalfSide = playerTeam === 'Blue' ? 'attack' : 'defense'
  const secondHalfSide = playerTeam === 'Blue' ? 'defense' : 'attack'

  rounds.forEach((round, i) => {
    const roundStartVideo = barrierOffset + (i * AVG_ROUND_DURATION)
    const roundNum = round.round_number
    const side = roundNum <= 12 ? firstHalfSide : secondHalfSide

    // Round marker
    tags.push({
      timestamp_seconds: Math.round(roundStartVideo),
      round_number: roundNum,
      tag_type: 'round',
      label: `R${roundNum} ${side === 'attack' ? 'ATK' : 'DEF'} — ${round.round_won ? 'Won' : 'Lost'} (${round.end_type || ''})`,
      side,
      is_auto: true,
    })

    // Half-switch marker at round 13
    if (roundNum === 13) {
      tags.push({
        timestamp_seconds: Math.round(roundStartVideo - 15), // slightly before round 13 starts
        round_number: 13,
        tag_type: 'half',
        label: `Side switch → ${secondHalfSide === 'attack' ? 'ATTACK' : 'DEFENSE'}`,
        side: secondHalfSide,
        is_auto: true,
      })
    }

    // Kill events — each kill placed at precise offset within the round
    const killEvents = round.kill_events || []
    killEvents.forEach((kill: any) => {
      const killVideoTime = roundStartVideo + (kill.kill_time_ms / 1000)
      tags.push({
        timestamp_seconds: Math.round(killVideoTime),
        round_number: roundNum,
        tag_type: 'kill',
        label: `Killed ${kill.victim}${kill.weapon ? ` (${kill.weapon})` : ''}`,
        side,
        is_auto: true,
      })
    })

    // Death events
    const deathEvents = round.death_events || []
    deathEvents.forEach((death: any) => {
      const deathVideoTime = roundStartVideo + (death.kill_time_ms / 1000)
      tags.push({
        timestamp_seconds: Math.round(deathVideoTime),
        round_number: roundNum,
        tag_type: 'death',
        label: `Died to ${death.killer}${death.weapon ? ` (${death.weapon})` : ''}`,
        side,
        is_auto: true,
      })
    })

    // Multi-kill detection
    if (round.kills >= 3) {
      const multiLabel = round.kills === 5 ? 'ACE' :
                         round.kills === 4 ? '4K' : '3K'
      tags.push({
        timestamp_seconds: Math.round(roundStartVideo + 10), // shortly after round starts
        round_number: roundNum,
        tag_type: 'strength',
        label: `🔥 ${multiLabel} — R${roundNum}`,
        side,
        is_auto: true,
      })
    }

    // First blood detection (you got the first kill in the round)
    if (killEvents.length > 0) {
      const firstKillInRound = killEvents[0]
      // Only tag as first blood if kill_time_ms is very early (first ~15s of round)
      if (firstKillInRound.kill_time_ms <= 15000) {
        tags.push({
          timestamp_seconds: Math.round(roundStartVideo + (firstKillInRound.kill_time_ms / 1000)),
          round_number: roundNum,
          tag_type: 'strength',
          label: `First Blood on ${firstKillInRound.victim}`,
          side,
          is_auto: true,
        })
      }
    }

    // First death detection (you died first in the round)
    if (deathEvents.length > 0) {
      const firstDeath = deathEvents[0]
      if (firstDeath.kill_time_ms <= 15000) {
        tags.push({
          timestamp_seconds: Math.round(roundStartVideo + (firstDeath.kill_time_ms / 1000)),
          round_number: roundNum,
          tag_type: 'mistake',
          label: `First Death — killed by ${firstDeath.killer}`,
          side,
          is_auto: true,
        })
      }
    }
  })

  return tags
}
```

### Side determination note:
In standard Valorant competitive, **Blue team attacks first** (rounds 1-12) and **Red team defends first**. This is consistent across all maps. The Henrik API returns the player's `team` as "Red" or "Blue" — we use that to determine starting side.

---

## New TypeScript Interfaces (add to types.ts)

```typescript
export interface MatchRound {
  id: string
  created_at: string
  user_id: string
  match_id: string
  round_number: number
  side: 'attack' | 'defense'
  round_won: boolean
  end_type: string | null
  kills: number
  deaths: number
  assists: number
  damage_dealt: number
  damage_received: number
  loadout_value: number
  spent: number
  score: number
  kill_events: Array<{ kill_time_ms: number; victim: string; weapon: string }>
  death_events: Array<{ kill_time_ms: number; killer: string; weapon: string }>
}
```

Also update the `VodReview` interface to include `barrier_drop_offset`:
```typescript
export interface VodReview {
  // ... existing fields ...
  barrier_drop_offset: number | null  // ADD THIS
}
```

---

## Henrik API Match Detail Endpoint

To get round-level data for a specific match, we use a **different endpoint** than the matchlist:

```
GET https://api.henrikdev.xyz/valorant/v2/match/{matchid}
```

This returns the full match detail with the `rounds[]` array. The v3 matchlist already includes round data, but calling the dedicated match endpoint is more reliable and returns the complete structure.

**Important:** The API key is stored as `VITE_HENRIK_API_KEY` in Vercel env vars. For client-side calls, access it via `import.meta.env.VITE_HENRIK_API_KEY`.

**PUUID for filtering your player data:** `Ktw12yrP_o4qg3MuvgfH88E68XCbdAZ7b1DmtLm1di65-JdjCSMy8Dwrzg6O5tvV8EO0Ja_OgGs9GA`

Store this as a constant or derive it from the Supabase user's match data (the `matches` table was populated by n8n which already filters for this PUUID).

---

## Claude Code Prompt

> [!important] Copy everything below this line into Claude Code

---

**Context:** VAL Master Phase 4 Sprint 3. Adding the timestamped tagging system AND match data sync to the VOD Review workstation. This sprint has two halves: (A) manual tagging UX, and (B) API round data fetch + calibration sync + auto-tag generation.

**Repo:** `bastienr1/VAL-Master` on `main` branch.

**Stack:** React 19, Vite, TypeScript, Tailwind 4 (using `@theme` in `index.css` for design tokens), Supabase, lucide-react for icons.

**Design tokens (from `src/index.css`):**
- Colors: `val-red` (#FF4655), `val-cyan` (#53CADC), `val-yellow` (#FFCA3A), `val-green` (#3DD598), `bg-primary` (#0A0E17), `bg-secondary` (#111827), `bg-card` (#1A1F2E), `bg-elevated` (#242938), `text-primary` (#F1F5F9), `text-secondary` (#94A3B8), `text-muted` (#64748B)
- Fonts: `font-heading` (Rajdhani), `font-body` (Inter), `font-stats` (JetBrains Mono)

**Supabase context:** Three migrations have been run:
1. `vod_tags` table with `is_auto` boolean column + RLS
2. `match_rounds` table with `kill_events`/`death_events` JSONB columns + RLS + UNIQUE(match_id, user_id, round_number)
3. `vod_reviews.barrier_drop_offset` INTEGER nullable column added

**Henrik API context:**
- Match detail endpoint: `GET https://api.henrikdev.xyz/valorant/v2/match/{matchid}` with API key as `Authorization` header
- API key available via: `import.meta.env.VITE_HENRIK_API_KEY`
- Player PUUID: `Ktw12yrP_o4qg3MuvgfH88E68XCbdAZ7b1DmtLm1di65-JdjCSMy8Dwrzg6O5tvV8EO0Ja_OgGs9GA`
- The v2/match endpoint returns `data.rounds[]` array where each round has:
  - `winning_team`: "Red" or "Blue"
  - `end_type`: "Eliminated", "Bomb defused", "Bomb detonated", or "Round timer expired"
  - `player_stats[]`: per-player array with `player_puuid`, `kills`, `score`, `damage`, `economy { loadout_value, spent }`, `kill_events[]` with `killer_puuid`, `victim_puuid`, `kill_time_in_round` (ms), `damage_weapon_id`, `damage_type`
- Player's team ("Red" or "Blue") is in `data.players.all_players[]` where `puuid` matches

**Valorant side rules:**
- Blue team = attackers for rounds 1-12, defenders for rounds 13+
- Red team = defenders for rounds 1-12, attackers for rounds 13+
- Overtime alternates every 2 rounds starting from the side at round 25

**Files to MODIFY:**
- `src/pages/VodReview.tsx` — Add tagging + calibration + auto-tags. Use `str_replace` surgical edits. **Read the file first.**
- `src/lib/types.ts` — Add `MatchRound` interface, update `VodReview` interface with `barrier_drop_offset`

**Files to CREATE:**
- `src/lib/matchSync.ts` — Round data fetcher + parser + auto-tag generator (new file)

---

### Task 0 (Hotfix): Fix player lookup in `src/lib/matchSync.ts`

Read `src/lib/matchSync.ts`. The current code has a bug where the hardcoded `PLAYER_PUUID` doesn't match what the Henrik API returns, causing "Player not found in match data" errors. Apply these fixes:

1. After the existing `PLAYER_PUUID` constant, add:
```typescript
const PLAYER_NAME = 'Jobast'
const PLAYER_TAG = '9537'
```

2. Replace the single-line player find:
```typescript
    const ourPlayer = allPlayers.find((p: any) => p.puuid === PLAYER_PUUID)
    if (!ourPlayer) {
      console.error('Player not found in match data')
      return null
    }
```
With this multi-strategy fallback:
```typescript
    let ourPlayer = allPlayers.find((p: any) => p.puuid === PLAYER_PUUID)
    if (!ourPlayer) {
      // Fallback: match by Riot ID name#tag
      ourPlayer = allPlayers.find((p: any) =>
        p.name?.toLowerCase() === PLAYER_NAME.toLowerCase() && p.tag === PLAYER_TAG
      )
    }
    if (!ourPlayer) {
      console.error('Player not found. Available players:',
        allPlayers.map((p: any) => `${p.name}#${p.tag} (${p.puuid?.substring(0, 20)}...)`)
      )
      return null
    }
```

3. Create a helper function at the top of the file (after the constants) to reuse for per-round `player_stats` matching:
```typescript
function isOurPlayer(puuid: string): boolean {
  return puuid === PLAYER_PUUID
}
```
Then also use `ourPlayer.puuid` (the resolved PUUID from step 2) for all subsequent per-round lookups. Replace:
```typescript
      const ourStats = round.player_stats?.find((ps: any) => ps.player_puuid === PLAYER_PUUID)
```
With:
```typescript
      const ourStats = round.player_stats?.find((ps: any) => ps.player_puuid === ourPlayer.puuid)
```
And similarly replace all other `=== PLAYER_PUUID` comparisons inside the round parser with `=== ourPlayer.puuid` (there are ~3 occurrences: `ourStats` find, `kill_events` filter for `killer_puuid`, and `death_events` filter for `victim_puuid`).

This ensures that once we resolve the player identity (whether by PUUID or name#tag), all subsequent lookups use the API's own PUUID consistently.

---

### Task 1: Update `src/lib/types.ts`

Add `MatchRound` interface after the existing `VodComment` interface:

```typescript
export interface MatchRound {
  id: string
  created_at: string
  user_id: string
  match_id: string
  round_number: number
  side: 'attack' | 'defense'
  round_won: boolean
  end_type: string | null
  kills: number
  deaths: number
  assists: number
  damage_dealt: number
  damage_received: number
  loadout_value: number
  spent: number
  score: number
  kill_events: Array<{ kill_time_ms: number; victim: string; weapon: string }>
  death_events: Array<{ kill_time_ms: number; killer: string; weapon: string }>
}
```

Update the `VodReview` interface — add `barrier_drop_offset` field:

```typescript
export interface VodReview {
  id: string
  created_at: string
  user_id: string
  match_id: string
  youtube_url: string
  peak_moment: string | null
  key_lesson: string | null
  themes: string | null
  match_quality: number | null
  notes: string | null
  barrier_drop_offset: number | null
}
```

---

### Task 2: Create `src/lib/matchSync.ts`

This is a new file. Create it with the following content:

```typescript
import { supabase } from './supabase'
import type { MatchRound, VodTag } from './types'

const PLAYER_PUUID = 'Ktw12yrP_o4qg3MuvgfH88E68XCbdAZ7b1DmtLm1di65-JdjCSMy8Dwrzg6O5tvV8EO0Ja_OgGs9GA'
const AVG_ROUND_DURATION = 110 // seconds (30s buy + ~80s round)

// Weapon ID to display name mapping (common weapons)
const WEAPON_NAMES: Record<string, string> = {
  // Sidearms
  '29A0CFAB-485B-F5D5-779A-B59F85E204A8': 'Classic',
  '42DA8CCE-40A5-043F-4AEC-7A9F2A1600DE': 'Shorty',
  '44D4E95C-4157-0037-81B2-17841BF2E8E3': 'Frenzy',
  '1BAA85B4-4C70-1284-64BB-6481DFC3BB4E': 'Ghost',
  'E336C6B8-418D-9340-D77F-7A9E4CFE0702': 'Sheriff',
  // SMGs
  'F7E1B454-4AD4-1063-EC0A-159E56B58941': 'Stinger',
  '462080D1-4035-2937-7C09-27AA2A5C27A7': 'Spectre',
  // Shotguns
  '910BE174-449B-C412-AB22-D0873436B21B': 'Bucky',
  'EC845BF4-4F79-DDDA-A3DA-0DB3774B2794': 'Judge',
  // Rifles
  'AE3DE142-4D85-2547-DD26-4E90BED35CF7': 'Bulldog',
  '4ADE7FAA-4CF1-8376-95EF-39884480959B': 'Guardian',
  '9C82E19D-4575-0200-1A81-3EACF00CF872': 'Phantom',
  'EE8E8D15-496B-07AC-E5F6-8FAE5D4C7B1A': 'Vandal',
  // Sniper
  'C4883E50-4494-202C-3EC3-6B8A9284F00B': 'Marshal',
  'A03B24D3-4319-996D-0F8C-94BBFBA1DFC7': 'Operator',
  // Heavy
  '55D8A0F4-4274-CA67-FE2C-06AB45AC8543': 'Ares',
  '63E6C3B6-4A8E-869C-3D4C-E38355226584': 'Odin',
  // Melee
  '2F59173C-4BED-B6C3-2191-DDB3EDB14835': 'Melee',
}

function getWeaponName(weaponId: string): string {
  if (!weaponId) return ''
  const upper = weaponId.toUpperCase()
  return WEAPON_NAMES[upper] || weaponId.split('/').pop()?.replace(/_/g, ' ') || 'Unknown'
}

// ==========================================
// Fetch round data from Henrik API
// ==========================================
export async function fetchMatchRoundData(matchId: string, userId: string): Promise<MatchRound[] | null> {
  // Check if we already have round data stored
  const { data: existing } = await supabase
    .from('match_rounds')
    .select('*')
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .order('round_number', { ascending: true })

  if (existing && existing.length > 0) return existing

  // Fetch from Henrik API
  const apiKey = import.meta.env.VITE_HENRIK_API_KEY
  if (!apiKey) {
    console.error('VITE_HENRIK_API_KEY not set')
    return null
  }

  try {
    const res = await fetch(`https://api.henrikdev.xyz/valorant/v2/match/${matchId}`, {
      headers: { Authorization: apiKey },
    })

    if (!res.ok) {
      console.error('Henrik API error:', res.status)
      return null
    }

    const json = await res.json()
    const matchData = json.data
    if (!matchData?.rounds) return null

    // Find our player
    const allPlayers = matchData.players?.all_players || []
    const ourPlayer = allPlayers.find((p: any) => p.puuid === PLAYER_PUUID)
    if (!ourPlayer) {
      console.error('Player not found in match data')
      return null
    }

    const playerTeam = ourPlayer.team // "Red" or "Blue"
    const firstHalfSide = playerTeam === 'Blue' ? 'attack' : 'defense'
    const secondHalfSide = playerTeam === 'Blue' ? 'defense' : 'attack'

    // Parse rounds
    const rounds: Omit<MatchRound, 'id' | 'created_at'>[] = matchData.rounds.map((round: any, index: number) => {
      const roundNum = index + 1
      const side = roundNum <= 12 ? firstHalfSide : secondHalfSide

      // Find our player's stats in this round
      const ourStats = round.player_stats?.find((ps: any) => ps.player_puuid === PLAYER_PUUID)

      // Extract kill events where we are the killer
      const ourKills = (ourStats?.kill_events || [])
        .filter((ke: any) => ke.killer_puuid === PLAYER_PUUID)
        .map((ke: any) => {
          const victimPlayer = allPlayers.find((p: any) => p.puuid === ke.victim_puuid)
          return {
            kill_time_ms: ke.kill_time_in_round || 0,
            victim: victimPlayer?.character || 'Unknown',
            weapon: getWeaponName(ke.damage_weapon_id || ''),
          }
        })

      // Extract death events where we are the victim
      const allKillEvents = round.player_stats?.flatMap((ps: any) => ps.kill_events || []) || []
      const ourDeaths = allKillEvents
        .filter((ke: any) => ke.victim_puuid === PLAYER_PUUID)
        .map((ke: any) => {
          const killerPlayer = allPlayers.find((p: any) => p.puuid === ke.killer_puuid)
          return {
            kill_time_ms: ke.kill_time_in_round || 0,
            killer: killerPlayer?.character || 'Unknown',
            weapon: getWeaponName(ke.damage_weapon_id || ''),
          }
        })

      // Did our team win this round?
      const roundWon = round.winning_team === playerTeam

      // Damage calculation
      const ourDamage = ourStats?.damage || 0
      const damageReceived = ourStats?.damage_received || 0

      return {
        user_id: userId,
        match_id: matchId,
        round_number: roundNum,
        side,
        round_won: roundWon,
        end_type: round.end_type || null,
        kills: ourStats?.kills || 0,
        deaths: ourDeaths.length,
        assists: ourStats?.assists || 0,
        damage_dealt: ourDamage,
        damage_received: damageReceived,
        loadout_value: ourStats?.economy?.loadout_value || 0,
        spent: ourStats?.economy?.spent || 0,
        score: ourStats?.score || 0,
        kill_events: ourKills,
        death_events: ourDeaths,
      }
    })

    // Upsert to Supabase
    const { data: inserted, error } = await supabase
      .from('match_rounds')
      .upsert(rounds, { onConflict: 'match_id,user_id,round_number' })
      .select()

    if (error) {
      console.error('Failed to store round data:', error)
      return null
    }

    return inserted
  } catch (err) {
    console.error('Failed to fetch match detail:', err)
    return null
  }
}

// ==========================================
// Generate auto-tags from round data
// ==========================================
export function generateAutoTags(
  rounds: MatchRound[],
  barrierOffset: number,
): Omit<VodTag, 'id' | 'created_at' | 'user_id' | 'vod_review_id'>[] {
  const tags: Omit<VodTag, 'id' | 'created_at' | 'user_id' | 'vod_review_id'>[] = []

  rounds.forEach((round) => {
    const roundIdx = round.round_number - 1
    const roundStartVideo = barrierOffset + (roundIdx * AVG_ROUND_DURATION)

    // -- Round marker --
    tags.push({
      timestamp_seconds: Math.round(roundStartVideo),
      round_number: round.round_number,
      tag_type: 'round',
      label: `R${round.round_number} ${round.side === 'attack' ? 'ATK' : 'DEF'} — ${round.round_won ? 'Won' : 'Lost'}`,
      side: round.side,
      is_auto: true,
    })

    // -- Half-switch at round 13 --
    if (round.round_number === 13) {
      tags.push({
        timestamp_seconds: Math.max(0, Math.round(roundStartVideo - 15)),
        round_number: 13,
        tag_type: 'half',
        label: `⚔ Side switch → ${round.side === 'attack' ? 'ATTACK' : 'DEFENSE'}`,
        side: round.side,
        is_auto: true,
      })
    }

    // -- Kill events --
    (round.kill_events || []).forEach((kill) => {
      const killTime = roundStartVideo + (kill.kill_time_ms / 1000)
      tags.push({
        timestamp_seconds: Math.round(killTime),
        round_number: round.round_number,
        tag_type: 'kill',
        label: `Killed ${kill.victim}${kill.weapon ? ` (${kill.weapon})` : ''}`,
        side: round.side,
        is_auto: true,
      })
    })

    // -- Death events --
    (round.death_events || []).forEach((death) => {
      const deathTime = roundStartVideo + (death.kill_time_ms / 1000)
      tags.push({
        timestamp_seconds: Math.round(deathTime),
        round_number: round.round_number,
        tag_type: 'death',
        label: `Died to ${death.killer}${death.weapon ? ` (${death.weapon})` : ''}`,
        side: round.side,
        is_auto: true,
      })
    })

    // -- Multi-kill (3K, 4K, ACE) --
    if (round.kills >= 3) {
      const multiLabel = round.kills === 5 ? '🔥 ACE' : round.kills === 4 ? '🔥 4K' : '🔥 3K'
      tags.push({
        timestamp_seconds: Math.round(roundStartVideo + 5),
        round_number: round.round_number,
        tag_type: 'strength',
        label: `${multiLabel} — R${round.round_number}`,
        side: round.side,
        is_auto: true,
      })
    }

    // -- First blood (early kill) --
    const kills = round.kill_events || []
    if (kills.length > 0 && kills[0].kill_time_ms <= 15000) {
      tags.push({
        timestamp_seconds: Math.round(roundStartVideo + (kills[0].kill_time_ms / 1000)),
        round_number: round.round_number,
        tag_type: 'strength',
        label: `First Blood on ${kills[0].victim}`,
        side: round.side,
        is_auto: true,
      })
    }

    // -- First death (early death) --
    const deaths = round.death_events || []
    if (deaths.length > 0 && deaths[0].kill_time_ms <= 15000) {
      tags.push({
        timestamp_seconds: Math.round(roundStartVideo + (deaths[0].kill_time_ms / 1000)),
        round_number: round.round_number,
        tag_type: 'mistake',
        label: `First Death — killed by ${deaths[0].killer}`,
        side: round.side,
        is_auto: true,
      })
    }
  })

  return tags
}

// ==========================================
// Save auto-tags to Supabase
// ==========================================
export async function saveAutoTags(
  vodReviewId: string,
  userId: string,
  autoTags: Omit<VodTag, 'id' | 'created_at' | 'user_id' | 'vod_review_id'>[],
): Promise<VodTag[]> {
  // Delete existing auto-tags for this review (regenerating fresh)
  await supabase
    .from('vod_tags')
    .delete()
    .eq('vod_review_id', vodReviewId)
    .eq('is_auto', true)

  // Insert new auto-tags
  const rows = autoTags.map(tag => ({
    ...tag,
    user_id: userId,
    vod_review_id: vodReviewId,
  }))

  const { data, error } = await supabase
    .from('vod_tags')
    .insert(rows)
    .select()

  if (error) {
    console.error('Failed to save auto-tags:', error)
    return []
  }

  return data || []
}
```

---

### Task 3: Modify `src/pages/VodReview.tsx`

Read the file first. Then apply the following surgical edits using `str_replace`.

#### 3a. Add new imports

Find the existing import line:
```typescript
import type { Match, VodReview as VodReviewType } from '../lib/types'
```
Replace with:
```typescript
import type { Match, VodReview as VodReviewType, VodTag, MatchRound } from '../lib/types'
import { fetchMatchRoundData, generateAutoTags, saveAutoTags } from '../lib/matchSync'
```

Find the existing lucide-react import and add: `Tag, Trash2, Plus, X, Zap, Crosshair as CrosshairIcon` (rename to avoid collision with existing `Crosshair` if present — check the file). If `Crosshair` is already imported, add `Zap` only.

Actually, more carefully: the file already imports `Crosshair` from lucide-react. We need `Tag`, `Trash2`, `Plus`, `X`, `Zap`. Add those to the existing import.

#### 3b. Add TAG_TYPES constant

After the `StatRow` component (before `export default function VodReview()`), add:

```typescript
const MANUAL_TAG_TYPES = [
  { type: 'strength', label: 'Strength', color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  { type: 'mistake', label: 'Mistake', color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  { type: 'read', label: 'Read', color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  { type: 'clutch', label: 'Clutch', color: 'bg-val-yellow', textColor: 'text-val-yellow', dotColor: '#FFCA3A' },
  { type: 'comms', label: 'Comms', color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
  { type: 'positioning', label: 'Position', color: 'bg-[#6EE7B7]', textColor: 'text-[#6EE7B7]', dotColor: '#6EE7B7' },
  { type: 'utility', label: 'Utility', color: 'bg-[#F97316]', textColor: 'text-[#F97316]', dotColor: '#F97316' },
  { type: 'economy', label: 'Economy', color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#64748B' },
  { type: 'aim', label: 'Aim', color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
] as const

const ALL_TAG_COLORS: Record<string, { color: string; textColor: string; dotColor: string }> = {
  strength: { color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  mistake: { color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  read: { color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  clutch: { color: 'bg-val-yellow', textColor: 'text-val-yellow', dotColor: '#FFCA3A' },
  comms: { color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
  positioning: { color: 'bg-[#6EE7B7]', textColor: 'text-[#6EE7B7]', dotColor: '#6EE7B7' },
  utility: { color: 'bg-[#F97316]', textColor: 'text-[#F97316]', dotColor: '#F97316' },
  economy: { color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#64748B' },
  aim: { color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  round: { color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#475569' },
  kill: { color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  death: { color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  half: { color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
}
```

#### 3c. Add new state variables

After the existing `timerRef` line, add:

```typescript
// Tagging state
const [tags, setTags] = useState<VodTag[]>([])
const [isTagging, setIsTagging] = useState(false)
const [selectedTagType, setSelectedTagType] = useState<string>('strength')
const [tagLabel, setTagLabel] = useState('')
const [tagTimestamp, setTagTimestamp] = useState(0)
const [savingTag, setSavingTag] = useState(false)
const tagLabelRef = useRef<HTMLInputElement>(null)

// Match sync state
const [matchRounds, setMatchRounds] = useState<MatchRound[]>([])
const [roundsLoading, setRoundsLoading] = useState(false)
const [syncing, setSyncing] = useState(false)
const [showAutoTags, setShowAutoTags] = useState(true)
```

Also rename `_vodReview` to `vodReview` throughout the file (find `const [_vodReview, setVodReview]` → `const [vodReview, setVodReview]`). There should be ~4 occurrences of `_vodReview` to rename.

#### 3d. Add match rounds loading effect

After the existing data loading `useEffect`, add:

```typescript
// Load round data when match is available
useEffect(() => {
  if (!match || !match.match_id) return

  async function loadRounds() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setRoundsLoading(true)
    const rounds = await fetchMatchRoundData(match!.match_id, user.id)
    if (rounds) setMatchRounds(rounds)
    setRoundsLoading(false)
  }
  loadRounds()
}, [match])
```

#### 3e. Add tag loading effect

```typescript
// Load tags when vod_review is available
useEffect(() => {
  if (!vodReview) return

  async function loadTags() {
    const { data, error } = await supabase
      .from('vod_tags')
      .select('*')
      .eq('vod_review_id', vodReview!.id)
      .order('timestamp_seconds', { ascending: true })

    if (!error && data) setTags(data)
  }
  loadTags()
}, [vodReview])
```

#### 3f. Add tag CRUD + sync functions

After `handleSaveUrl`, add:

```typescript
// === MANUAL TAGGING ===
const startTagging = useCallback((preselectedType?: string) => {
  if (!playerRef.current || !playerReady || !vodReview) return
  playerRef.current.pauseVideo()
  const ts = playerRef.current.getCurrentTime()
  setTagTimestamp(ts)
  setSelectedTagType(preselectedType || 'strength')
  setTagLabel('')
  setIsTagging(true)
  setTimeout(() => tagLabelRef.current?.focus(), 50)
}, [playerReady, vodReview])

const saveTag = async () => {
  if (!tagLabel.trim() || !vodReview) return
  setSavingTag(true)
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('vod_tags')
      .insert({
        user_id: user.id,
        vod_review_id: vodReview.id,
        timestamp_seconds: Math.round(tagTimestamp),
        tag_type: selectedTagType,
        label: tagLabel.trim(),
        is_auto: false,
      })
      .select()
      .single()

    if (error) throw error
    if (data) setTags(prev => [...prev, data].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds))
    setIsTagging(false)
    setTagLabel('')
  } catch (err) {
    console.error('Failed to save tag:', err)
  } finally {
    setSavingTag(false)
  }
}

const deleteTag = async (tagId: string) => {
  try {
    const { error } = await supabase.from('vod_tags').delete().eq('id', tagId)
    if (!error) setTags(prev => prev.filter(t => t.id !== tagId))
  } catch (err) {
    console.error('Failed to delete tag:', err)
  }
}

const cancelTagging = () => {
  setIsTagging(false)
  setTagLabel('')
}

const seekToTag = (seconds: number) => {
  if (!playerRef.current || !playerReady) return
  playerRef.current.seekTo(seconds, true)
  setCurrentTime(seconds)
}

// === MATCH SYNC (calibration) ===
const handleBarrierSync = async () => {
  if (!playerRef.current || !playerReady || !vodReview) return
  setSyncing(true)
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const offset = Math.round(playerRef.current.getCurrentTime())

    // Save barrier offset to vod_reviews
    const { data, error } = await supabase
      .from('vod_reviews')
      .update({ barrier_drop_offset: offset })
      .eq('id', vodReview.id)
      .select()
      .maybeSingle()

    if (error) throw error
    if (data) setVodReview(data)

    // Generate and save auto-tags
    if (matchRounds.length > 0) {
      const autoTagData = generateAutoTags(matchRounds, offset)
      const savedTags = await saveAutoTags(vodReview.id, user.id, autoTagData)

      // Merge with existing manual tags
      setTags(prev => {
        const manualTags = prev.filter(t => !t.is_auto)
        return [...manualTags, ...savedTags].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
      })
    }
  } catch (err) {
    console.error('Failed to sync match:', err)
  } finally {
    setSyncing(false)
  }
}
```

#### 3g. Update keyboard shortcuts

Find the keyboard `switch` block and add these cases before the closing `}`:

```typescript
      case 't':
      case 'T':
        e.preventDefault()
        if (!isTagging) startTagging('strength')
        break
      case 'Escape':
        e.preventDefault()
        if (isTagging) cancelTagging()
        break
```

Update the useEffect dependency array from `[togglePlay, seek]` to `[togglePlay, seek, isTagging, startTagging, cancelTagging]`.

#### 3h. Replace Sprint 3 placeholder with full tagging + sync UI

Find this block:

```tsx
          {/* Sprint 3 preview — tagging placeholder */}
          {videoId && playerReady && (
            <div className="bg-bg-card border border-dashed border-bg-elevated rounded-lg px-4 py-3 text-center">
              <p className="text-text-muted text-xs">
                🏷️ Timestamped tagging — Sprint 3. Press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> to tag moments while watching.
              </p>
            </div>
          )}
```

Replace with:

```tsx
          {/* === TAGGING + MATCH SYNC === */}
          {videoId && playerReady && vodReview && (
            <div className="space-y-2">

              {/* Sync bar — shown when no barrier offset set yet */}
              {vodReview.barrier_drop_offset == null && matchRounds.length > 0 && (
                <div className="bg-bg-card border border-val-yellow/30 rounded-lg px-4 py-2 flex items-center gap-3">
                  <Zap className="w-4 h-4 text-val-yellow shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-text-secondary">
                      <strong className="text-val-yellow">Sync match data:</strong> Play the VOD to the moment R1 barriers drop, then click Sync.
                    </p>
                  </div>
                  <button
                    onClick={handleBarrierSync}
                    disabled={syncing}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-val-yellow/10 text-val-yellow border border-val-yellow/20 rounded-lg text-xs font-medium hover:bg-val-yellow/20 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {syncing ? (
                      <div className="w-3 h-3 border-2 border-val-yellow border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Sync: Barriers Drop
                  </button>
                </div>
              )}

              {/* Re-sync option — shown when barrier offset IS set */}
              {vodReview.barrier_drop_offset != null && (
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                  <Zap className="w-3 h-3" />
                  <span>Synced at {formatTime(vodReview.barrier_drop_offset)} — {matchRounds.length} rounds loaded</span>
                  <button
                    onClick={handleBarrierSync}
                    disabled={syncing}
                    className="text-val-yellow hover:text-val-yellow/80 font-medium"
                  >
                    {syncing ? 'Syncing...' : 'Re-sync'}
                  </button>
                  <label className="ml-auto flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showAutoTags}
                      onChange={(e) => setShowAutoTags(e.target.checked)}
                      className="w-3 h-3 accent-val-cyan"
                    />
                    <span>Show auto-tags</span>
                  </label>
                </div>
              )}

              {/* Rounds loading state */}
              {roundsLoading && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <div className="w-3 h-3 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
                  Loading round data from API...
                </div>
              )}

              {/* Tag input bar — shown when tagging is active */}
              {isTagging ? (
                <div className="bg-bg-card border border-val-cyan/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-stats text-xs text-val-cyan">
                      {formatTime(tagTimestamp)}
                    </span>
                    <div className="flex gap-1 flex-wrap">
                      {MANUAL_TAG_TYPES.map(t => (
                        <button
                          key={t.type}
                          onClick={() => setSelectedTagType(t.type)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                            selectedTagType === t.type
                              ? `${t.color}/20 ${t.textColor} border-current`
                              : 'bg-bg-elevated text-text-muted border-transparent hover:border-bg-card'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={tagLabelRef}
                      type="text"
                      value={tagLabel}
                      onChange={(e) => setTagLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tagLabel.trim()) saveTag()
                        if (e.key === 'Escape') cancelTagging()
                      }}
                      placeholder="What happened here? (e.g., clean one-tap B site)"
                      className="flex-1 bg-bg-elevated border border-bg-card rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-val-cyan/40"
                    />
                    <button
                      onClick={saveTag}
                      disabled={!tagLabel.trim() || savingTag}
                      className="flex items-center gap-1 px-3 py-1.5 bg-val-green/10 text-val-green border border-val-green/20 rounded-lg text-xs font-medium hover:bg-val-green/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {savingTag ? (
                        <div className="w-3 h-3 border-2 border-val-green border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      Save
                    </button>
                    <button onClick={cancelTagging} className="p-1.5 text-text-muted hover:text-text-secondary transition-colors" title="Cancel (Esc)">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <div className="flex gap-1 flex-wrap">
                    {MANUAL_TAG_TYPES.map(t => (
                      <button
                        key={t.type}
                        onClick={() => startTagging(t.type)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${t.color}/10 ${t.textColor} border border-transparent hover:border-current transition-colors`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-[10px] text-text-muted hidden md:block">
                    <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> quick tag
                  </span>
                </div>
              )}

              {/* Visual timeline scrubber */}
              {(() => {
                const visibleTags = showAutoTags ? tags : tags.filter(t => !t.is_auto)
                if (visibleTags.length === 0) return null

                return (
                  <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
                    <div
                      className="relative h-6 bg-bg-elevated rounded-full cursor-pointer group"
                      onClick={(e) => {
                        if (!playerRef.current || !duration) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const pct = (e.clientX - rect.left) / rect.width
                        const seekTime = pct * duration
                        playerRef.current.seekTo(seekTime, true)
                        setCurrentTime(seekTime)
                      }}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-white/5 rounded-full transition-all"
                        style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                      />

                      {/* Half-switch marker line */}
                      {visibleTags.filter(t => t.tag_type === 'half').map(tag => {
                        const pct = duration > 0 ? (tag.timestamp_seconds / duration) * 100 : 0
                        return (
                          <div
                            key={tag.id}
                            className="absolute top-0 bottom-0 w-px bg-val-yellow/40"
                            style={{ left: `${Math.max(1, Math.min(99, pct))}%` }}
                            title={tag.label}
                          />
                        )
                      })}

                      {/* Round markers (small ticks) */}
                      {showAutoTags && visibleTags.filter(t => t.tag_type === 'round').map(tag => {
                        const pct = duration > 0 ? (tag.timestamp_seconds / duration) * 100 : 0
                        return (
                          <button
                            key={tag.id}
                            onClick={(e) => { e.stopPropagation(); seekToTag(tag.timestamp_seconds) }}
                            className="absolute top-0 w-px h-2 bg-text-muted/30 hover:bg-text-muted/60 transition-colors"
                            style={{ left: `${Math.max(1, Math.min(99, pct))}%` }}
                            title={tag.label}
                          />
                        )
                      })}

                      {/* Tag dots (non-structural) */}
                      {visibleTags.filter(t => t.tag_type !== 'round' && t.tag_type !== 'half').map(tag => {
                        const pct = duration > 0 ? (tag.timestamp_seconds / duration) * 100 : 0
                        const tagMeta = ALL_TAG_COLORS[tag.tag_type]
                        return (
                          <button
                            key={tag.id}
                            onClick={(e) => { e.stopPropagation(); seekToTag(tag.timestamp_seconds) }}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-bg-card hover:scale-150 transition-transform z-10"
                            style={{
                              left: `${Math.max(1, Math.min(99, pct))}%`,
                              backgroundColor: tagMeta?.dotColor || '#64748B',
                            }}
                            title={`${formatTime(tag.timestamp_seconds)} — ${tag.label}`}
                          />
                        )
                      })}

                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-4 bg-white rounded-full opacity-60 pointer-events-none"
                        style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                      />
                    </div>

                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-text-muted">
                        {tags.filter(t => !t.is_auto).length} manual · {tags.filter(t => t.is_auto).length} auto
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Tag list */}
              {(() => {
                const visibleTags = showAutoTags
                  ? tags.filter(t => t.tag_type !== 'round') // hide round markers from list (too noisy), keep kills/deaths/etc
                  : tags.filter(t => !t.is_auto)
                if (visibleTags.length === 0) return null

                return (
                  <div className="bg-bg-card border border-bg-elevated rounded-lg overflow-hidden">
                    <div className="max-h-60 overflow-y-auto divide-y divide-bg-elevated">
                      {visibleTags.map(tag => {
                        const tagMeta = ALL_TAG_COLORS[tag.tag_type]
                        return (
                          <div
                            key={tag.id}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/50 cursor-pointer group transition-colors"
                            onClick={() => seekToTag(tag.timestamp_seconds)}
                          >
                            <div
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: tagMeta?.dotColor || '#64748B' }}
                            />
                            <span className="font-stats text-[11px] text-val-cyan w-10 shrink-0">
                              {formatTime(tag.timestamp_seconds)}
                            </span>
                            {tag.round_number && (
                              <span className="text-[9px] text-text-muted w-6 shrink-0">R{tag.round_number}</span>
                            )}
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${tagMeta?.color}/15 ${tagMeta?.textColor} shrink-0`}>
                              {tag.tag_type}
                            </span>
                            <span className="text-xs text-text-secondary truncate flex-1">
                              {tag.label}
                            </span>
                            {tag.is_auto ? (
                              <span className="text-[9px] text-text-muted shrink-0">auto</span>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteTag(tag.id) }}
                                className="p-1 text-text-muted hover:text-val-red opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                title="Delete tag"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
```

#### 3i. Update keyboard hint in playback controls

Find:
```tsx
                <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">Shift+←→</kbd> ±10s</span>
```
Replace with:
```tsx
                <span><kbd className="px-1 py-0.5 bg-bg-elevated rounded text-[10px]">T</kbd> tag</span>
```

---

### Commit message:
```
Phase 4 Sprint 3: Timestamped tags + match data sync

- Create matchSync.ts: Henrik API round data fetcher + auto-tag generator
- Add vod_tags Supabase integration (manual + auto tags with is_auto flag)
- Add match_rounds table for per-round stats, kills, deaths, economy
- Barrier calibration: single sync point maps API data to video timeline
- Manual tagging: 9 tag type pills, T keyboard shortcut, auto-pause
- Auto-tags: round markers, kills, deaths, multi-kills, first bloods, side switches
- Visual timeline: colored dots, half-switch lines, round tick marks
- Tag list with round number, type badge, timestamp, click-to-seek
- Show/hide auto-tags toggle
- Types updated: MatchRound interface, VodReview.barrier_drop_offset
```

---

## Verification After Running

1. **Build passes:** `npm run build` — zero TypeScript errors
2. **Navigate:** Open a match with a linked YouTube video
3. **Round data auto-loads:** Check browser console — should see match_rounds being fetched/stored
4. **Supabase check:** `SELECT count(*) FROM match_rounds WHERE match_id = '{your_match_id}';` — should return ~20-25 rows
5. **Sync bar visible:** Yellow "Sync Match" bar appears below video
6. **Calibration:** Play VOD to round 1 barriers → click "Sync: Barriers Drop" → auto-tags appear on timeline
7. **Auto-tags on timeline:** Colored dots for kills (green), deaths (red), half-switch line (yellow)
8. **Round ticks:** Small gray tick marks for each round start on the timeline
9. **Tag list:** Shows kills, deaths, multi-kills with round numbers and timestamps
10. **Click-to-seek:** Click any tag dot or list item → video seeks to that moment
11. **Manual tagging still works:** Press T → type label → Enter → manual tag saved alongside auto-tags
12. **Show/hide toggle:** Uncheck "Show auto-tags" → auto-tags disappear from timeline and list
13. **Re-sync:** Click "Re-sync" → regenerates auto-tags at new offset
14. **Page reload:** All tags persist from Supabase
15. **Supabase vod_tags:** `SELECT count(*), is_auto FROM vod_tags GROUP BY is_auto;` — should show both manual and auto counts

### Known Edge Cases:
- If Henrik API returns 403/429, round data won't load — the manual tagging still works independently
- The `AVG_ROUND_DURATION = 110` estimate drifts over many rounds — by round 25 the offset could be ±30s. Acceptable for V1.
- The weapon ID mapping covers common weapons but may miss newer additions — unrecognized IDs fall back to a cleaned version of the ID string
- Overtime rounds (25+) use the same side logic as the second half — technically overtime alternates every 2 rounds, but this is a Sprint 6 refinement
- The `is_auto` column lets us cleanly delete and regenerate auto-tags without touching manual tags

---

## Connections

- [[2026-03-30-VAL-Master-Phase4-PostMatch-Pivot]] — Parent spec for all Phase 4 sprints
- [[2026-04-03-VAL-Master-Phase4-Sprint2-VodReview]] — Sprint 2 that this builds on
- [[2026-04-01-VAL-Master-Phase4-Sprint1-MatchLibrary]] — Sprint 1 (Match Library)
- [[Valorant-Performance-Hub-Project-Status]] — Update status after completion
- [[VALORANT_TRACKER_PROJECT_KNOWLEDGE]] — Henrik API endpoint documentation

## Known Bug: Player Not Found in Match Data

**Symptom:** Console shows `"Player not found in match data"` — round data never loads, sync bar never appears, 0 auto-tags.

**Root cause:** The hardcoded `PLAYER_PUUID` in `matchSync.ts` doesn't match what the Henrik API v2/match endpoint returns for this player. Possible causes: PUUID encoding difference (case sensitivity), PUUID rotation by Riot, or the v2 response structures players differently than expected.

**Fix (apply in next Claude Code session):** Make the player lookup resilient by trying multiple strategies:

```typescript
// In matchSync.ts, replace the single PUUID lookup with:
const PLAYER_PUUID = 'Ktw12yrP_o4qg3MuvgfH88E68XCbdAZ7b1DmtLm1di65-JdjCSMy8Dwrzg6O5tvV8EO0Ja_OgGs9GA'
const PLAYER_NAME = 'Jobast'
const PLAYER_TAG = '9537'

// Then in fetchMatchRoundData, replace the player find with:
const allPlayers = matchData.players?.all_players || []
let ourPlayer = allPlayers.find((p: any) => p.puuid === PLAYER_PUUID)
if (!ourPlayer) {
  // Fallback: match by name#tag
  ourPlayer = allPlayers.find((p: any) => 
    p.name?.toLowerCase() === PLAYER_NAME.toLowerCase() && p.tag === PLAYER_TAG
  )
}
if (!ourPlayer) {
  // Debug: log what PUUIDs are actually in the response
  console.error('Player not found. Available players:', 
    allPlayers.map((p: any) => `${p.name}#${p.tag} (${p.puuid?.substring(0, 20)}...)`)
  )
  return null
}
```

This **also needs to be added to the Claude Code prompt** as a pre-task fix. Add this instruction before the existing Task 3:

> **Task 0 (Hotfix): Fix player lookup in `src/lib/matchSync.ts`**
> Read `matchSync.ts`. Apply these changes:
> 1. Add `PLAYER_NAME = 'Jobast'` and `PLAYER_TAG = '9537'` constants after `PLAYER_PUUID`
> 2. Replace the player find logic with the multi-strategy fallback above
> 3. Add the same fallback for `player_stats` PUUID matching inside the round parser — replace `ps.player_puuid === PLAYER_PUUID` with a helper function that checks both PUUID and name/tag

## Action Items

- [ ] Fix matchSync.ts player lookup (PUUID fallback to name#tag) — see hotfix above
- [ ] Run SQL migrations in Supabase SQL Editor (vod_tags + match_rounds + barrier_drop_offset)
- [ ] Verify VITE_HENRIK_API_KEY is set in both .env.local and Vercel env vars
- [ ] Execute this Claude Code prompt in a Claude Code session
- [ ] Verify build passes and all 15 verification checks pass
- [ ] Update Phase 4 pivot doc: mark Sprint 3 checklist items as complete

> [!question]- Open Loops
> - **Round duration refinement:** The 110s average works for V1 but drifts. Sprint 6 could implement "click to mark round N start" for manual correction of any round offset. Or calculate actual round durations if the API exposes `round_end_time`.
> - **Overtime side logic:** Currently treats rounds 13+ as second-half side. True overtime (25+) alternates every 2 rounds. Edge case — only matters in close matches that go to OT.
> - **Weapon ID completeness:** The mapping covers standard weapons but may miss event-specific or new weapon IDs. The fallback cleans the ID string, which is acceptable.
> - **Henrik API rate limits:** The match detail fetch happens once per match review (then cached in match_rounds). But if a user opens 10 reviews in quick succession, it could hit rate limits. Consider adding a debounce or queue.
> - **First blood detection accuracy:** We check if a kill happened in the first 15s of a round as a proxy for "first blood." The true first blood is the absolute first kill of the round across ALL players, not just ours. We'd need to cross-reference all kill events in the round. Deferred — current approach catches our early kills which is still valuable.
> - **`aim` and `read` share val-cyan:** Same as Sprint 3 original spec — visually indistinguishable on timeline. Sprint 6 could differentiate.
