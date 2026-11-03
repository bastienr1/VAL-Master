/**
 * Play templates — the four starting points of a set play.
 *
 * A template is the right steps with a caption each that says what to write
 * for it, everyone standing where that kind of play starts, and a brief
 * scaffold with one line per step. Attack and Defense start from spawn and
 * mirror `emptyPlayDoc`; Post-plant and Retake are played around a site, so
 * their positions, markers and captions carry `{site}`, filled with the site
 * letter ("{site} Site" becomes "A Site"). The scaffold also carries `{map}`.
 *
 * Pure, no React, no registry: `gameContent.ts` needs Vite's `import.meta.env`,
 * so callouts come in as `MapCallout[]` from `playDoc.ts`. Must not be
 * imported by `playDoc.ts`, which this file builds on.
 */

import { newId, parsePlayDoc, type MapCallout, type PlayDoc } from './playDoc.ts'

export type PlayTemplateId = 'attack' | 'defense' | 'post-plant' | 'retake'

/** Same as `PlaySide` in `types.ts`, written out here because `types.ts` imports `playDoc.ts`. */
type TemplateSide = 'attack' | 'defense'

export interface PlayTemplate {
  id: PlayTemplateId
  name: string
  side: TemplateSide
  /** One line for the card. */
  description: string
  /** Played around one site: the designer asks which before applying. */
  needsSite: boolean
  steps: {
    id: string
    name: string
    /** What to write for this step. May carry `{site}`. */
    caption: string
    /** The callout every agent stands on. May carry `{site}`. */
    spot: string
    /** Where every agent heads during the step, drawn as an arrow. May carry `{site}`. */
    moveTo?: string
    markers?: { type: 'spike' | 'enemy'; at: string; label?: string }[]
  }[]
  /** The brief, one line per step to fill in. Carries `{map}` and may carry `{site}`. */
  scaffold: string
}

const SPIKE_ON_SITE = { type: 'spike', at: '{site} Site' } as const

export const PLAY_TEMPLATES: PlayTemplate[] = [
  {
    id: 'attack',
    name: 'Attack',
    side: 'attack',
    description: 'A full execute: setup, hit, post-plant.',
    needsSite: false,
    steps: [
      {
        id: 'setup',
        name: 'Setup',
        caption: 'Group up and take map control. Everyone in position before the execute call.',
        spot: 'Attacker Side Spawn',
      },
      {
        id: 'execute',
        name: 'Execute',
        caption: 'Utility first, then the entry. Who goes first, and where the plant is.',
        spot: 'Attacker Side Spawn',
      },
      {
        id: 'post-plant',
        name: 'Post-plant',
        caption: 'Spread out, hold the crossfires, play for time.',
        spot: 'Attacker Side Spawn',
      },
    ],
    scaffold: '{map} attack, comp …\nSetup: …\nExecute: …\nPost-plant: …',
  },
  {
    id: 'defense',
    name: 'Defense',
    side: 'defense',
    description: 'Default setup, the hold, and what if the site falls.',
    needsSite: false,
    steps: [
      {
        id: 'setup',
        name: 'Setup',
        caption: 'Default positions and the opening utility. Who anchors, who plays for info.',
        spot: 'Defender Side Spawn',
      },
      {
        id: 'hold',
        name: 'Hold',
        caption: 'Reads and rotations once the attack shows. Who holds, who falls back, who rotates.',
        spot: 'Defender Side Spawn',
      },
      {
        id: 'retake',
        name: 'Retake',
        caption: 'If the site falls: the regroup point, the retake utility, who goes first.',
        spot: 'Defender Side Spawn',
      },
    ],
    scaffold: '{map} defense, comp …\nSetup: …\nHold: …\nRetake: …',
  },
  {
    id: 'post-plant',
    name: 'Post-plant',
    side: 'attack',
    description: 'Spike down: where everyone stands and how the defuse is denied.',
    needsSite: true,
    steps: [
      {
        id: 'plant',
        name: 'Plant',
        caption: 'Spike down on {site}. Where everyone stands at the plant and who covers it.',
        spot: '{site} Site',
        markers: [SPIKE_ON_SITE],
      },
      {
        id: 'hold',
        name: 'Hold',
        caption: 'Positions after the plant: crossfires, off-angles, who watches the flank.',
        spot: '{site} Site',
        markers: [SPIKE_ON_SITE],
      },
      {
        id: 'deny',
        name: 'Deny',
        caption: 'The defuse starts: who swings, who throws what, from where.',
        spot: '{site} Site',
        markers: [SPIKE_ON_SITE],
      },
    ],
    scaffold: '{map} attack, post-plant on {site}, comp …\nPlant: …\nHold: …\nDeny: …',
  },
  {
    id: 'retake',
    name: 'Retake',
    side: 'defense',
    description: 'Site lost: regroup, clear it, cover the defuse.',
    needsSite: true,
    steps: [
      {
        id: 'regroup',
        name: 'Regroup',
        caption: 'Site lost on {site}. Where everyone meets and what we know.',
        spot: 'Defender Side Spawn',
        markers: [SPIKE_ON_SITE, { type: 'enemy', at: '{site} Site', label: 'Post-plant' }],
      },
      {
        id: 'retake',
        name: 'Retake',
        caption: 'Utility to clear the site, then the entry. Who goes first, from where.',
        spot: 'Defender Side Spawn',
        moveTo: '{site} Site',
        markers: [SPIKE_ON_SITE],
      },
      {
        id: 'defuse',
        name: 'Defuse',
        caption: 'Cover the defuse: who sits on the spike, who holds which angle.',
        spot: '{site} Site',
        markers: [SPIKE_ON_SITE],
      },
    ],
    scaffold: '{map} defense, retake {site}, comp …\nRegroup: …\nRetake: …\nDefuse: …',
  },
]

/** The template with this id, or null for anything else (a stale `?template=` link). */
export function templateById(id: string): PlayTemplate | null {
  return PLAY_TEMPLATES.find(t => t.id === id) ?? null
}

/**
 * The sites a map has: every super-region with a region named "Site", in A,
 * B, C order, each once. Ascent gives A and B, Haven A, B and C; "Mid" has no
 * site and never shows.
 */
export function mapSites(callouts: MapCallout[]): string[] {
  const sites = new Set<string>()
  for (const c of callouts) {
    const superRegion = c.superRegion.trim()
    if (superRegion && c.region.trim().toLowerCase() === 'site') sites.add(superRegion)
  }
  return [...sites].sort((a, b) => a.localeCompare(b))
}

/** The letter a template is filled with: the site given, else A (only site templates use it). */
const siteLetter = (site: string | null | undefined) => site?.trim().toUpperCase() || 'A'

const fillSite = (s: string, site: string) => s.split('{site}').join(site)

/**
 * A play built from a template: every agent of the comp in every step as an
 * ally agent element, standing on the step's spot (and heading for its
 * `moveTo`), with the template's markers. Each agent keeps one element id
 * across the steps, so stepping animates it. The comp is cleaned the way
 * `parsePlayDoc` cleans it, and the result comes back through it, so it is an
 * ordinary play.
 */
export function templateDoc(template: PlayTemplate, comp: string[], site?: string | null): PlayDoc {
  const letter = siteLetter(site)
  const agents: string[] = []
  for (const entry of comp) {
    const name = entry.trim()
    if (!name || agents.some(a => a.toLowerCase() === name.toLowerCase())) continue
    if (agents.length === 5) break
    agents.push(name)
  }
  const agentIds = agents.map(() => newId())
  return parsePlayDoc({
    version: 2,
    summary: '',
    comp: agents,
    steps: template.steps.map(s => ({
      id: s.id,
      name: s.name,
      caption: fillSite(s.caption, letter),
      elements: [
        ...agents.map((agent, i) => ({
          kind: 'agent',
          id: agentIds[i],
          agent,
          team: 'ally',
          at: { callout: fillSite(s.spot, letter) },
          ...(s.moveTo ? { moveTo: { callout: fillSite(s.moveTo, letter) } } : {}),
        })),
        ...(s.markers ?? []).map(m => ({
          kind: 'marker',
          id: newId(),
          type: m.type,
          at: { callout: fillSite(m.at, letter) },
          ...(m.label ? { label: m.label } : {}),
        })),
      ],
    })),
    assumptions: [],
  })
}

/** The brief a template starts with: the map, the side, and one line per step to fill in. */
export function templateScaffold(template: PlayTemplate, map: string, site?: string | null): string {
  return fillSite(template.scaffold, siteLetter(site)).split('{map}').join(map.trim())
}
