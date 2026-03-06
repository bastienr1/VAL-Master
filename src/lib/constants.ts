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

export const AGENT_ICON_URLS: Record<string, string> = {
  'Astra':      'https://media.valorant-api.com/agents/41fb69c1-4189-7b37-f117-bcaf1e96f1bf/displayicon.png',
  'Breach':     'https://media.valorant-api.com/agents/5f8d3a7f-467b-97f3-062c-13acf203c006/displayicon.png',
  'Brimstone':  'https://media.valorant-api.com/agents/9f0d8ba9-4140-b941-57d3-a7ad57c6b417/displayicon.png',
  'Chamber':    'https://media.valorant-api.com/agents/22697a3d-45bf-8dd7-4fec-84a9e28c69d7/displayicon.png',
  'Clove':      'https://media.valorant-api.com/agents/1dbf2edd-4729-0984-3115-daa5eed44993/displayicon.png',
  'Cypher':     'https://media.valorant-api.com/agents/117ed9e3-49f3-6512-3ccf-0cada7e3823b/displayicon.png',
  'Deadlock':   'https://media.valorant-api.com/agents/cc8b64c8-4b25-4ff9-6e7f-37b4da43d235/displayicon.png',
  'Fade':       'https://media.valorant-api.com/agents/dade69b4-4f5a-8528-247b-219e5a1facd6/displayicon.png',
  'Gekko':      'https://media.valorant-api.com/agents/e370fa57-4757-3604-3648-499e1f642d3f/displayicon.png',
  'Harbor':     'https://media.valorant-api.com/agents/95b78ed7-4637-86d9-7e41-71ba8c293152/displayicon.png',
  'Iso':        'https://media.valorant-api.com/agents/0e38b510-41a8-5780-5e8f-568b2a4f2d6c/displayicon.png',
  'Jett':       'https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/displayicon.png',
  'KAY/O':      'https://media.valorant-api.com/agents/601dbbe7-43ce-be57-2a40-4abd24953621/displayicon.png',
  'Killjoy':    'https://media.valorant-api.com/agents/1e58de9c-4950-5125-93e9-a0aee9f98746/displayicon.png',
  'Neon':       'https://media.valorant-api.com/agents/bb2a4828-46eb-8cd1-e765-15848195d751/displayicon.png',
  'Omen':       'https://media.valorant-api.com/agents/8e253930-4c05-31dd-1b6c-968525494517/displayicon.png',
  'Phoenix':    'https://media.valorant-api.com/agents/eb93336a-449b-9c1b-0a54-a891f7921d69/displayicon.png',
  'Raze':       'https://media.valorant-api.com/agents/f94c3b30-42be-e959-889c-5aa313dba261/displayicon.png',
  'Reyna':      'https://media.valorant-api.com/agents/a3bfb853-43b2-7238-a4f1-ad90e9e46bcc/displayicon.png',
  'Sage':       'https://media.valorant-api.com/agents/569fdd95-4d10-43ab-ca70-79becc718b46/displayicon.png',
  'Skye':       'https://media.valorant-api.com/agents/6f2a04ca-43e0-be17-7f36-b3908627744d/displayicon.png',
  'Sova':       'https://media.valorant-api.com/agents/320b2a48-4d9b-a075-30f1-1f93a9b638fa/displayicon.png',
  'Tejo':       'https://media.valorant-api.com/agents/b444168c-4e35-8076-db47-ef9bf368f384/displayicon.png',
  'Veto':       'https://media.valorant-api.com/agents/92eeef5d-43b5-1d4a-8d03-b3927a09034b/displayicon.png',
  'Viper':      'https://media.valorant-api.com/agents/707eab51-4836-f488-046a-cda6bf494859/displayicon.png',
  'Vyse':       'https://media.valorant-api.com/agents/efba5359-4016-a1e5-7626-b1ae76895940/displayicon.png',
  'Waylay':     'https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png',
  'Yoru':       'https://media.valorant-api.com/agents/7f94d92c-4234-0a36-9646-3a87eb8b5c89/displayicon.png',
}

export function getAgentIcon(agentName: string): string {
  return AGENT_ICON_URLS[agentName] ?? '';
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
