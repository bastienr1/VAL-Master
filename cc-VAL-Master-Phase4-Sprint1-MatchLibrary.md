## Claude Code Prompt

---

**Context:** VAL Master Phase 4 Sprint 1. We're pivoting the app from pre-game check-in to post-match analysis. The Match Library becomes the new home page. All existing pages/routes are preserved but the nav changes.

**Repo:** `bastienr1/VAL-Master` on `main` branch.

**Stack:** React 19, Vite, TypeScript, Tailwind 4 (using `@theme` in `index.css` for design tokens), Supabase, lucide-react for icons, recharts available.

**Design tokens (from `src/index.css`):**
- Colors: `val-red`, `val-cyan`, `val-yellow`, `val-green`, `bg-primary`, `bg-secondary`, `bg-card`, `bg-elevated`, `text-primary`, `text-secondary`, `text-muted`
- Fonts: `font-heading` (Rajdhani), `font-body` (Inter), `font-stats` (JetBrains Mono)

**Existing files you'll touch:**
- `src/App.tsx` — Route/nav restructure (UPDATE)

**New files to create:**
- `src/pages/MatchLibrary.tsx` — New home page
- `src/pages/VodReview.tsx` — Placeholder page for Sprint 2

---

### Task 1: Create `src/pages/MatchLibrary.tsx`

This is the new home page. A gallery of match cards pulled from the `matches` Supabase table.

**Imports needed:**
```typescript
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchRecentMatches } from '../lib/henrik'
import { getMapSplash, getAgentIcon, MAPS, AGENTS } from '../lib/constants'
import type { Match } from '../lib/types'
// Icons from lucide-react: RefreshCw, Swords, Filter, ChevronDown, Crosshair, Target, Percent
```

**Component structure:**

1. **Header section:**
   - Title: "Match Library" (`text-3xl font-heading font-bold`)
   - Subtitle: `{count} matches · {wins}W {losses}L · {winRate}% WR` (`text-text-secondary text-sm`)
   - "Load Latest" button (top right): calls `fetchRecentMatches(5, 'competitive')` then upserts each match to Supabase with `supabase.from('matches').upsert({...r.match, user_id: user.id}, { onConflict: 'match_id' })`. Shows spinning `RefreshCw` icon while syncing.
   - Button style: `bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg hover:bg-val-cyan/20`

2. **Filter bar:**
   - Result pills in a pill group (`bg-bg-card rounded-lg p-1`):
     - All (cyan when active), Wins (green when active), Losses (red when active)
     - Active style: `bg-val-{color}/20 text-val-{color}`
   - Map dropdown: button with `Filter` icon + "Map" label + `ChevronDown`. Dropdown shows only maps that appear in the player's actual match data (`playedMaps`). Uses `MAPS` from constants filtered to played maps.
   - Agent dropdown: same pattern, shows agent icon next to name in dropdown. Uses `AGENTS` from constants filtered to played agents.
   - "Clear filters" link (text-val-red) appears when any filter is active.
   - Dropdowns: `absolute top-full mt-1 z-50 bg-bg-elevated border border-bg-card rounded-lg shadow-xl` with scrollable list.

3. **Match grid:**
   - `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`
   - Each card is a `<MatchCard>` component (see below)
   - Click card → `navigate('/review/${match.match_id}')`

4. **Empty state:**
   - When no matches: Swords icon, "No matches yet" heading, "Hit Load Latest to sync" text, Load Latest button
   - When filtered to 0: "No matches match your filters" + "Try adjusting your filters"

5. **Loading state:** Standard cyan spinner

**`<MatchCard>` sub-component:**
- Clickable button, full width, `bg-bg-card border border-bg-elevated rounded-xl overflow-hidden hover:border-val-cyan/30 transition-all`
- **Top section (h-28):** Map splash image (`getMapSplash(match.map)`) as background, `opacity-40 group-hover:opacity-50`, gradient overlay from `bg-card` at bottom to transparent at top
  - Result badge: top-right, `W` in green / `L` in red / `DRAW` in yellow, small rounded pill with border
  - Agent icon + name + map name: bottom-left, agent icon is `w-10 h-10 rounded-full border-2 border-bg-card`
  - Score: bottom-right, `text-xl font-stats font-bold` in result color
- **Bottom section (px-4 py-3):** Stats row with date
  - Stats: ACS, K/D, KDA (kills/deaths/assists), HS% — each as a small `<StatChip>` with icon + label + value
  - Date + time: far right, `text-[10px] text-text-muted`

**`<StatChip>` sub-component:**
- Inline flex, gap-1: icon (text-text-muted), label (text-[10px] text-text-muted uppercase), value (text-xs font-stats font-medium text-text-primary)

**Data loading:**
```typescript
const loadMatches = useCallback(async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('user_id', user.id)
    .order('match_date', { ascending: false })
    .limit(50)
  if (error) throw error
  setMatches(data || [])
}, [])
```

**Sync handler:**
```typescript
const handleSync = async () => {
  setSyncing(true)
  const results = await fetchRecentMatches(5, 'competitive')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  for (const r of results) {
    await supabase
      .from('matches')
      .upsert({ ...r.match, user_id: user.id }, { onConflict: 'match_id' })
  }
  await loadMatches()
  setSyncing(false)
}
```

Wrap both in try/catch with console.error, set loading/syncing false in finally blocks.

**Filtering logic:**
```typescript
const filtered = matches.filter((m) => {
  if (resultFilter !== 'all' && m.result !== resultFilter) return false
  if (mapFilter !== 'all' && m.map !== mapFilter) return false
  if (agentFilter !== 'all' && m.agent !== agentFilter) return false
  return true
})
```

---

### Task 2: Create `src/pages/VodReview.tsx`

Placeholder page for Sprint 2. Shows match context when you click a card from Match Library.

**Route:** `/review/:matchId` — uses `useParams` to get `matchId`

**Data loading:**
```typescript
const { data, error } = await supabase
  .from('matches')
  .select('*')
  .eq('match_id', matchId)
  .eq('user_id', user.id)
  .maybeSingle()  // IMPORTANT: use maybeSingle, not single
```

**Layout:**
1. **Back link:** `← Back to Matches` linking to `/`, uses `ArrowLeft` icon, `text-text-secondary hover:text-val-cyan`

2. **Match header card:** (`bg-bg-card border border-bg-elevated rounded-xl overflow-hidden`)
   - Map splash background (h-40, opacity-30) with gradient overlay
   - Bottom-left: Agent icon (w-14 h-14) + "{Agent} on {Map}" heading + date + mode
   - Bottom-right: Score (text-3xl font-stats) + VICTORY/DEFEAT/DRAW label, all in result color
   - Stats bar below image: ACS, K/D, KDA, HS%, KPR, DPR — separated by `gap-6`, with `border-t border-bg-elevated`

3. **Sprint 2 placeholder:** A centered card with `Film` icon (w-16 h-16 text-text-muted), heading "VOD Review — Coming in Sprint 2", and description text about what will go here.

**Not found state:** "Match not found" + back link to `/`

**`<Stat>` sub-component:** Same pattern as StatChip but with slightly larger text.

---

### Task 3: Update `src/App.tsx`

**Changes to make (surgical — preserve everything, change routing and nav):**

1. **Add imports** at the top:
```typescript
import MatchLibrary from './pages/MatchLibrary'
import VodReview from './pages/VodReview'
```

2. **Replace the nav links** section. Change from:
```tsx
<NavLink to="/" end ...>Dashboard</NavLink>
<NavLink to="/checkin" ...>Check-In</NavLink>
<NavLink to="/tactical" ...>Tactical</NavLink>
<NavLink to="/debrief" ...>Debrief</NavLink>
```
To:
```tsx
<NavLink to="/" end ...>Matches</NavLink>
<NavLink to="/analytics" ...>Analytics</NavLink>
```

3. **Replace the Routes section.** Change from:
```tsx
<Route path="/" element={<Dashboard />} />
<Route path="/checkin" element={<CheckIn />} />
<Route path="/tactical" element={<TacticalReads />} />
<Route path="/debrief" element={<Debrief />} />
```
To:
```tsx
<Route path="/" element={<MatchLibrary />} />
<Route path="/review/:matchId" element={<VodReview />} />
<Route path="/analytics" element={<Dashboard />} />
{/* Preserved legacy routes — accessible via direct URL */}
<Route path="/checkin" element={<CheckIn />} />
<Route path="/tactical" element={<TacticalReads />} />
<Route path="/debrief" element={<Debrief />} />
```

**Keep all existing imports** (CheckIn, Debrief, TacticalReads, Dashboard, Login, useSession, signOut). None are removed.

---

### Commit message:
```
Phase 4 Sprint 1: Match Library as new home page + nav restructure

- Add MatchLibrary.tsx as new `/` route (replaces Dashboard)
- Dashboard.tsx becomes Analytics at `/analytics`
- New nav: Matches | Analytics (legacy routes preserved at /checkin, /tactical, /debrief)
- Match cards: map splash bg, agent icon, result badge, score, ACS/K/D/HS%
- Filter pills: All/Wins/Losses + Map dropdown + Agent dropdown
- "Load Latest" syncs last 5 competitive matches via Henrik API + upserts
- Click card navigates to /review/:matchId
- VodReview.tsx: match header with full stats + Sprint 2 placeholder
```

---

## Verification After Running

After Claude Code executes this, verify:
1. `src/pages/MatchLibrary.tsx` exists and exports default
2. `src/pages/VodReview.tsx` exists and exports default  
3. `src/App.tsx` imports both new pages, nav shows "Matches | Analytics", routes are correct
4. No TypeScript errors (`npm run build` should pass)
5. Navigate to `/` → see Match Library
6. Click "Load Latest" → matches appear as cards
7. Click a card → navigates to `/review/{matchId}` → see match header + placeholder
8. `/analytics` → shows old Dashboard
9. `/checkin`, `/tactical`, `/debrief` → still accessible

---

## Connections

- [[2026-03-30-VAL-Master-Phase4-PostMatch-Pivot]] — Parent spec for all Phase 4 sprints
- [[2026-03-28-VAL-Master-Sprint3-Debrief-Upsert-Dashboard-Stats]] — Previous sprint this builds on
- [[Valorant-Performance-Hub-Project-Status]] — Update status after completion

## Action Items

- [ ] Execute this Claude Code prompt in a Claude Code session
- [ ] Verify build passes and all routes work
- [ ] Update project status doc after Sprint 1 is confirmed working
