/**
 * compose-play — turns a written brief into a play document (docs/plays-editor-v2.md §5).
 *
 * POST { map, side, brief, comp?, abilities?, callouts, previous? } → 200 { play, model }
 * or { error } with 400 (bad input), 401 (no user), 502 (model failure),
 * 503 (ANTHROPIC_API_KEY missing).
 *
 * The play's shape is `PlayDoc` v2 in src/lib/playDoc.ts, without element
 * ids: the client runs the result through `parsePlayDoc`, which assigns them,
 * so this function only guarantees the JSON shape (structured outputs) and
 * leaves the rules to the parser.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = 'claude-opus-5-5'
const MAX_BRIEF = 6000
const MAX_CALLOUTS = 80
const MAX_COMP = 5
/** Four abilities for each of five agents. */
const MAX_ABILITIES = 20
/** A previous play is a few KB; anything far past that is not one. */
const MAX_PREVIOUS_CHARS = 100_000

const NOT_CONFIGURED = 'The composer is not set up: add ANTHROPIC_API_KEY to the Edge Function secrets.'

const AGENTS = [
  'Astra', 'Breach', 'Brimstone', 'Chamber', 'Clove', 'Cypher', 'Deadlock', 'Fade', 'Gekko', 'Harbor',
  'Iso', 'Jett', 'KAY/O', 'Killjoy', 'Neon', 'Omen', 'Phoenix', 'Raze', 'Reyna', 'Sage', 'Skye', 'Sova',
  'Tejo', 'Veto', 'Viper', 'Vyse', 'Waylay', 'Yoru', 'Hush',
]

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Input
// ──────────────────────────────────────────────────────────────────────────

type Side = 'attack' | 'defense'

// These mirror `AbilitySlot` and `UtilityKind` in src/lib/playDoc.ts.
const SLOTS = ['Grenade', 'Ability1', 'Ability2', 'Ultimate'] as const
type Slot = (typeof SLOTS)[number]
const SLOT_KEYS: Record<Slot, 'C' | 'Q' | 'E' | 'X'> = { Grenade: 'C', Ability1: 'Q', Ability2: 'E', Ultimate: 'X' }
const SHAPES = ['smoke', 'flash', 'molly', 'recon', 'wall', 'trap', 'drone', 'stun', 'slow', 'ult', 'other'] as const
type Shape = (typeof SHAPES)[number]

/** One ability of a comp agent, as the client builds it from the registry. */
interface Ability {
  agent: string
  slot: Slot
  name: string
  shape: Shape
}

interface ComposeInput {
  map: string
  side: Side
  brief: string
  comp: string[]
  abilities: Ability[]
  callouts: string[]
  previous: unknown
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const ABILITIES_SHAPE = 'abilities must be a list of { agent, slot, name, shape } strings.'

/** The cleaned abilities list (empty when not sent), or the sentence to send back with a 400. */
function readAbilities(raw: unknown): Ability[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return ABILITIES_SHAPE
  if (raw.length > MAX_ABILITIES) return `Send at most ${MAX_ABILITIES} abilities.`
  const abilities: Ability[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return ABILITIES_SHAPE
    const { agent, slot, name, shape } = item as Record<string, unknown>
    if (typeof agent !== 'string' || typeof slot !== 'string' || typeof name !== 'string' || typeof shape !== 'string') {
      return ABILITIES_SHAPE
    }
    if (!(SLOTS as readonly string[]).includes(slot)) return `Unknown ability slot "${slot}".`
    if (!(SHAPES as readonly string[]).includes(shape)) return `Unknown ability shape "${shape}".`
    const ability: Ability = { agent: agent.trim(), slot: slot as Slot, name: name.trim(), shape: shape as Shape }
    if (ability.agent && ability.name) abilities.push(ability)
  }
  return abilities
}

/** The cleaned input, or the sentence to send back with a 400. */
function readInput(raw: unknown): ComposeInput | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'The request body must be a JSON object.'
  const body = raw as Record<string, unknown>

  const map = typeof body.map === 'string' ? body.map.trim() : ''
  if (!map) return 'Pick a map.'

  if (body.side !== 'attack' && body.side !== 'defense') return 'Side must be "attack" or "defense".'
  const side = body.side

  const brief = typeof body.brief === 'string' ? body.brief.trim() : ''
  if (!brief) return 'Write a brief for the play.'
  if (brief.length >= MAX_BRIEF) return `The brief is too long: keep it under ${MAX_BRIEF} characters.`

  if (!isStringArray(body.callouts)) return 'callouts must be an array of callout names.'
  const callouts = [...new Set(body.callouts.map(c => c.trim()).filter(Boolean))].slice(0, MAX_CALLOUTS)
  if (callouts.length === 0) return 'This map has no callouts to place agents on.'

  let comp: string[] = []
  if (body.comp !== undefined && body.comp !== null) {
    if (!isStringArray(body.comp)) return 'comp must be an array of agent names.'
    comp = body.comp.map(a => a.trim()).filter(Boolean)
    if (comp.length > MAX_COMP) return `A comp has at most ${MAX_COMP} agents.`
  }

  const abilities = readAbilities(body.abilities)
  if (typeof abilities === 'string') return abilities

  const previous = body.previous ?? null
  if (previous !== null && JSON.stringify(previous).length > MAX_PREVIOUS_CHARS) {
    return 'The previous play is too large to send back to the composer.'
  }

  return { map, side, brief, comp, abilities, callouts, previous }
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt
// ──────────────────────────────────────────────────────────────────────────

/** "Omen · E · Dark Cover → smoke", one line per ability. */
function abilityLines(abilities: Ability[]): string {
  return abilities.map(a => `- ${a.agent} · ${SLOT_KEYS[a.slot]} · ${a.name} → ${a.shape}`).join('\n')
}

function SYSTEM_PROMPT(callouts: string[], abilities: Ability[]): string {
  const abilitySection = abilities.length > 0
    ? `### Abilities
The comp's abilities, as "Agent · key · Name → shape". Use only these abilities, by their slot and shape: an \`ability\` element's \`slot\` is the slot of its key (C = Grenade, Q = Ability1, E = Ability2, X = Ultimate) and its \`shape\` is the shape after the arrow. Never invent an ability. For an agent you added to the comp that is not listed here, use that agent's real abilities the same way, with the nearest shape.

${abilityLines(abilities)}`
    : `### Abilities
Use each agent's real abilities only, never invented ones. An \`ability\` element's \`slot\` is the ability's in-game key as a slot name (C = Grenade, Q = Ability1, E = Ability2, X = Ultimate), and its \`shape\` is the nearest of the allowed shapes.`

  return `You are a Valorant coach drawing a set play on the minimap for your team. You turn the brief a player wrote into a play document that the app draws step by step. Output only the play document.

## Places
Every position is written as a callout from this map's list, spelled exactly as it appears here, character for character. Never invent a callout, never shorten or reword one.

${callouts.map(c => `- ${c}`).join('\n')}

A position is an object:
- \`callout\`: the place, from the list above.
- \`toward\` + \`t\`: for a spot between two callouts, \`toward\` is the second callout (also from the list) and \`t\` is how far along, 0 to 1 (0.5 is halfway).
- \`u\` + \`v\`: minimap image coordinates. Never invent these; they only appear when you keep a position from a previous play (see below).

## Comp
The comp is exactly five agents, written with their exact Valorant display names: ${AGENTS.join(', ')}.
- If the request gives a comp, use it as given, in that order. If the brief names different agents, still use the request's comp and say so in \`assumptions\`.
- Otherwise, if the brief names agents, use those.
- If fewer than five agents are known, complete the comp with agents that fit the play, and list the ones you picked in \`assumptions\`.
- \`comp\` order is the order used everywhere.

${abilitySection}

## Steps
Split the play into 2 to 10 steps, each named for what it is. Defaults: on attack Setup, Execute, Post-plant; on defense Setup, Hold, Retake. Use other steps when the brief implies them (a Fake, a Rotate, a Lurk...). Step \`id\` is the lowercased name with dashes ("setup", "post-plant"). \`caption\` is one or two sentences: what the step is about and what has to be true before it starts.

Each step is a list of \`elements\`, each with a \`kind\`:

### agent
Every ally agent of the comp appears exactly once per step as an \`agent\` element with \`team: "ally"\`, no more, no fewer.
- \`at\`: where the agent stands when the step starts.
- \`moveTo\`: where the agent goes during the step, when they move. Add \`via\` (one or more positions) only when the path bends around a wall or through a choke; a straight run needs no \`via\`.
- \`note\`: one terse line, the way you would call it in comms ("Smoke Heaven, then play Market", "Entry first through Main"). No full paragraphs.
- Never write an enemy as an \`agent\` element; enemies are markers (below).

### ability
Every ability thrown in a step is an \`ability\` element: \`agent\` (from the comp), \`slot\` and \`shape\` (see Abilities), a short \`label\` ("Heaven smoke", "Flash over Main"), and \`at\` where it lands. Give \`from\` (where it is thrown from) only for lineups thrown from distance; leave it out for an ability used where the agent stands.

### marker
- \`enemy\`: only where the brief implies an expected enemy (a known stack, an Operator, an anchor), with a short \`label\` ("Op", "Anchor"). Do not guess a defender setup the brief does not hint at, and never name an enemy agent.
- \`spike\`: on attack, exactly one ally \`agent\` has \`spike: true\` in every step up to and including the plant; no agent carries it after the plant. In post-plant steps, put a \`spike\` marker at the plant spot. On defense, no agent has \`spike\`; a Retake step may put a \`spike\` marker where the plant is expected.
- \`pin\`: rarely, to point at a spot the step is about (a regroup point, a crossfire) without words.

### text
Only for a call tied to a place rather than to an agent ("Wait for the Sova dart"): a few words at \`at\`. Rare; most calls belong in an agent's \`note\`.

## Assumptions and summary
\`assumptions\` lists every guess you made because the brief did not say it: the comp or part of it, the site, who carries the spike, timings, the expected defense... One short sentence each. Empty only when the brief settled everything.
\`summary\` is one line for the play's card ("Fast A split: Heaven smoke, Main flash, Sova dart for the plant").

## Previous play
When the request includes a previous play, the player is recomposing after editing it. Keep any position that carries \`u\`/\`v\` exactly as it is (the player dragged it there) unless the brief now says something different for that agent in that step. Keep each step's \`id\` when the step is still the same step. Change only what the new brief asks for. Element \`id\`s, colours, pen strokes and arrows in the previous play are the player's drawing and are not part of your output; leave them out.

\`version\` is always 2.`
}

function userMessage(input: ComposeInput): string {
  const lines = [
    `Map: ${input.map}`,
    `Side: ${input.side}`,
    input.comp.length > 0 ? `Comp: ${input.comp.join(', ')}` : 'Comp: not given',
    '',
    '<brief>',
    input.brief,
    '</brief>',
  ]
  if (input.previous !== null) {
    lines.push('', '<previous_play>', JSON.stringify(input.previous), '</previous_play>')
  }
  return lines.join('\n')
}

// ──────────────────────────────────────────────────────────────────────────
// Output schema: PlayDoc v2 from src/lib/playDoc.ts, minus ids, pens, arrows
// and colours (the player draws those; the client assigns ids)
// ──────────────────────────────────────────────────────────────────────────

const POS = { $ref: '#/$defs/pos' }

const AGENT_ELEMENT = {
  type: 'object',
  description: 'An ally agent of the comp: where they stand, where they go, and the call.',
  properties: {
    kind: { type: 'string', const: 'agent' },
    agent: { type: 'string', description: 'An agent of the comp, spelled as in the comp.' },
    team: { type: 'string', const: 'ally' },
    at: POS,
    moveTo: POS,
    via: { type: 'array', items: POS },
    note: { type: 'string' },
    spike: { type: 'boolean' },
  },
  required: ['kind', 'agent', 'team', 'at', 'note'],
  additionalProperties: false,
}

const ABILITY_ELEMENT = {
  type: 'object',
  description: 'An ability thrown during the step, where it lands.',
  properties: {
    kind: { type: 'string', const: 'ability' },
    agent: { type: 'string', description: 'The comp agent who uses it.' },
    slot: { type: 'string', enum: [...SLOTS] },
    shape: { type: 'string', enum: [...SHAPES] },
    at: POS,
    from: POS,
    label: { type: 'string' },
  },
  required: ['kind', 'agent', 'slot', 'shape', 'at', 'label'],
  additionalProperties: false,
}

const MARKER_ELEMENT = {
  type: 'object',
  description: 'An expected enemy, the spike on the ground, or a pin.',
  properties: {
    kind: { type: 'string', const: 'marker' },
    type: { type: 'string', enum: ['spike', 'enemy', 'pin'] },
    at: POS,
    label: { type: 'string' },
  },
  required: ['kind', 'type', 'at'],
  additionalProperties: false,
}

const TEXT_ELEMENT = {
  type: 'object',
  description: 'A short call tied to a place.',
  properties: {
    kind: { type: 'string', const: 'text' },
    at: POS,
    text: { type: 'string' },
  },
  required: ['kind', 'at', 'text'],
  additionalProperties: false,
}

const PLAY_SCHEMA = {
  type: 'object',
  $defs: {
    pos: {
      type: 'object',
      description: 'A place on the map: a callout from the list, optionally moved t (0..1) toward a second callout.',
      properties: {
        callout: { type: 'string', description: 'A callout from the provided list, spelled exactly.' },
        toward: { type: 'string', description: 'A second callout from the list, for a spot between two callouts.' },
        t: { type: 'number', description: 'How far from callout toward toward, 0 to 1.' },
        u: { type: 'number', description: 'Image x, 0 to 1. Only when kept from a previous play.' },
        v: { type: 'number', description: 'Image y, 0 to 1. Only when kept from a previous play.' },
      },
      additionalProperties: false,
    },
  },
  properties: {
    version: { type: 'integer', const: 2 },
    summary: { type: 'string' },
    comp: { type: 'array', items: { type: 'string' } },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          caption: { type: 'string' },
          // Structured outputs support anyOf (not oneOf); `kind` tells the branches apart.
          elements: { type: 'array', items: { anyOf: [AGENT_ELEMENT, ABILITY_ELEMENT, MARKER_ELEMENT, TEXT_ELEMENT] } },
        },
        required: ['id', 'name', 'caption', 'elements'],
        additionalProperties: false,
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['version', 'summary', 'comp', 'steps', 'assumptions'],
  additionalProperties: false,
}

// ──────────────────────────────────────────────────────────────────────────
// Model call
// ──────────────────────────────────────────────────────────────────────────

/** A failure to show the user as is (502), with the raw cause already logged. */
class ComposeFailure extends Error {}

/** The sentence a user reads for an SDK error. Checked most specific first. */
function apiErrorSentence(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'The composer took too long to answer; try again.'
  if (error instanceof Anthropic.APIConnectionError) return 'The composer could not reach the model; try again.'
  if (error instanceof Anthropic.RateLimitError) return 'The composer is busy right now; wait a minute and try again.'
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return 'The composer’s API key was rejected: check ANTHROPIC_API_KEY in the Edge Function secrets.'
  }
  if (error instanceof Anthropic.BadRequestError) return 'The model rejected the request; try a shorter or simpler brief.'
  if (error instanceof Anthropic.APIError && (error.status === 529 || (error.status ?? 0) >= 500)) {
    return 'The model is overloaded right now; try again shortly.'
  }
  return 'The composer failed; try again.'
}

async function compose(apiKey: string, input: ComposeInput): Promise<{ play: unknown; model: string }> {
  // Edge functions have a wall-clock limit; one retry inside it, then give up.
  const client = new Anthropic({ apiKey, timeout: 140_000, maxRetries: 1 })

  let response
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: PLAY_SCHEMA },
      },
      system: SYSTEM_PROMPT(input.callouts, input.abilities),
      messages: [{ role: 'user', content: userMessage(input) }],
    })
  } catch (error) {
    console.error('compose-play: Anthropic API error', error)
    throw new ComposeFailure(apiErrorSentence(error))
  }

  if (response.stop_reason === 'refusal') {
    console.error('compose-play: refusal', response.stop_details)
    throw new ComposeFailure('The composer declined this brief; rephrase it.')
  }
  if (response.stop_reason === 'max_tokens') {
    console.error('compose-play: hit max_tokens', response.usage)
    throw new ComposeFailure('The play came back incomplete; try a shorter brief.')
  }

  const text = response.content
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('')
  try {
    return { play: JSON.parse(text), model: response.model }
  } catch (error) {
    console.error('compose-play: unreadable JSON', response.stop_reason, error, text.slice(0, 2000))
    throw new ComposeFailure('The play came back unreadable; try again.')
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })

  const authorization = req.headers.get('Authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json(401, { error: 'Sign in to compose a play.' })
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return json(401, { error: 'Sign in to compose a play.' })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'The request body is not valid JSON.' })
  }
  const input = readInput(body)
  if (typeof input === 'string') return json(400, { error: input })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(503, { error: NOT_CONFIGURED })

  try {
    return json(200, await compose(apiKey, input))
  } catch (error) {
    if (error instanceof ComposeFailure) return json(502, { error: error.message })
    console.error('compose-play: unexpected error', error)
    return json(502, { error: 'The composer failed; try again.' })
  }
})
