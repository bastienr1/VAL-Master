# Plays editor v2 — canvas first, Valoplant style

> Status: built on `feature/plays-designer` (2026-11-04); section 7 has the verified status. Supersedes the
> page layout and the document shape of `plays-designer.md` sections 4, 6, 7
> and 8a; what that file says about data (3), the composer (5) and the index (8)
> still holds unless this file says otherwise. Every build task reads this file;
> its brief says which sections it owns.

## 1. What changes and why

The first designer put the brief and cards first and the map second. The user
wants the opposite, the way Valoplant works: the map fills the screen, you place
agents from a strip of portraits and their real abilities from a popover, you
draw on it, and the play is a sequence of steps you walk through. The written
brief and the Claude composer stay, in a drawer on the right.

What was studied on valoplant.gg (2026-11-04): a left rail with map + side,
"Sequence" steps 1–10 with a play button and speed, "Delete" (everything / this
step / by kind), "Tools" (pen, eraser, text, image, markers), a bottom strip of
agent portraits with a role filter (keys 1–4) and an Ally/Enemy switch; clicking
a portrait places the agent and opens its abilities; clicking an ability then
the map places it as a shape in the agent's colour; a step keeps what the
previous step had; the map art is teal lines on navy.

## 2. Layout

Full height under the app header (`h-[calc(100vh-57px)]`, the header is 57 px),
a grid of three columns and a bottom row:

```
┌──────────┬────────────────────────────────────┬──────────┐
│ rail     │ canvas                             │ drawer   │
│ 112 px   │ fills the rest, square map centred │ 0/360 px │
│          │                                    │          │
├──────────┴────────────────────────────────────┴──────────┤
│ agent strip, 64 px                                       │
└──────────────────────────────────────────────────────────┘
```

Above the grid, one 44 px toolbar: back link, title input, map + side chips,
undo / redo, "Brief" toggle (opens the drawer), Save, delete menu.

Under `lg` the rail becomes a horizontal row above the canvas, the drawer a
full-width sheet below it, the strip stays at the bottom.

### 2.1 Rail (`src/components/play/EditorRail.tsx`)

Top to bottom, all labels `text-[10px] uppercase tracking-widest text-text-secondary`:

- Map select + side toggle (ATK red / DEF cyan), compact.
- **Steps**: a 5-column grid of numbered buttons, the active one filled
  `bg-val-cyan text-bg-primary`, then a dashed `+` (cap 10). Under them a
  ▶/⏸ button and a speed slider (0.5 s – 3 s per step, default 1.8 s), and the
  active step's name as an inline-editable input (`Setup`, `Execute`…).
  Right-click or a small × on a step removes it (confirm when it has elements).
- **Tools**: a 4-column grid of icon buttons, active one filled cyan:
  Select (V), Pen (P), Arrow (A), Text (T), Eraser (E), then markers Spike,
  Enemy (?), Pin. Hover title shows the name and key.
- **Clear**: "This step" and "Everything" (confirm).

### 2.2 Canvas (`src/components/PlayCanvas.tsx`)

Replaces `PlayMinimap.tsx` (delete it and its exports; `playScene.ts` is
rewritten for v2, see section 4). The svg fills the whole middle column; the
map lives in a 1000-unit square cropped to its callouts and turned by
`sceneTurns` as before, and the viewBox is a rectangle with the column's aspect
(`viewBoxFor`): at 100% the square fits on the shorter side, centred on the
longer one; zoomed in, the view is clamped inside the square so the map runs
edge to edge and panning reveals the rest.

Map art: the Riot `displayIcon` drawn through an SVG filter that turns its grey
walls teal on the navy backdrop (`#0B1220`): `feColorMatrix` mapping luminance
to about `#2BB3C9`, then the image at opacity 0.85. Callout labels `#5B8A98`,
22 px, with the dark halo; a "Callouts" toggle in the toolbar.

Elements per step (section 3), drawn bottom to top: pen strokes, abilities,
arrows, agent move paths, markers, text, agents, selection. Agents are
**square** portrait tiles (44 px, `rx 6`, `#1A1F2E` fill, 3 px ring: ally
`#53CADC`, enemy `#FF4655`, spike carrier `#FFCA3A`), the registry
`displayIcon` clipped inside; a 3-letter disc fallback. Abilities: shape by
`shape` (section 4) in the agent's first gradient colour at 0.35 alpha with a
1.5 px ring in the same colour at 0.9, the ability's `displayIcon` 18 px at the
centre when the registry has it; `from` draws a dashed line. Pen: polyline
through the points, `stroke-linejoin round`, 5 px, in the element's colour
(default white). Arrow: 6 px with the arrowhead marker. Text: 24 px white with
halo. Markers as before (spike triangle, red `?` ring, pin = `MapPin` shape in
`#FFCA3A`).

Props:

```ts
interface PlayCanvasProps {
  map: GameMap
  side: PlaySide
  step: PlayStep
  /** The previous step, when any: its agents are drawn as faint ghosts so a move reads. */
  previous: PlayStep | null
  tool: Tool                               // 'select' | 'pen' | 'arrow' | 'text' | 'eraser' | 'spike' | 'enemy' | 'pin'
  /** An ability waiting for a click on the map (from the strip popover). */
  pending: { agent: string; slot: AbilitySlot } | null
  selectedId: string | null
  showCallouts: boolean
  animate: boolean                         // false while scrubbing fast
  onSelect(id: string | null): void
  /** Every edit of the step goes through here, as a new step object. */
  onChange(step: PlayStep): void
  /** Pen/arrow/text/marker/ability placements call this with the new element appended. */
  onPendingDone(): void
  onUnresolved?(names: string[]): void
}
```

Interaction with the select tool: click an element to select it; drag moves it
(agents, abilities, markers, text: `at`; arrows: both ends by their handle,
or the whole arrow by its body; pen: the whole stroke). Delete / Backspace
removes the selection (the page handles the key, the canvas only reports
selection). Pen: pointerdown–move–up draws; points sampled every 6 px, stored
as `u/v`. Arrow: drag from → to. Text: click places an element with text
"Text" selected, and the page shows an inline input over it (the canvas
renders the text; editing is in the page's floating input positioned by
`onSelect`'s element bounds, or simplest: the canvas renders a
`<foreignObject>` input while the text element is selected and the tool is
select or text). Eraser: click removes the element. Spike / Enemy / Pin: click
places. Pending ability: click places `{kind:'ability', agent, slot, shape,
radius}` at the click, then `onPendingDone()`.

Agents moved between steps animate (`transform` transition 450 ms) keyed by
element id; everything else is redrawn. A ghost of the previous step's agent
positions at 0.25 opacity when `previous` is given and the position differs.

Every element gets a stable id (`crypto.randomUUID()` or a short random
string); copying a step keeps ids so the animation and the ghost line up.

#### Zoom and pan

The canvas zooms from 1× to 6×. The wheel over the map zooms about the
pointer (the page must not scroll); `+` / `-` / `0` keys and a small overlay
at the canvas' top-right (−, the percentage, +, and a reset button that
appears when zoomed) do the same about the centre. When zoomed, dragging the
empty map with the Select tool pans, as does a middle-button drag or a drag
with Space held under any tool; the view is clamped to the map. Zoom is view
state only (never saved; reset when the map changes). Marker and label sizes
are in viewBox units, so they grow with the zoom; the label-hiding rule uses
the rendered width times the zoom.

### 2.3 Agent strip (`src/components/play/AgentStrip.tsx`)

A row of 40 px portrait tiles (`displayIcon`, gradient backdrop, `rx 4`) for
every registry agent, sorted by role then name, with on the left the role
filter chips All / Duelist / Initiator / Controller / Sentinel (keys 1–4 when
no input is focused) and on the right the Ally / Enemy switch. A tile whose
agent is already on the map in this step is ringed (cyan or red by team);
clicking it selects that agent on the map and opens the ability popover;
clicking an unplaced tile places the agent at the map centre (`u/v` of the
viewport centre), adds it to `comp` when ally and the comp has room, selects
it and opens the popover. Hover shows the name.

Ability popover (`src/components/play/AbilityPopover.tsx`): floats above the
strip, centred under the canvas: four 40 px buttons (C, Q, E, X in Riot order
Grenade → Ability1 → Ability2 → Ultimate… use the registry's own order) with
the ability icon and the key letter, a title with agent · ability name on
hover, and a dim count of how many of that ability are already placed this
step. Clicking one sets `pending` (the button stays lit until the map is
clicked or Escape).

### 2.4 Drawer (`src/components/play/BriefDrawer.tsx`)

360 px, `bg-bg-card border-l border-bg-elevated`, scrollable, closed by default
on a saved play that has elements, open on a new play. Sections:

1. **Start from a template** strip (as 8a, v2 steps) while the play has no elements.
2. **Brief**: textarea, Compose button, model line, errors, as before.
3. **This step**: caption textarea; a list of the ally agents on the map this
   step with their note input and the spike dot; the abilities placed this step
   with a remove ×.
4. **Assumptions** when any.

### 2.5 Toolbar and page (`src/pages/PlayDesigner.tsx`)

Rewritten around v2. State: `doc` (v2), `stepIndex`, `tool`, `pending`,
`selectedId`, `team` (ally/enemy for placement), `drawerOpen`, `showCallouts`,
`playing`, `speedMs`, plus the load/save/compose state that exists today.
History: an undo stack of docs (cap 50) pushed on every committed change
(`commit(next)`), Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z). Keys: V P A T E for
tools, Escape clears pending and selection, Delete removes the selection,
← → change step, Space toggles playback, 1–4 role filter; all ignored inside
inputs. Adding a step copies the active step (ids kept) and names it from the
side's default sequence when the index has one (attack: Setup, Execute,
Post-plant; defense: Setup, Hold, Retake), else `Step N`.

Save writes `play` as v2. Loading a v1 row runs `migratePlayDoc` (section 3).

### 2.6 Playbook panel (`src/components/play/PlaybookPanel.tsx`)

A second side panel, on the left between the rail and the canvas, so a play
can be drawn while watching the vault guide for that map. Toggled by a
"Playbook" button in the toolbar next to Brief; closed by default, the choice
remembered in `localStorage` (`plays.playbookOpen`). 400 px on `lg`
(`bg-bg-card border-r border-bg-elevated`, scrollable); under `lg` a
full-width block above the canvas. The grid becomes
`lg:grid-cols-[112px_auto_minmax(0,1fr)_auto]` (rail, playbook, canvas, drawer),
the strip row spanning all four.

Top to bottom:

1. Header "Playbook" and a `<select>` of the signed-in user's playbooks for the
   current map (`usePlaybooks({ map })`), labelled by `name` with the side in
   brackets when set; the pick is remembered per map in `localStorage`
   (`plays.playbook.<map>`), default the newest. With none: "No playbook for
   {map} yet. Import one from the vault on the Playbook page." with a link to
   `/playbook`.
2. The video: a 16:9 box mounting `useYouTubePlayer(extractYouTubeId(video_url))`;
   when `embedBlocked`, a "Watch on YouTube ↗" row instead; when the playbook
   has no `video_url`, a muted line.
3. A transport row: play/pause, −5 s, +5 s, `formatTime(currentTime)` /
   `formatTime(duration)`, and "Open in Playbook ↗" to
   `/playbook/<slug>?chapter=<active chapter number>`.
4. The chapters: `PlaybookChapterList` with `usePlaybookChapters(playbook.id)`,
   `activeChapterId` = the chapter whose `[start_seconds, end_seconds)` holds
   `currentTime` (the innermost when nested), `onChapterSelect` → seek to its
   start, `onMomentSelect` → seek to the moment, `activeSeconds = currentTime`,
   `totalSeconds = video_duration_seconds`.

Keyboard: the page's shortcuts (Space, arrows, letters) must not fire while the
focus is inside the panel (`data-playbook-panel` on its root; the key handler
ignores targets inside it), so Space on the player's buttons does not also
toggle the step playback.

### 2.7 From a replay

A round of one of the user's own matches, taken from the attached minimap
bundle (`match_replays` + the `replays` bucket, see `src/lib/replayBundle.ts`),
becomes the starting play: "I played this comp; load the round and edit it
into the next strategy."

**Conversion** (`src/lib/replayToPlay.ts`, pure, tested):
`roundToPlay(bundle, roundNumber, lookup, transform)` where `lookup` maps an
agent UUID to `{ name, abilities: { slot, name }[] } | null` (built from the
registry by the caller) and `transform` is the map transform. It returns
`{ doc: PlayDoc, side: PlaySide, mapUuid, title, brief }`:

- Snapshot times, in replay ms, become the steps: barrier drop (`barrierMs`,
  else `buyStartMs + 30 s`) → "Barrier drop"; the first kill of the round
  after it → "First contact"; the plant → "Plant"; the round end (`endMs`,
  else the last kill, else barrier + 100 s) → "End". Times closer than 4 s to
  the previous one are dropped; at least barrier and end remain. Captions give
  the time since the barrier ("0:12 after barrier").
- Per step, every player present and alive at that time (`playerStateAt`,
  `isPresentAt`, `isAliveAt` from `replayScene.ts`) is an `agent` element:
  name from `lookup` (else "Agent"), `team` ally for `ALLY`, enemy for
  `ENEMY`, `at` as image units (`worldToImage`, clamped to 0..1), `moveTo` the
  position at the next step's time when alive then and moved more than 2 % of
  the image, `spike: true` for the carrier at that time (`spike.carriers`).
  Element ids are stable per player across steps (one id per subject) so the
  editor animates them.
- Casts (`bundle.casts`) with a position, between the previous step's time
  and this one, become `ability` elements: `slot` from the key letter
  (C → Grenade, Q → Ability1, E → Ability2, X → Ultimate; '?n' → null),
  `shape` and `radius` from `abilityShape(agent, slot)`, `label` the ability
  name from `lookup`. Area effects (`bundle.effects`) active at the step time
  that no cast within 3 s and 300 cm explains become `ability` elements with
  `slot: null`, shape by kind (`smoke`, `wall`, `trap`, `slow`,
  `damage_zone` → molly, `recon`; else other) and the owner's agent name.
  Both teams' abilities are kept: the enemy's utility is the intel.
- A plant at or before the step time → a `spike` marker at its position with
  the site letter as label.
- `comp` = the ally agents' names in player order (max 5); `side` from the
  round's `side` (`attacker` → attack), attack when unknown.
- `title` "Round N · <Map> · <recorded date>", `summary` "Round N from the
  replay: <winner> won by <how>", `brief` two lines describing the round so
  a recompose has context.

**Editor** (`src/components/play/ReplayPicker.tsx`, in the Brief drawer under
the templates, also reachable when the play has elements through a "From a
replay" link that confirms replacing): a list of the user's matches that have
a replay (`match_replays` rows for the signed-in user joined client-side with
`matches` by `match_id`: map, agent, result, score, date; newest first; the
current map first), then after a pick the bundle loads (`getReplayBundle`)
and a round grid appears (one button per round: number, ATK/DEF, a win or loss
dot), then **Load round** applies: map and side set from the bundle, the doc
replaced, title and brief filled, drawer stays open. Deep link
`/plays/new?replay=<matchId>&round=<n>` does the same on arrival.

**Review page**: the replay minimap's HUD on the VOD workstation gets an
"Open in Plays" link to that deep link for the round it is showing.

### 2.8 Replay mode

Loading a whole match and watching it in the editor, pausing to change what
the agents do, and keeping the moments that matter as the steps of a strat.
The per-round snapshot import (2.7) stays as "Load round"; this is "Play
match".

**Frame** (`src/lib/replayFrame.ts`, pure, tested; `replayToPlay.ts` is
refactored to build its snapshots from it):
`frameStep(bundle, t, lookup, transform, ids): PlayStep` is the state of the
match at replay time `t` as a step: every present, alive player as an `agent`
element (ally / enemy, image units, spike carrier flagged), no `moveTo`;
area effects active at `t` as `ability` elements (`slot` from a cast of the
same owner within 3 s and 300 cm, else null), casts of the last 2.5 s with a
position as `ability` elements too (flashes and the like have no lasting
effect); the plant of the current round at or before `t` as a `spike` marker.
`ids` is a stable id table per subject, effect and plant, so the canvas can
key markers across frames. Also `roundSpan(round): { start, end }` (buy start
to `endMs`, else the next round's buy start, else `barrierMs + 120 s`),
`roundSide(round): PlaySide` and `formatRoundClock(round, t)` ("R3 · 0:13",
seconds since the barrier, negative during the buy).

**Document**: `PlayStep` gains optional `replayMs?: number` (kept by
`parsePlayDoc` when finite and ≥ 0) and `PlayDoc` gains optional
`replay?: { matchId: string }`, so a saved strat can reopen its match.

**Editor state**: `replay: { matchId, bundle } | null`, `replayMs`,
`replayPlaying`, `replaySpeed` (0.25–4, default 1), `liveStep: PlayStep | null`
(the paused frame once edited), `view: 'replay' | 'steps'`.

**Transport** (`src/components/play/ReplayTransport.tsx`), a 56 px bar between
the toolbar and the canvas while a replay is loaded: round chips (number,
ATK/DEF, win dot; click = jump to that round's barrier drop, paused), a
scrubber spanning the current round (`roundSpan`) with the barrier, kills and
the plant as ticks, play/pause, speed menu, the clock from `formatRoundClock`,
**Capture step**, and **Exit replay**.

**Behaviour**:
- Playing: a `requestAnimationFrame` loop advances `replayMs` by wall time ×
  speed, computes `frameStep` and hands it to the canvas with `animate=false`
  and no `onChange` (read-only while moving). Crossing into the next round
  updates `side` (and so the map's orientation) from `roundSide`.
- Paused: the frame is editable. The first `onChange` copies it into
  `liveStep` with a fresh step id and `replayMs`; further edits go there.
  **Capture step** appends `liveStep` (or the untouched frame) to `doc.steps`
  after the active step, named `formatRoundClock`, caption from the round's
  facts ("R3 · 0:13 · first contact"), and selects it in the rail. Pressing
  play with an uncaptured edited `liveStep` captures it first (a one-line
  toast "Step captured"). Scrubbing or jumping discards an unedited frame
  silently.
- The rail's steps are the captured moments; clicking one pauses the replay
  and shows that step (`view: 'steps'`); a "Back to replay" button in the
  transport (shown in that view) returns to `view: 'replay'` at the step's
  `replayMs` when it has one.
- Save writes the doc as usual with `replay: { matchId }`; a saved strat
  whose doc has `replay` shows an **Open replay** button in the toolbar that
  loads the bundle and enters replay mode at the active step's `replayMs`
  (else round 1's barrier), paused.
- Exit replay keeps the captured steps and drops the live frame.
- Space in replay mode toggles the replay, not the step walk; ← → step
  through captured steps as before, `,` / `.` nudge the replay by 1 s.

**Picker and links**: `ReplayPicker` gets a **Play match** button at the
match level (loads the bundle, enters replay mode at round 1's barrier,
paused) beside the round grid's Load round. `/plays/new?replay=<matchId>`
opens replay mode at round 1; with `&round=<n>` at that round's barrier drop,
paused; `&mode=steps` keeps the 2.7 snapshot import. The review page's "Open
in Plays" link uses the replay form.

## 3. Document v2 (`src/lib/playDoc.ts`)

```ts
export const PLAY_DOC_VERSION = 2
export type AbilitySlot = 'Grenade' | 'Ability1' | 'Ability2' | 'Ultimate'
export type Team = 'ally' | 'enemy'
export type PlayPos = { callout?: string; toward?: string; t?: number; u?: number; v?: number }  // unchanged

export interface AgentElement { kind: 'agent'; id: string; agent: string; team: Team; at: PlayPos; moveTo?: PlayPos; via?: PlayPos[]; note?: string; spike?: boolean }
export interface AbilityElement { kind: 'ability'; id: string; agent: string; slot: AbilitySlot | null; shape: UtilityKind; at: PlayPos; from?: PlayPos; radius?: number; label?: string }
export interface PenElement { kind: 'pen'; id: string; points: { u: number; v: number }[]; color: string }
export interface ArrowElement { kind: 'arrow'; id: string; from: PlayPos; to: PlayPos; color: string }
export interface TextElement { kind: 'text'; id: string; at: PlayPos; text: string; color: string }
export interface MarkerElement { kind: 'marker'; id: string; type: 'spike' | 'enemy' | 'pin'; at: PlayPos; label?: string }
export type PlayElement = AgentElement | AbilityElement | PenElement | ArrowElement | TextElement | MarkerElement

export interface PlayStep { id: string; name: string; caption: string; elements: PlayElement[] }
export interface PlayDoc { version: 2; summary: string; comp: string[]; steps: PlayStep[]; assumptions: string[] }
```

`UtilityKind` stays (`smoke | flash | molly | recon | wall | trap | drone | stun | ult | other`):
it is the *shape*. `parsePlayDoc(raw)` accepts v1 and v2: a v1 document is
converted by `migratePlayDoc` (phases → steps; actors → agent elements, team
ally; utility → ability elements with `slot: null` and `shape: kind`; markers →
marker elements; ids generated) and then validated as v2. Validation rules
carry over: ally agents must be in `comp` (enemies need not), a step needs at
least one element or may be empty (a blank step is allowed now), ids unique
within a step (regenerate duplicates), colours default to `#FFFFFF`, pen
strokes with fewer than 2 points dropped, steps capped at 10, comp at 5.
`emptyPlayDoc(comp, side)` returns v2 with the side's three default steps, the
comp agents at spawn as ally agent elements. New helpers: `newId()`,
`copyStep(step, name)`, `elementAt(step, id)`, `withElement(step, el)`,
`withoutElement(step, id)`.

`resolvePos`, `findCallout`, `calloutViewport` unchanged.

Templates (`src/lib/playTemplates.ts`): same four, emitting v2 steps.

## 4. Abilities (`src/lib/agentAbilities.ts`, registry)

`GameAgent` gains `abilities: { slot: AbilitySlot; name: string; icon: string | null }[]`
from valorant-api `abilities[]` (skip `Passive`), empty from the Henrik
fallback. `agentColor(agent)` = first gradient stop as `#rrggbb`, or `#53CADC`.

`abilityShape(agentName, slot): { shape: UtilityKind; radius: number }` is a
hand-written table for the current pool (world cm). The slot is the one
valorant-api gives (its `slot` is the in-game key: Grenade = C, Ability1 = Q,
Ability2 = E, Ultimate = X), which is authoritative over the slot names in the
examples below; every ability of every playable agent has an entry. Examples: Omen Ability2 Dark
Cover → smoke 380; Omen Ability1 Paranoia → flash 120 (drawn as a stun/flash
burst); Brimstone Ability2 Sky Smoke → smoke 380; Viper Ability2 Toxic Screen →
wall; Viper Ability1 Poison Cloud → smoke 350; Sova Ability2 Recon Bolt →
recon 80; Sova Grenade Shock Bolt → molly 200; KAY/O Ability1 FLASH/drive →
flash 120; Killjoy Grenade Nanoswarm → molly 220; Killjoy Ability2 Alarmbot →
trap; Cypher trips → trap; Jett Ability2 Cloudburst → smoke 240; Phoenix
Ability1 Curveball → flash 120, Ability2 Hot Hands → molly 200, Grenade
Blaze → wall; Sage Grenade Barrier Orb → wall, Ability1 Slow Orb → slow (use
'other' radius 300 until a slow shape exists… add `'slow'` to UtilityKind,
drawn as a pale blue disc); Breach Grenade Aftershock → molly 150, Ability1
Flashpoint → flash, Ability2 Fault Line → stun 400; Skye Ability2 Guiding
Light → flash, Ability1 Trailblazer → drone; Fade Ability1 Seize → molly 300,
Ability2 Haunt → recon; Harbor Ability2 High Tide → wall, Ability1 Cove →
smoke 320; Astra Stars → smoke 320 / stun; Gekko Ability2 Wingman → drone,
Ability1 Dizzy → flash, Grenade Mosh Pit → molly 250; Deadlock Grenade
GravNet → slow 300, Ability1 Sonic Sensor → trap, Ability2 Barrier Mesh →
wall; Iso Grenade Contingency → wall, Ability1 Undercut → stun; Clove Ability2
Ruse → smoke 320, Ability1 Meddle → stun; Vyse Ability1 Shear → trap,
Ability2 Arc Rose → flash, Grenade Razorvine → slow 300; Tejo Ability2
Guided Salvo → molly 250, Ability1 Special Delivery → stun, Grenade Stealth
Drone → drone; Waylay Ability1 Saturate → stun, Ability2 Lightspeed → other;
Chamber Grenade Trademark → trap; Raze Grenade Boom Bot → drone, Ability1
Blast Pack → other, Ability2 Paint Shells → molly 200; Reyna Grenade Leer →
flash; Neon Ability1 Relay Bolt → stun, Grenade Fast Lane → wall; Yoru
Grenade Fakeout → drone, Ability1 Blindside → flash, Ability2 Gatecrash → other;
Hush and Veto, Miks: look them up on valorant-api (`abilities[].description`)
and pick the nearest shape; unknown pairs → `other` 120. Ultimates → `ult`
unless clearly an area (Brimstone Orbital Strike molly 450, Viper's Pit smoke
900, Sova Hunter's Fury wall, Breach Rolling Thunder stun 600, Killjoy Lockdown
stun 900, Astra Cosmic Divide wall, Harbor Reckoning stun 600, Fade Nightfall
stun 500, Skye Seekers drone, Cypher Neural Theft other).

## 5. Composer v2 (`supabase/functions/compose-play/index.ts`, `src/lib/composePlay.ts`)

The function emits v2: `steps[].elements[]` of kinds `agent` (ally, at,
moveTo?, via?, note, spike?), `ability` (agent, slot, shape, at, from?,
label), `marker` (type spike/enemy/pin, at, label?) and `text` (sparingly,
for a call). The request adds `abilities: { agent: string; slot: AbilitySlot;
name: string; shape: UtilityKind }[]` for the comp (built client-side from the
registry + `abilityShape`) so the model names real abilities by slot; the
system prompt lists them under the comp and says to use `slot` + `shape` from
that list and never invent abilities. Element ids are assigned client-side
after parsing (the schema has no `id`). Everything else (auth, errors, model
call) is unchanged. `previous` is the v2 doc.

## 6. Build order

| # | Task | Tier | After |
|---|---|---|---|
| 1 | Document v2: types, parse + migrate, helpers, templates v2, playScene v2, tests | careful | — |
| 2 | Registry abilities + `agentAbilities.ts` table + tests | medium | — |
| 3 | PlayCanvas: rendering, tint, tools, drag, animation | heavy | 1, 2 |
| 4 | Editor shell: toolbar, rail, strip, popover, drawer, page, history, keys | careful | 1, 2 |
| 5 | Composer v2: function schema/prompt, client, redeploy | careful | 1, 2 |

Gates: `npm run build`, `npm test`, `npm run lint` at the 63 baseline, no new
dependencies. Task 4 builds against the `PlayCanvasProps` contract above; if
`PlayCanvas.tsx` is not there yet it creates a placeholder with that contract
that task 3 overwrites.

## 7. Status (2026-11-04)

Built and checked outside the login gate through a throwaway harness: the
full-height teal canvas with rail, strip and drawer; placing Omen from the
strip and his Dark Cover from the popover; pen strokes; adding a step and
undoing it; steps carrying forward. The canvas worker also exercised
select-drag, arrows with end handles, text editing, eraser, markers, ghosts
and the step walk in a harness. Ability colours are lifted toward white
(`liftColor` in the canvas) so dark agents' utility reads on navy.
`compose-play` version 5 is deployed with the v2 schema.

Verified in the signed-in app (2026-11-04): a real v2 compose of an Ascent A
split came back from `claude-opus-5-5` as Setup / Execute / Post-plant with
agents, abilities (Sova dart, Omen smokes, KAY/O flash, Killjoy alarmbot),
paths and assumptions, drawn on the canvas with the drawer notes filled;
saved, reloaded by id, and the earlier v1 play opened through the migration
with its three steps intact; both plays show on the index.

The Playbook panel (2.6) was checked the same day on the Ascent play: the two
imported Ascent guides in the select, the YouTube player mounted, 27 chapter
and moment rows with timestamps, a chapter click seeking the video, the canvas
keeping its size, no console errors.

Both side panels resize by a drag handle (the VOD workstation's splitter;
widths remembered per device, the canvas kept at 420 px or wider, each panel
re-clamped when the other opens), and the callout labels are on by default on
saved plays too, remembered per device, scaling down instead of hiding on a
narrow canvas. Checked in the signed-in app at 1400 px.

Zoom and pan (2.2) checked in the signed-in app: a wheel over the map zoomed
to 182% about the pointer without scrolling the page, a drag panned the view,
the 0 key reset it; Space held to pan no longer toggles playback.

The replay import (2.7) was tried on a real bundle in the signed-in app
(2026-11-06): the picker listed the 27 matches with a replay, Abyss first; the
Lotus match loaded its 26 rounds with sides; round 3 became "Round 3 · Lotus ·
2026-11-06" with Barrier drop, First contact ("0:13 after barrier. Chamber
killed Killjoy.") and End ("0:58 … The enemy won by elimination"), the map
switched to Lotus attack, allies at the bottom with their moves, enemies in
red, abilities drawn.

Replay mode (2.8) was tried on the same Lotus match in the signed-in app
(2026-11-06): the deep link opened round 3 paused at the barrier with both
teams on the map and the 26 round chips; Play advanced the clock, Pause froze
it, a dragged agent and Capture step made "R3 · 0:02" (caption "R3 · 0:02 ·
attack, lost by elimination"), a second capture at 0:06, Save created the
strat, and reopening it offered Open replay.

Not yet verified: the phone layout, touch input and pinch zoom on a real
touch screen.
