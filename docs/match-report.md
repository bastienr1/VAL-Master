# Match report

> Status: step 1 (the numbers) and step 2 (the page, with the replay beside it)
> are built on `feature/match-report` (2026-11-20). Steps 3 and 4 are not. The
> report began as a set of Python scripts in the vault
> (`Valorant/_scripts/match_replay.py`, `match_report_page.py`) that write an
> HTML page per match; this is the same report inside the app.

## 1. What it is

`/report/:matchId` shows what a match's replay says about the player: the
rounds, the positioning, every kill and death as a duel, and the kit. The
replay is pinned beside the text, so a line of the report is one click from
being watched. The review page links to it ("Match report") once the match has
replay data.

Nothing is stored. The page computes the report in the browser from the minimap
bundle the review page already attaches (`replays.ts`), in about 10 ms.

## 2. Layout

Two columns from `lg` up, one below it.

- **Left, sticky: the stage** (`components/report/ReportStage.tsx`).
  - A match with a synced recording (`vod_reviews.youtube_url` and
    `barrier_drop_offset`): the YouTube player, and under it the minimap
    following the video, exactly as on the review page.
  - A match without one: the minimap on a clock of its own
    (`hooks/useReplayClock.ts`) with play, a slider over the round on screen
    and 1×/2×/4×. Buy phases are skipped while playing.
  - `ReplayMinimap` is the review page's component, unchanged except that
    `onNudge` is now optional: without it the "out of step with the video" row
    is hidden.
- **Right: the text** (`components/report/ReportSections.tsx`). Collapsible
  sections under a bar that stays in view, with Open all and Close all:
  the short version, rounds, positioning, duels, kit.

Every round, duel, notable kill and finding has a play button. It calls
`ReportStageHandle.watch(replayMs)`, which seeks the stage to 3 s before the
moment (1 s before a round's barrier drop) and plays. With a recording that
seeks the video, and the map follows. The duels table also shows the video time
of each duel as a link to `/review/:matchId?t=`.

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

## 4. Not built yet

- **Step 3, written judgments and trend.** A `match_reports` table holding the
  notes written per match (the HTML reports' `notes.json`: what works, what to
  work on, best paths, next session) and a few summary numbers so a trend over
  the last games is one query. The rule-based findings stay as the default.
- **Step 4, tags and communication.** A button that applies KILL, DEATH, side
  and site moment tags from the duels list (`addMomentTag`), and a
  communication section that reads `comms.json` from the linked replay folder
  without uploading it.
- Economy beyond the loadout value (weapon, credits left, the teams' averages)
  is in Henrik's match record but not in `match_rounds`.

## 5. Checking it

`npm test` covers the numbers. For the page, open `/report/<match id>` on a
match with replay data: one with a synced video (the stage is video and map)
and one without (map and clock). A play button in the duels table should move
the stage to that round and play.
