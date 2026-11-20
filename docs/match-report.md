# Match report

> Status: all four steps are built (2026-11-20). Steps 1 to 3 are in `main`:
> the numbers, the page with the replay beside it, and the written notes and
> trend (migration `20261120_match_reports.sql`). Step 4, on
> `feature/match-report-tags`, adds one-click tags and the communication
> section. The
> report began as a set of Python scripts in the vault
> (`Valorant/_scripts/match_replay.py`, `match_report_page.py`) that write an
> HTML page per match; this is the same report inside the app.

## 1. What it is

`/report/:matchId` shows what a match's replay says about the player: the
rounds, the positioning, every kill and death as a duel, and the kit. The
replay is pinned beside the text, so a line of the report is one click from
being watched. The review page links to it ("Match report") once the match has
replay data.

The page computes the report in the browser from the minimap bundle the review
page already attaches (`replays.ts`), in about 10 ms. Two things are stored, in
`match_reports` (section 4): what a person wrote about the match, and a few
counts for the trend.

## 2. Layout

Two columns from `lg` up, one below it. The divider between them drags, as on
the review page (`useSplitter`, `side: 'left'`, remembered under
`matchReport.stageWidth`): the replay panel starts at 560 px and can take
everything but 420 px of text.

- **Left, sticky: the stage** (`components/report/ReportStage.tsx`).
  - A match with a synced recording (`vod_reviews.youtube_url` and
    `barrier_drop_offset`): the YouTube player, and under it the minimap
    following the video, exactly as on the review page. A switch picks Video
    and map, Video, or Map; on Map the player is hidden, not unmounted.
  - A match without one: the minimap on a clock of its own
    (`hooks/useReplayClock.ts`) with play, a slider over the round on screen
    and 1×/2×/4×. Buy phases are skipped while playing.
  - The map is a square as wide as its column, so in a wide panel its width is
    held to the height the window has left; the map's round and kill lists
    are below the fold and the panel scrolls to them.
  - `ReplayMinimap` is the review page's component, unchanged except that
    `onNudge` is now optional: without it the "out of step with the video" row
    is hidden.
  - **The map itself is the Plays replay canvas**, here and on the review's
    Map tab: abilities in their shapes, the kill feed, tracers and death marks,
    health, armour and what each agent has left, in the skin and sizes picked
    in Plays. `usePlaysStage(bundle)` builds each frame with the Plays frame
    builder (`frameStep`, `frameMotion`, `killMarks`) and hands
    `ReplayMinimap` a `stage`: the minimap keeps the clock, the rounds, the
    kills list, the layer toggles and the sync nudge, and calls
    `stage.show(t, layers)` instead of drawing its own canvas. Read-only: the
    wheel zooms, a drag pans. When the map cannot be drawn that way (registry
    from the fallback source, with no callouts) the hook returns null and the
    minimap draws itself as before.
- **Right: the text** (`components/report/ReportSections.tsx`). Collapsible
  sections under a bar that stays in view, with Open all and Close all:
  the short version, rounds, positioning, duels, communication, economy, kit,
  trend, next session. Economy and next session appear when notes were written
  for them, the trend when two or more games have stored counts, communication
  when the linked replay folder has the match's file (section 6).

Every round, duel, notable kill, ability use, written note and finding has a
play button. It calls
`ReportStageHandle.watch(replayMs)`, which seeks the stage to 3 s before the
moment (1 s before a round's barrier drop) and plays. With a recording that
seeks the video, and the map follows. The duels table and the Kit table also
show the video time of each row as a link to `/review/:matchId?t=`.

## 3. The numbers (`lib/matchReport.ts`)

`buildMatchReport(bundle, callouts)` is pure and unit-tested
(`matchReport.test.ts`). Its rules are those of the vault's scripts, and it was
checked against their output on three real matches (Lotus 16 Nov, Bind 17 Nov,
Corrode 18 Nov 2026): every duel and round value agreed, bar one time that
rounds differently at 47.05 s.

| Measure | Rule |
|---|---|
| Speed | distance over the 0.3 s that end 0.1 s before the kill |
| Standing / moving / running | under 150, up to 300, over 300 units a second |
| Aim | angle between the view and the other player 0.15 s before the kill; 38° or more is "off the crosshair" |
| Health | the last reading 1.5 s before the kill |
| Alive, nearest teammate | 0.2 s before the kill |
| Trade | the killer dies to a teammate within 5 s; a trade kill is the mirror |
| Setup, at 0:20 | the nearest callout at 10 s and 20 s after the barrier drop |
| Teammate distance | mean distance to the nearest living teammate, once a second |
| Second life | a round with two deaths; a death by oneself is a second life running out, not a duel |
| Ability use | every cast of C, Q, E or X, with the callout the player stood on |
| Where it went | the thing of theirs the replay records nearest the cast (1 s before to 2 s after), each counted once: a smoke where it stood, a projectile where its track ends |

**Findings** are worked out by fixed rules from those numbers (kills standing,
deaths moving, rounds survived and won, deaths in won rounds, opening deaths,
trades, untraded deaths, fights taken alone when two down, a callout with three
or more deaths, a lopsided half). Each states a count and its rounds. They are
not a person's judgement and the page says so.

**Notable duels** are the five kills that score highest on: last alive and the
round won, a trade, won on 40 HP or less, the opening kill, outnumbered, 25 m
or more, standing on a running target.

The loadout column comes from `match_rounds` (Henrik); a match with no rows
there shows a dash. Armour at the barrier drop comes from the bundle's vitals.

## 4. Written notes and the trend (`match_reports`)

Migration `supabase/migrations/20261120_match_reports.sql`: one row per match of
a user, `notes jsonb` and `summary jsonb`, RLS own rows only. The page works
without the table (`matchReports.ts` treats a missing table as nothing written)
and says under the short version that the migration has not been run.

- **`notes`** is what a person wrote: the vault's `notes.json` for the match
  (`lede`, `works`, `work`, `paths`, `path_fixes`, `best_duels`, `positioning`,
  `duels`, `economy`, `kit`, `next`). `matchReportNotes.ts` reads it tolerantly
  and turns `<b>` into `**bold**`, the only markup the page renders. The
  communication block is not stored: voice transcripts stay on the PC.
- **On the page** written notes come first in each section and the rule-based
  findings stay under them ("What the rules found"). A note about a round has a
  play button; a best duel plays from its second of the round.
- **`summary`** is twelve counts from `buildMatchReport` (version 1). The page
  saves it the first time a match's report is opened, without touching `notes`,
  then reads the trend: the last six games of the same mode with a summary, up
  to the one on screen.

Notes are written per match outside the app and inserted with SQL
(`Valorant/_scripts/match_valmaster_report.mjs` in the vault builds the upsert
from a match's `notes.json`). There is no editor for them in the app.

## 5. Tags from the duels (`matchReportTags.ts`)

The Duels section has one button, "Tag kills and deaths on the video". It is
enabled when the match has a synced video, because a moment tag is keyed to a
video second (`moment_tags.video_ts`, `review_type` 'vod', `review_id` the
match id).

- Each duel calls for KILL or DEATH, ATTACK or DEFENSE, the site (A, B, C, or
  MID) read from the callout, and the callout's own name in capitals (so a
  vocabulary with "A SHORT" gets that too).
- Tags are found by name in the user's vocabulary, whatever the case. A name
  that is missing is skipped and listed under the button; none is created. A
  callout with no tag of its name is the usual case and is not listed.
- A tag sits 5 s before its duel. A death takes the `note_id` of the review
  note at that second, when there is one. A kill moves to the next second free
  of notes, since a tag at a note's second belongs to that note.
- A tag of the same name within one second on the review counts as already
  there, so a second press, or tags put on earlier by a script on another
  clock, are never doubled. The count of those is shown.

`planDuelTags` is pure and tested; `matchReportTagging.ts` reads the
vocabulary, the review's tags and notes, and inserts the plan's rows.

Where they show: a kill's tags have no note, so the review's notes list did
not show them. The review's tag chips are now a multi-select filter
(`tagFilter.ts`, `TagFilterBar`): any number of tags, matched as "all" (KILL
and B and DEFENSE) or "any" (KILL or DEATH). Under a filter the notes list is
followed by the tagged moments that have no note (`LooseMomentList`), each a
time to jump to with its round and tags, and the timeline lane dims every tag
of a moment the filter does not keep. The same filter is on Pro Study.

## 6. Communication (`matchComms.ts`, local only)

What was said in a match never goes to Supabase. The vault's
`match_valmaster_comms.py` writes `comms.v1.json` beside the match's bundle, in
`<first 8 of the match id>-derived/` of the replay folder. `useMatchComms`
finds that folder through the link the Match Library already keeps
(`replayFolder.ts`, File System Access API), reads the file with
`readReplayFolderFile` and parses it in the page. There is no table for it and
the folder sync uploads only minimap bundles.

- No linked folder, or no file for the match: the section is not shown.
- Linked but the browser wants access confirmed (once per session): the section
  shows one button, "Reconnect the replay folder".
- With the file: the written verdict, four counts (share of lines, calls
  checked that were right, deaths followed by information, words by phase),
  what the calls do well and miss, each checked call against where the enemies
  were, and every line by round. Calls and lines have play buttons.

File shape, schema 1: `matchId`, `mine` (`lines`, `words`, `wordsByPhase`,
`swears`), `team.lines`, `afterDeath[]` (`round`, `useful`), `checks[]`
(`round`, `t`, `text`, `then`, `later`, `verdict`), `lines[]` (`round`, `t`,
`who`, `text`), `notes` (`verdict`, `works`, `work`). Times are seconds after
the round's barrier drop.

## 7. Not built yet

- An editor for the written notes.
- Economy beyond the loadout value (weapon, credits left, the teams' averages)
  is in Henrik's match record but not in `match_rounds`.
- Tags for a match with no video: there is no clock to key them to.

## 8. Checking it

`npm test` covers the numbers. For the page, open `/report/<match id>` on a
match with replay data: one with a synced video (the stage is video and map)
and one without (map and clock). A play button in the duels table should move
the stage to that round and play.
