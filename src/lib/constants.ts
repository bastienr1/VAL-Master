export const MAP_SPLASH_URLS: Record<string, string> = {
  'Abyss':    'https://media.valorant-api.com/maps/224b0a95-48b9-f703-1571-7f8404bf44ea/splash.png',
  'Ascent':   'https://media.valorant-api.com/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/splash.png',
  'Bind':     'https://media.valorant-api.com/maps/2c9d57ec-4431-9c5e-2571-7f8408f43f74/splash.png',
  'Breeze':   'https://media.valorant-api.com/maps/2fb9a4fd-47b8-4e7d-a969-74b4046ebd53/splash.png',
  'Corrode':  'https://media.valorant-api.com/maps/33cce3e7-4b39-a45c-8c9b-03b238c40e6e/splash.png',
  'Fracture': 'https://media.valorant-api.com/maps/b529448b-4d60-346e-e89e-00a4c527a405/splash.png',
  'Haven':    'https://media.valorant-api.com/maps/2bee0dc9-4ffe-519b-1cbd-7fbe763a6047/splash.png',
  'Icebox':   'https://media.valorant-api.com/maps/e2ad5c54-4114-a870-9a90-8f8f0db1c3f8/splash.png',
  'Lotus':    'https://media.valorant-api.com/maps/2fe4ed3a-450a-948b-6d6b-e89a78e680a9/splash.png',
  'Pearl':    'https://media.valorant-api.com/maps/fd267378-4d1d-484f-ff52-77821ed10dc2/splash.png',
  'Split':    'https://media.valorant-api.com/maps/d960549e-485c-e861-8d71-aa9d1aed12a2/splash.png',
  'Sunset':   'https://media.valorant-api.com/maps/92584fbe-486a-b1b2-9faa-39b0f486b498/splash.png',
}

export function getMapSplash(mapName: string): string {
  return MAP_SPLASH_URLS[mapName] ?? MAP_SPLASH_URLS['Ascent'];
}

export const AGENTS: string[] = [
  'Jett', 'Reyna', 'Raze', 'Sage', 'Sova', 'Omen', 'Brimstone', 'Viper',
  'Cypher', 'Killjoy', 'Fade', 'Chamber', 'Neon', 'Harbor', 'Gekko',
  'Deadlock', 'Iso', 'Clove', 'Vyse', 'Tejo', 'Waylay', 'Veto',
]

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

export const MAPS: string[] = [
  'Abyss', 'Ascent', 'Bind', 'Breeze', 'Fracture', 'Haven',
  'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset', 'Corrode',
]
