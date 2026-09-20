// Map and agent tables used to live here. They are now sourced online — see
// src/lib/gameContent.ts for the registry and the image URL templates.

export const WEAPONS = {
  sidearms: [
    { name: 'Classic', cost: 0 },
    { name: 'Shorty', cost: 150 },
    { name: 'Frenzy', cost: 450 },
    { name: 'Ghost', cost: 500 },
    { name: 'Sheriff', cost: 800 },
  ],
  smgs: [
    { name: 'Stinger', cost: 950 },
    { name: 'Spectre', cost: 1600 },
  ],
  shotguns: [
    { name: 'Bucky', cost: 850 },
    { name: 'Judge', cost: 1850 },
  ],
  rifles: [
    { name: 'Bulldog', cost: 2050 },
    { name: 'Guardian', cost: 2250 },
    { name: 'Phantom', cost: 2900 },
    { name: 'Vandal', cost: 2900 },
  ],
  snipers: [
    { name: 'Marshal', cost: 950 },
    { name: 'Outlaw', cost: 2400 },
    { name: 'Operator', cost: 4700 },
  ],
  heavies: [
    { name: 'Ares', cost: 1600 },
    { name: 'Odin', cost: 3200 },
  ],
}

export const TACTICAL_INTENTS = [
  'Default Comp',
  'Rush Site',
  'Play Time',
  'Slow Play',
  'Fake Execute',
  'Stack',
  'Split Push',
  'Retake',
]

// tracker.gg match reports are keyed by the Riot match UUID alone — no region segment.
export const TRN_MATCH_BASE = 'https://tracker.gg/valorant/match'

/**
 * Pro Study note labels — replication-oriented, unlike the own-match tag types
 * in `tagColors.ts`. Studying a pro is about modeling what to copy, not
 * cataloguing mistakes.
 */
export const REFERENCE_LABELS = ['Replicate', 'Concept', 'Setup', 'Util'] as const

/**
 * Review workstation split — the draggable divider between the video column and
 * the Notes/Debrief rail.
 *
 * The rail is the surface that changes job: thin while watching, wide while
 * studying (two stacked embeds in the Study Dock), somewhere between while
 * writing notes. One fixed width is wrong for all three.
 */
export const RAIL_MIN = 240
/**
 * A sanity bound on a stored value, not a design constraint.
 *
 * `MIN_OTHER_COLUMN` is what actually governs: the divider is bounded by the
 * column opposite it, so either side can take the space. Set this high enough
 * that it never bites on a real display.
 */
export const RAIL_MAX_PX = 4000
/**
 * Pixels reserved for whichever column the divider is *not* sizing.
 *
 * This is what lets either side take over: the rail grows until the video is
 * down to this, and shrinks to `RAIL_MIN` so the video takes nearly everything.
 * A floor rather than zero, so neither side can be dragged into nothing and
 * left there with no content to grab.
 */
export const MIN_OTHER_COLUMN = 280
/** Today's fixed width — nothing moves until the user drags. */
export const DEFAULT_RAIL_W = 430
