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
