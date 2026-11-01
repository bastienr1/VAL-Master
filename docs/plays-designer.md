# Plays — the set-play designer

> Status: built on branch `feature/plays-designer` (2026-11-01). This is the spec
> the build followed and the contract between the pieces. Section 10 lists what
> still has to be done by hand before the feature works end to end.

## 1. What it is

A mode where the user writes a play in plain words — the map, the side, the comp
and what each agent is expected to do — and the app draws it on the minimap:
agents at callouts, movement arrows, utility (smokes, flashes, recon, mollies,
walls, traps), the spike, and expected enemy positions, in phases
(Setup → Execute → Post-plant, or whatever the brief needs). The user then steps
through the phases, drags any marker to correct it, and saves.

The app's existing **Playbook** (`/playbook`) is a library of chaptered video
guides imported from the vault. This is different and lives at **`/plays`**:
"Plays" are the user's own set plays. The Playbook index links to it and back.

Not in scope: multiplayer, sharing, per-match linking, timing in seconds,
line-up pixels. A play is a diagram for the team talk and the mental model,
not a replay.

## 2. Where it lives

| Route | Page | Purpose |
|---|---|---|
| `/plays` | `PlaysIndex` | Every saved play, grouped by map; "New play" |
| `/plays/new` | `PlayDesigner` | Blank designer: pick map + side, write the brief, compose |
| `/plays/:id` | `PlayDesigner` | A saved play: view, step phases, edit, recompose, save |

Nav: `/plays` counts as IMPROVE in `TopNavModeBar` (add the prefix). The
IMPROVE hub (`/improve`) gets a "Plays" row of `HubCard`s before the Playbook
row. `PlaybookIndex` header gets a small link "Set plays →" and `PlaysIndex`
gets "Guides →" back.

## 3. Data

### 3.1 Table `plays` (migration `supabase/migrations/20261101_plays.sql`)

```sql
create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  map text not null,            -- display name, as `playbooks.map`
  map_uuid text,                -- Riot UUID when the registry resolved it
  side text not null check (side in ('attack', 'defense')),
  comp text[] not null default '{}',   -- agent display names, up to 5
  brief text not null default '',       -- the user's own words
  play jsonb,                           -- PlayDoc (section 4); null until composed
  composed_with text,                   -- model id of the last compose, null when hand-made
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plays_user_map_idx on public.plays (user_id, map);
```

RLS on, owner-only, in the style of `20261002_art_slots.sql` (four policies on
`user_id = (select auth.uid())`). Header comment in the file as the other
migrations have: the project has no CLI link, migrations are run by hand in the
SQL editor and kept as the record. `notify pgrst, 'reload schema';` at the end.

### 3.2 Types (`src/lib/types.ts`)

```ts
export type PlaySide = 'attack' | 'defense'
export interface Play {
  id: string
  user_id: string
  title: string
  map: string
  map_uuid: string | null
  side: PlaySide
  comp: string[]
  brief: string
  play: PlayDoc | null
  composed_with: string | null
  created_at: string
  updated_at: string
}
```

`PlayDoc` lives in `src/lib/playDoc.ts` (section 4) and is re-exported from types.

### 3.3 Store (`src/lib/plays.ts`)

Same shape as `savedDrills.ts` / `weeklyPlanStore.ts`: `listPlays()` newest
first, `playsResource = scopeToUser(createResource(listPlays))`, `getPlay(id)`,
`createPlay(input)`, `updatePlay(id, patch)`, `deletePlay(id)`. Every write
invalidates the resource. RLS filters by owner, so no `user_id` filter is needed
in queries, but inserts rely on the column default.

## 4. The play document (`src/lib/playDoc.ts`)

Pure TypeScript, no React, unit-tested with `node:test` like the rest of `src/lib`.

```ts
export const PLAY_DOC_VERSION = 1

/** Where something is on the map. Resolved to image units (u, v in 0..1) by `resolvePos`. */
export interface PlayPos {
  /** A callout as valorant-api names it: "A Main", "Heaven", "Mid Catwalk", "Attacker Side Spawn". */
  callout?: string
  /** Optional second callout: the point is `t` of the way from `callout` to `toward` (default 0.5). */
  toward?: string
  t?: number
  /** Image units, set when the user dragged the marker or when no callout fits. Wins over callout. */
  u?: number
  v?: number
}

export type UtilityKind =
  | 'smoke' | 'flash' | 'molly' | 'recon' | 'wall' | 'trap' | 'drone' | 'stun' | 'ult' | 'other'

export interface PlayActor {
  /** Agent display name as the registry knows it ("KAY/O", "Killjoy"). */
  agent: string
  at: PlayPos
  /** Where the agent goes during this phase; drawn as an arrow from `at`. Optional waypoints in `via`. */
  moveTo?: PlayPos
  via?: PlayPos[]
  /** One short line: what this agent does in this phase. */
  note: string
  /** The spike carrier this phase (attack only). */
  spike?: boolean
}

export interface PlayUtility {
  agent: string
  kind: UtilityKind
  /** "Heaven smoke", "Flash over A Main". */
  label: string
  at: PlayPos
  /** Where it is thrown from, when it matters (recon darts, mollies). Drawn as a thin line. */
  from?: PlayPos
  /** World cm radius for area utility; the renderer has defaults per kind. */
  radius?: number
}

export interface PlayMarker {
  kind: 'enemy' | 'spike' | 'note'
  at: PlayPos
  label?: string
}

export interface PlayPhase {
  id: string                 // 'setup', 'execute', 'post-plant', or a slug of the name
  name: string               // "Setup", "Execute", "Post-plant", "Retake"…
  /** One or two sentences: what this phase is about and what has to be true before it starts. */
  caption: string
  actors: PlayActor[]        // exactly one entry per agent in the comp
  utility: PlayUtility[]
  markers: PlayMarker[]
}

export interface PlayDoc {
  version: 1
  /** One line for the card. */
  summary: string
  comp: string[]             // 5 agent names, the order used everywhere
  phases: PlayPhase[]        // 2 to 5
  /** What the composer guessed because the brief did not say it. Shown to the user. */
  assumptions: string[]
}
```

Functions:

- `parsePlayDoc(raw: unknown): PlayDoc` — validates and normalizes anything that
  came from the model or the database. Throws `PlayDocError` with a sentence a
  user can read. Normalizes: trims strings, clamps `t` to 0..1, drops unknown
  utility kinds to `'other'`, dedupes comp, gives phases ids, fills missing
  arrays, caps phases at 5 and comp at 5. Every actor's `agent` must be in `comp`.
- `resolvePos(pos: PlayPos, map: GameMapCallouts): [u, v] | null` — `u/v` win;
  else the callout(s) through `findCallout`; null when nothing resolves.
- `findCallout(name: string, callouts: MapCallout[]): MapCallout | null` — tolerant:
  case-insensitive; accepts "A Main", "Main A", "a-main", "A main"; a bare region
  name ("Heaven") matches when unique across super-regions, else the first in
  this order: the site named earlier in the same phase is not known here, so
  prefer "A" then "B" then "C" then "Mid"; "Attacker Spawn", "Attack Spawn",
  "T spawn" → the Attacker Side Spawn; same for defenders. Strip "the" and
  trailing "site".
- `calloutViewport(callouts, transform, margin = 0.06): Viewport` — the square
  of the minimap image that contains every callout plus a margin, so the map
  fills the canvas like `playedViewport` does for replays.
- `worldToImage` is reused from `replayScene.ts`.
- `emptyPlayDoc(comp: string[]): PlayDoc` — three phases, every agent at the
  attacker or defender spawn, for a hand-made play.

### 4.1 Callouts in the registry (`src/lib/gameContent.ts`)

`GameMap` gains `callouts: MapCallout[]` where
`MapCallout = { region: string; superRegion: string; name: string; x: number; y: number }`,
`name` = `"${superRegion} ${region}"` collapsed ("A Main", "Mid Top", "Attacker Side Spawn").
Source: valorant-api `callouts[]` (`regionName`, `superRegionName`,
`location.x/y`, world cm). The Supabase `game_content` cache stores the raw
payload, so it carries them already; the Henrik fallback has none (empty array).

## 5. The composer (Supabase Edge Function `compose-play`)

`supabase/functions/compose-play/index.ts`, Deno, deployed through the Supabase
dashboard/MCP (the project has no CLI link). `verify_jwt` on. Secret
`ANTHROPIC_API_KEY`. The function:

1. Reads `{ map, side, brief, comp?, callouts: string[], previous?: PlayDoc }`.
   `callouts` are the names from section 4.1 for that map; `previous` is the
   current doc when the user recomposes after edits, so positions they dragged
   are kept where the brief did not change.
2. Calls the Anthropic Messages API, model `claude-opus-5-5`, through the
   official SDK (`npm:@anthropic-ai/sdk`): `client.beta.messages.create` with
   `output_config: { effort: 'medium', format: { type: 'json_schema', schema } }`
   where the schema is the PlayDoc shape, plus the server-side refusal fallback
   (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`). No
   `thinking` (always on for this model), no `temperature`, no forced
   `tool_choice` (rejected by this model). `max_tokens` 16000. A `stop_reason`
   of `refusal` or `max_tokens` is a 502, not a play.
   System prompt: a Valorant coach who places agents only on the listed
   callouts, writes terse notes, splits into phases, names the spike carrier on
   attack, marks likely enemy positions as `enemy` markers only when the brief
   implies them, and lists every guess in `assumptions`.
3. Returns `{ play: PlayDoc, model: string }` or `{ error: string }` with a
   proper status (400 bad input, 401 no user, 502 model failure, 503 when the
   secret is missing: "The composer is not set up: add ANTHROPIC_API_KEY to the
   Edge Function secrets.").
4. CORS headers for the browser (`OPTIONS` preflight).

Client: `src/lib/composePlay.ts` → `composePlay(input): Promise<{ play: PlayDoc; model: string }>`
via `supabase.functions.invoke('compose-play', { body })`, running the result
through `parsePlayDoc`, and mapping errors to one readable sentence.

## 6. The minimap (`src/components/PlayMinimap.tsx`)

SVG, not canvas: markers are few, static per phase, and need hover, selection,
drag and CSS transitions. `viewBox="0 0 1000 1000"`, square, fills its container.

Layers, bottom to top:

1. Backdrop `#0A0E17`, then the map `displayIcon` image cropped to
   `calloutViewport` (via `<image>` with a `clipPath`, or `preserveAspectRatio`
   + viewBox offset), `opacity 0.9`. No rotation: the published orientation is
   what players know from the in-game map and Valoplant.
2. Callout labels, `#64748B`, 22px in viewBox units, `font-family: Inter`, only
   when `showCallouts` is on (toggle above the map, default on while composing a
   new play, off when viewing).
3. Utility, by kind: smoke = filled circle `rgba(203,213,225,0.34)` radius
   380 cm default; molly = `rgba(249,115,22,0.35)` 260 cm; wall = thick rounded
   line `rgba(125,211,252,0.7)` 24px when `from` exists, else a 90 cm circle;
   flash/stun = a 6-ray starburst outline, `#FFCA3A`, 70 cm; recon = ring
   `#c084fc` 80 cm with a dashed `from` line; trap = diamond `#FFCA3A`;
   drone = small square `#94A3B8`; ult = ring in the agent's colour with a
   dashed outline; other = dotted ring `#94A3B8`. Every utility has a 20px
   label below it in `#CBD5E1` at `opacity .85`, hidden when the map is narrower
   than 360 px.
4. Paths: `via` + `moveTo` as a polyline from `at`, stroke `#53CADC` 7px, round
   joins, arrowhead marker; an `enemy` marker's path, if any, in `#FF4655`.
5. Spike marker: the triangle from `ReplayMinimap` in `#FFCA3A`, with the
   site letter if the callout's super-region is a site.
6. Enemy markers: a `#FF4655` ring with a "?" and the label.
7. Actors: a 44px circle, `#0A0E17` fill, agent `displayIcon` clipped inside,
   ring `#53CADC` 5px; the spike carrier gets a small `#FFCA3A` dot top-right;
   the selected actor gets a second white ring; hovered or selected shows a
   label with the agent name and note under the marker.

Interaction (props):

```ts
interface PlayMinimapProps {
  map: GameMap                  // with transform and callouts
  doc: PlayDoc
  phaseIndex: number
  selected: { kind: 'actor' | 'utility' | 'marker'; index: number } | null
  onSelect(sel: PlayMinimapProps['selected']): void
  /** Called at the end of a drag with the new image-unit position. Absent = read-only. */
  onMove?(sel: NonNullable<PlayMinimapProps['selected']>, pos: { u: number; v: number }): void
  showCallouts: boolean
}
```

Drag with pointer events on the marker group (`setPointerCapture`), converting
client px → viewBox → image units through the viewport. A tap selects; a move of
more than 4 px starts a drag. Positions animate between phases with
`transition: transform 450ms cubic-bezier(.2,.8,.2,1)` on the marker groups
(use `transform: translate()` on `<g>`, not `cx/cy`), so stepping phases shows
the agents walk; the user can switch that off with `prefers-reduced-motion`.

Unresolvable positions (callout unknown) are not drawn; the component reports
them through `onUnresolved?(names: string[])` so the page can show
"Could not place: Catwalk Boxes" under the map.

## 7. The designer page (`src/pages/PlayDesigner.tsx`)

Layout, desktop (`lg:`): two columns `minmax(0,1.25fr) minmax(0,1fr)`, gap 6.
Phone: one column, map first.

Header row: back link to `/plays`, editable title (an input styled as a heading,
as the playbook `name` edit does), map and side chips, the comp as five agent
icons (`agentIconUrl`), Save button (disabled while nothing changed, "Saved"
flash after), Delete in an overflow for saved plays.

Left column:
- Phase stepper above the map: a Play/Pause button (steps every 1.8 s, loops),
  then one pill per phase `N Name`; ← / → keys when the map area has focus.
- `PlayMinimap`.
- Below the map: a legend row for the kinds present in this phase, the
  "callouts" toggle, and "Could not place: …" when any.

Right column, stacked cards (`bg-bg-card border border-bg-elevated rounded-xl p-4`):
1. **Brief**: map select (registry names), side toggle Attack/Defense, a
   textarea (min 6 rows, placeholder: "Ascent attack, comp Omen Sova Jett KAY/O
   Killjoy. Default A: Sova recon from A Main, Omen smokes Heaven and
   Generator…"), a **Compose play** button (`Sparkles` icon, val-cyan style
   like Load Latest) with the model's name underneath after a compose, and the
   recompose hint "Edits to positions are kept where the brief did not change".
   While composing: the button spins and the map dims. Errors in a
   `val-red/10` box under the button, as `PlaybookIndex` shows errors.
   When the function returns 503 (no key), the box says so and offers
   "Start blank" which fills `emptyPlayDoc` so the user can place agents by hand.
2. **This phase**: `N · Name`, caption (editable textarea on focus), then one
   row per actor: agent icon, name, note (click selects the actor on the map;
   the note is an inline-editable input), the spike dot for the carrier.
   Under them, the utility list for the phase with kind chips and a remove ×.
   "Add utility" opens a tiny form (agent, kind, label) that drops it at the
   actor's position for dragging into place.
3. **Assumptions** (only when any): a muted list.

State: the doc is local state; `dirty` compares against the last saved JSON.
Save writes `title, map, map_uuid, side, comp, brief, play, composed_with`.
`/plays/new` saves with `createPlay` and navigates to `/plays/:id`.

Compose flow: validates map + side + non-empty brief, calls `composePlay` with
the map's callout names and the current doc as `previous`, replaces the doc,
sets `comp` from it, selects phase 0, turns callouts on.

## 8. The index page (`src/pages/PlaysIndex.tsx`)

Header like `PlaybookIndex`: "Plays" / "Your set plays, drawn on the map" and a
**New play** button → `/plays/new`. Body: for each map that has plays (sorted by
name), a section with the map name and a grid of cards (`sm:grid-cols-2
lg:grid-cols-3`): `mapImageFor` art as a 2:1 background with the usual scrim,
title, side chip, the five agent icons, the summary line, updated date. Empty
state: the dashed `EmptyLine` style from `Improve.tsx`: "Write your first play:
the map, the comp, and what each agent does. Claude draws it on the minimap."

## 9. Build order

| # | Task | Tier | After |
|---|---|---|---|
| 1 | Foundation: migration, types, store, playDoc + tests, registry callouts | careful | — |
| 2 | Composer: edge function + client | careful | 1 |
| 3 | PlayMinimap renderer | careful | 1 |
| 4 | Plays index, routes, nav, Improve row | medium | 1 |
| 5 | Designer page | careful | 1, 2, 3 |

Gates for every task: `npm run build`, `npm test`, `npm run lint` clean of new
warnings. No new dependencies.

## 10. Status (2026-11-01)

Switched on and verified end to end in the signed-in app: the `plays`
migration is applied, `compose-play` (version 2, JWT on) has its
`ANTHROPIC_API_KEY`, and a real brief ("Ascent attack, A split default…")
came back from `claude-opus-5-5` as three phases with notes, smokes, a recon
dart, a flash, a trap, paths and five assumptions, in about 40 seconds. Saving
created the row, reloading `/plays/:id` drew it again, and the card shows on
`/plays` and on the Improve hub.

Known gaps: no leave-page warning for unsaved edits (BrowserRouter has no
`useBlocker`); the spike marker can hide under an agent standing on the plant
spot; `apply_migration` and secret creation must be done from the Supabase
dashboard, since the Claude Code permission classifier blocks both.
