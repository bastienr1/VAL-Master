/**
 * Online game-content registry.
 *
 * Valorant map/agent identity comes from Riot UUIDs that Henrik already returns
 * on every match. Images render straight off media.valorant-api.com from those
 * UUIDs, so nothing about maps or agents is hardcoded here — no UUID tables, no
 * committed JSON snapshot, no localStorage.
 *
 * Rows written before map_id/agent_id existed only carry names, so the registry
 * also resolves name → UUID. Three sources, tried in order:
 *   1. valorant-api.com  — full data (images, roles, minimap transforms)
 *   2. Henrik /v1/content — identity only, no images or roles
 *   3. Supabase game_content — last good payload cached from (1)
 */

import { supabase } from './supabase'

const HENRIK_API_KEY = import.meta.env.VITE_HENRIK_API_KEY

export interface GameMap {
  uuid: string
  name: string
  splash: string
  listViewIconTall: string
  displayIcon: string | null
  transform: {
    xMultiplier: number
    yMultiplier: number
    xScalarToAdd: number
    yScalarToAdd: number
  } | null
}

export interface GameAgent {
  uuid: string
  name: string
  role: string | null
  displayIcon: string
  fullPortrait: string | null
}

export interface GameContentRegistry {
  maps: { byId: Map<string, GameMap>; byName: Map<string, GameMap> }
  agents: { byId: Map<string, GameAgent>; byName: Map<string, GameAgent> }
  source: 'valorant-api' | 'henrik' | 'supabase'
  fetchedAt: string
}

// ──────────────────────────────────────────────────────────────────────────
// URL templates — the ONLY image URL builders in the app.
// ──────────────────────────────────────────────────────────────────────────

export const mapSplashUrl = (uuid: string) => `https://media.valorant-api.com/maps/${uuid}/splash.png`
export const mapListIconUrl = (uuid: string) => `https://media.valorant-api.com/maps/${uuid}/listviewicontall.png`
export const agentIconUrl = (uuid: string) => `https://media.valorant-api.com/agents/${uuid}/displayicon.png`
export const agentPortraitUrl = (uuid: string) => `https://media.valorant-api.com/agents/${uuid}/fullportrait.png`

// ──────────────────────────────────────────────────────────────────────────
// Registry construction
// ──────────────────────────────────────────────────────────────────────────

const nameKey = (name: string) => name.trim().toLowerCase()

function emptyRegistry(source: GameContentRegistry['source'], fetchedAt: string): GameContentRegistry {
  return {
    maps: { byId: new Map(), byName: new Map() },
    agents: { byId: new Map(), byName: new Map() },
    source,
    fetchedAt,
  }
}

function indexMaps(registry: GameContentRegistry, maps: GameMap[]) {
  for (const m of maps) {
    if (!m.uuid || !m.name) continue
    registry.maps.byId.set(m.uuid, m)
    registry.maps.byName.set(nameKey(m.name), m)
  }
}

function indexAgents(registry: GameContentRegistry, agents: GameAgent[]) {
  for (const a of agents) {
    if (!a.uuid || !a.name) continue
    registry.agents.byId.set(a.uuid, a)
    registry.agents.byName.set(nameKey(a.name), a)
  }
}

/** Shapes a valorant-api.com /v1/maps entry. */
function mapFromValorantApi(raw: any): GameMap {
  const hasTransform =
    typeof raw?.xMultiplier === 'number' && typeof raw?.yMultiplier === 'number'
  return {
    uuid: raw.uuid,
    name: raw.displayName,
    splash: raw.splash ?? mapSplashUrl(raw.uuid),
    listViewIconTall: raw.listViewIconTall ?? mapListIconUrl(raw.uuid),
    displayIcon: raw.displayIcon ?? null,
    transform: hasTransform
      ? {
          xMultiplier: raw.xMultiplier,
          yMultiplier: raw.yMultiplier,
          xScalarToAdd: raw.xScalarToAdd,
          yScalarToAdd: raw.yScalarToAdd,
        }
      : null,
  }
}

/** Shapes a valorant-api.com /v1/agents entry. */
function agentFromValorantApi(raw: any): GameAgent {
  return {
    uuid: raw.uuid,
    name: raw.displayName,
    role: raw?.role?.displayName ?? null,
    displayIcon: raw.displayIcon ?? agentIconUrl(raw.uuid),
    fullPortrait: raw.fullPortrait ?? null,
  }
}

/** Competitive pool only — drops The Range, Skirmish, HURM/TDM maps. */
const isCompetitiveMap = (raw: any) => raw?.tacticalDescription != null

function buildFromValorantApi(
  rawMaps: any[],
  rawAgents: any[],
  source: GameContentRegistry['source'],
  fetchedAt: string,
): GameContentRegistry {
  const registry = emptyRegistry(source, fetchedAt)
  indexMaps(registry, rawMaps.filter(isCompetitiveMap).map(mapFromValorantApi))
  indexAgents(registry, rawAgents.map(agentFromValorantApi))
  return registry
}

// ──────────────────────────────────────────────────────────────────────────
// Sources
// ──────────────────────────────────────────────────────────────────────────

async function getJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`)
  return res.json()
}

/** Cache the raw payloads so source (c) can rebuild an identical registry. */
function cacheToSupabase(rawMaps: any[], rawAgents: any[]) {
  supabase
    .from('game_content')
    .upsert(
      [
        { kind: 'maps', payload: rawMaps, source: 'valorant-api' },
        { kind: 'agents', payload: rawAgents, source: 'valorant-api' },
      ],
      { onConflict: 'kind' },
    )
    .then(({ error }) => {
      if (error) console.warn('[gameContent] failed to cache content to Supabase:', error.message)
    })
}

async function fromValorantApi(): Promise<GameContentRegistry> {
  const [mapsRes, agentsRes] = await Promise.all([
    getJson('https://valorant-api.com/v1/maps'),
    getJson('https://valorant-api.com/v1/agents?isPlayableCharacter=true'),
  ])

  const rawMaps: any[] = mapsRes?.data ?? []
  const rawAgents: any[] = agentsRes?.data ?? []
  if (rawMaps.length === 0 || rawAgents.length === 0) {
    throw new Error('valorant-api returned an empty data array')
  }

  const registry = buildFromValorantApi(rawMaps, rawAgents, 'valorant-api', new Date().toISOString())

  // Fire-and-forget — never block first paint on the cache write.
  cacheToSupabase(rawMaps, rawAgents)

  return registry
}

/** Identity only: no images, no roles, no minimap transforms. */
async function fromHenrik(): Promise<GameContentRegistry> {
  const body = await getJson(
    `https://api.henrikdev.xyz/valorant/v1/content?api_key=${HENRIK_API_KEY}`,
  )

  const rawMaps: any[] = body?.data?.maps ?? []
  const rawAgents: any[] = body?.data?.characters ?? []
  if (rawMaps.length === 0 || rawAgents.length === 0) {
    throw new Error('henrik /v1/content returned no maps or characters')
  }

  const NON_COMPETITIVE = /range|skirmish|training/i

  const registry = emptyRegistry('henrik', new Date().toISOString())
  indexMaps(
    registry,
    rawMaps
      .filter((m: any) => m?.name && !NON_COMPETITIVE.test(m.name))
      .map((m: any) => ({
        uuid: m.id,
        name: m.name,
        splash: mapSplashUrl(m.id),
        listViewIconTall: mapListIconUrl(m.id),
        displayIcon: null,
        transform: null,
      })),
  )
  indexAgents(
    registry,
    rawAgents
      .filter((a: any) => a?.name)
      .map((a: any) => ({
        uuid: a.id,
        name: a.name,
        role: null,
        displayIcon: agentIconUrl(a.id),
        fullPortrait: null,
      })),
  )
  return registry
}

async function fromSupabaseCache(): Promise<GameContentRegistry> {
  const { data, error } = await supabase
    .from('game_content')
    .select('kind, payload, source, fetched_at')

  if (error) throw new Error(`game_content read failed: ${error.message}`)

  const maps = data?.find(r => r.kind === 'maps')
  const agents = data?.find(r => r.kind === 'agents')
  if (!maps || !agents) throw new Error('game_content cache is missing the maps or agents row')

  const fetchedAt = [maps.fetched_at, agents.fetched_at].sort()[0]
  return buildFromValorantApi(maps.payload ?? [], agents.payload ?? [], 'supabase', fetchedAt)
}

// ──────────────────────────────────────────────────────────────────────────
// Public loader
// ──────────────────────────────────────────────────────────────────────────

let loaded: GameContentRegistry | null = null
let inFlight: Promise<GameContentRegistry> | null = null

/**
 * Loads the registry once per session. Concurrent callers share the in-flight
 * promise; a failed load clears the memo so a later call can retry.
 */
export function loadGameContent(): Promise<GameContentRegistry> {
  if (inFlight) return inFlight

  inFlight = (async () => {
    const failures: string[] = []

    for (const [label, source] of [
      ['valorant-api', fromValorantApi],
      ['henrik', fromHenrik],
      ['supabase', fromSupabaseCache],
    ] as const) {
      try {
        const registry = await source()
        loaded = registry
        console.info(
          `[gameContent] loaded ${registry.maps.byId.size} maps / ${registry.agents.byId.size} agents ` +
          `from ${registry.source} (${registry.fetchedAt})`,
        )
        return registry
      } catch (err) {
        failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    throw new Error(`[gameContent] all sources failed — ${failures.join(' | ')}`)
  })()

  inFlight.catch(() => {
    // Allow a retry on the next call.
    inFlight = null
  })

  return inFlight
}

/** The registry if it has finished loading, otherwise null. Never throws. */
export function getLoadedGameContent(): GameContentRegistry | null {
  return loaded
}

// One warning per unknown name per session — stale registries shouldn't spam.
const warned = new Set<string>()

function warnUnknown(kind: 'map' | 'agent', name: string) {
  const key = `${kind}:${nameKey(name)}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[gameContent] unknown ${kind} name: "${name}" — registry may be stale`)
}

/** Name → UUID. Null when the registry hasn't loaded or the name is unknown. */
export function resolveMapId(name: string): string | null {
  if (!loaded || !name) return null
  const hit = loaded.maps.byName.get(nameKey(name))
  if (!hit) {
    warnUnknown('map', name)
    return null
  }
  return hit.uuid
}

export function resolveAgentId(name: string): string | null {
  if (!loaded || !name) return null
  const hit = loaded.agents.byName.get(nameKey(name))
  if (!hit) {
    warnUnknown('agent', name)
    return null
  }
  return hit.uuid
}

/** Accepts either a UUID or a display name. */
export function getAgentRole(nameOrId: string): string | null {
  if (!loaded || !nameOrId) return null
  const hit =
    loaded.agents.byId.get(nameOrId) ?? loaded.agents.byName.get(nameKey(nameOrId))
  return hit?.role ?? null
}

export function getMapTransform(uuid: string): GameMap['transform'] {
  if (!loaded || !uuid) return null
  return loaded.maps.byId.get(uuid)?.transform ?? null
}

// ──────────────────────────────────────────────────────────────────────────
// Consumer helpers — resolve an id, then template a URL. Null → placeholder.
// ──────────────────────────────────────────────────────────────────────────

export function mapImageFor(
  m: { map_id?: string | null; map: string },
  variant: 'splash' | 'listIcon' = 'splash',
): string | null {
  const id = m.map_id ?? resolveMapId(m.map)
  if (!id) return null
  return variant === 'splash' ? mapSplashUrl(id) : mapListIconUrl(id)
}

export function agentImageFor(
  p: { agent_id?: string | null; agent: string },
  variant: 'icon' | 'portrait' = 'icon',
): string | null {
  const id = p.agent_id ?? resolveAgentId(p.agent)
  if (!id) return null
  return variant === 'icon' ? agentIconUrl(id) : agentPortraitUrl(id)
}

// ──────────────────────────────────────────────────────────────────────────
// Backfill — fills map_id / agent_id on rows written before they existed.
// ──────────────────────────────────────────────────────────────────────────

export interface BackfillResult {
  scanned: number
  updated: number
  unresolved: { maps: string[]; agents: string[] }
}

export async function backfillContentIds(): Promise<BackfillResult> {
  await loadGameContent()

  const { data, error } = await supabase
    .from('matches')
    .select('id, map, agent, map_id, agent_id')
    .or('map_id.is.null,agent_id.is.null')

  if (error) throw new Error(`backfill read failed: ${error.message}`)

  const rows = data ?? []
  const unresolvedMaps = new Set<string>()
  const unresolvedAgents = new Set<string>()
  let updated = 0

  for (const row of rows) {
    const patch: { map_id?: string; agent_id?: string } = {}

    if (!row.map_id) {
      const id = resolveMapId(row.map)
      if (id) patch.map_id = id
      else if (row.map) unresolvedMaps.add(row.map)
    }
    if (!row.agent_id) {
      const id = resolveAgentId(row.agent)
      if (id) patch.agent_id = id
      else if (row.agent) unresolvedAgents.add(row.agent)
    }

    if (Object.keys(patch).length === 0) continue

    const { error: updateError } = await supabase.from('matches').update(patch).eq('id', row.id)
    if (updateError) {
      console.warn(`[gameContent] backfill failed for match ${row.id}:`, updateError.message)
      continue
    }
    updated++
  }

  const result: BackfillResult = {
    scanned: rows.length,
    updated,
    unresolved: { maps: [...unresolvedMaps], agents: [...unresolvedAgents] },
  }

  console.info(
    `[gameContent] backfill: scanned ${result.scanned}, updated ${result.updated}, ` +
    `unresolved ${result.unresolved.maps.length} map(s) / ${result.unresolved.agents.length} agent(s)`,
  )

  return result
}
