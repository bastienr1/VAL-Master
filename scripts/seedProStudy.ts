/**
 * Seeds `reference_reviews` from the Notion "VALORANT PRO PLAY RANK" database.
 *
 * Run:  npm run seed:prostudy
 *
 * Idempotent — upserts on `notion_page_id`, so re-running after adding rows in
 * Notion tops the table up rather than duplicating it. Notion stays the capture
 * surface; there is deliberately no Add VOD form in the app.
 *
 * Server-side only. The Notion token must NOT be `VITE_`-prefixed or Vite would
 * bundle it into the client.
 */

import { createClient } from '@supabase/supabase-js'
import { extractYouTubeId } from '../src/lib/youtubeId'
import { env, requireEnv } from './env'

const NOTION_API_KEY = requireEnv(
  'NOTION_API_KEY',
  'Create an internal integration at notion.so/my-integrations, share the VALORANT PRO PLAY RANK database with it, and put the token in .env (never VITE_-prefixed).',
)
const DATA_SOURCE_ID = env('NOTION_PROSTUDY_DATA_SOURCE_ID')
const DATABASE_ID = env('NOTION_PROSTUDY_DATABASE_ID')

if (!DATA_SOURCE_ID && !DATABASE_ID) {
  console.error('Missing NOTION_PROSTUDY_DATA_SOURCE_ID and NOTION_PROSTUDY_DATABASE_ID — set at least one in .env.')
  process.exit(1)
}

const SUPABASE_URL = requireEnv('VITE_SUPABASE_URL', 'Expected in .env.local alongside the app config.')
const SUPABASE_KEY = requireEnv('VITE_SUPABASE_ANON_KEY', 'Expected in .env.local alongside the app config.')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ------------------------------------------------------------- Notion payload

/** Only the slice of the Notion page shape this script reads. */
interface NotionPage {
  id: string
  properties: Record<string, NotionProperty>
}

interface NotionProperty {
  type: string
  title?: Array<{ plain_text: string }>
  rich_text?: Array<{ plain_text: string }>
  multi_select?: Array<{ name: string }>
  select?: { name: string } | null
  date?: { start: string } | null
  url?: string | null
}

interface NotionQueryResponse {
  results: NotionPage[]
  has_more: boolean
  next_cursor: string | null
}

/**
 * Queries one page of rows.
 *
 * The 2025-09 API moved querying to `/v1/data_sources/{id}/query`; the legacy
 * `/v1/databases/{id}/query` endpoint still answers on 2022-06-28. We try the
 * new shape first and fall back, so the script works whichever version the
 * workspace is on.
 */
async function queryNotion(cursor: string | null): Promise<NotionQueryResponse> {
  const body: Record<string, unknown> = { page_size: 100 }
  if (cursor) body.start_cursor = cursor

  if (DATA_SOURCE_ID) {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (res.ok) return (await res.json()) as NotionQueryResponse

    // 404/400 here means this workspace or token predates data sources.
    if ((res.status === 404 || res.status === 400) && DATABASE_ID) {
      console.warn(`  data_sources query returned ${res.status} — falling back to the legacy databases endpoint`)
    } else {
      throw new Error(`Notion data_sources query failed: ${res.status} ${await res.text()}`)
    }
  }

  if (!DATABASE_ID) {
    throw new Error('data_sources query failed and NOTION_PROSTUDY_DATABASE_ID is not set for the fallback.')
  }

  const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Notion databases query failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as NotionQueryResponse
}

async function fetchAllRows(): Promise<NotionPage[]> {
  const rows: NotionPage[] = []
  let cursor: string | null = null
  let page = 0

  do {
    const response: NotionQueryResponse = await queryNotion(cursor)
    page += 1
    rows.push(...response.results)
    console.log(`  page ${page}: ${response.results.length} rows (total ${rows.length})`)
    cursor = response.has_more ? response.next_cursor : null
  } while (cursor)

  return rows
}

// ----------------------------------------------------------------- extraction

/** Concatenated plain text of a title/rich_text property. */
function plainText(property: NotionProperty | undefined): string {
  if (!property) return ''
  const parts = property.title ?? property.rich_text ?? []
  return parts.map(p => p.plain_text).join('').trim()
}

/**
 * First option of a multi_select (or a plain select / text column).
 *
 * Rows are single-valued in practice; `extra` reports the ones that are not, so
 * the flattening assumption stays visible instead of silently losing data.
 */
function firstOption(property: NotionProperty | undefined): { value: string | null; extra: string[] } {
  if (!property) return { value: null, extra: [] }
  if (property.multi_select && property.multi_select.length > 0) {
    const names = property.multi_select.map(o => o.name)
    return { value: names[0], extra: names.slice(1) }
  }
  if (property.select?.name) return { value: property.select.name, extra: [] }
  const text = plainText(property)
  return { value: text || null, extra: [] }
}

/** The first URL in a cell, whether it arrived as a url property or loose text. */
function extractUrl(property: NotionProperty | undefined): string {
  if (!property) return ''
  if (property.url) return property.url.trim()
  const text = plainText(property)
  const match = text.match(/https?:\/\/\S+/)
  return (match ? match[0] : text).trim()
}

/** Case-insensitive property lookup — Notion column names drift in casing. */
function column(page: NotionPage, name: string): NotionProperty | undefined {
  const direct = page.properties[name]
  if (direct) return direct
  const key = Object.keys(page.properties).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? page.properties[key] : undefined
}

/**
 * Notion's map and agent names, canonicalised against the game content registry.
 *
 * The Notion database is typed in caps (`HAVEN`, `JETT`) while every other table
 * carries Riot's own casing (`Haven`, `Jett`). Left alone, the two never compare
 * equal — measured at 0 of 11 maps and 0 of 10 agents — which silently empties
 * anything that joins pro VODs to a match. Normalising on import is the same
 * thing `playbookImport.ts` does with its map name.
 *
 * Only maps and agents are touched. Player handles and team names have no
 * registry and no derivable casing (`yay` is lowercase, `TenZ` is camel, `NRG`
 * and `100T` are genuinely upper), so guessing would make them worse.
 *
 * Names are read straight from valorant-api.com rather than through
 * `src/lib/gameContent.ts`: that module reads `import.meta.env` and pulls in the
 * browser Supabase client, neither of which exists under Node.
 */
type Canonicaliser = (kind: 'map' | 'agent', name: string | null) => string | null

async function fetchDisplayNames(endpoint: string): Promise<Map<string, string>> {
  const res = await fetch(`https://valorant-api.com/v1/${endpoint}`)
  if (!res.ok) throw new Error(`valorant-api ${endpoint} → ${res.status} ${res.statusText}`)
  const body = (await res.json()) as { data?: Array<{ displayName?: string }> }

  const names = new Map<string, string>()
  for (const entry of body.data ?? []) {
    const name = entry.displayName?.trim()
    if (name) names.set(name.toLowerCase(), name)
  }
  return names
}

async function buildCanonicaliser(): Promise<Canonicaliser> {
  let maps = new Map<string, string>()
  let agents = new Map<string, string>()

  try {
    ;[maps, agents] = await Promise.all([fetchDisplayNames('maps'), fetchDisplayNames('agents')])
    console.log(`  canonical names: ${maps.size} maps / ${agents.size} agents from valorant-api`)
  } catch (err) {
    // A naming pass is not worth failing a seed over.
    console.warn(`  warn  valorant-api unreachable — names kept as Notion has them (${err})`)
  }

  return (kind, name) => {
    if (!name) return name
    const table = kind === 'map' ? maps : agents
    return table.get(name.trim().toLowerCase()) ?? name
  }
}

interface ReferenceReviewRow {
  title: string
  player: string
  team: string | null
  agent: string | null
  map: string | null
  event: string | null
  video_id: string
  youtube_url: string
  played_at: string | null
  notes: string | null
  notion_page_id: string
  updated_at: string
}

function mapRow(
  page: NotionPage,
  warnings: string[],
  canonical: Canonicaliser,
): ReferenceReviewRow | { skip: string } {
  const linkProperty =
    column(page, 'Match Link') ?? Object.values(page.properties).find(p => p.type === 'title')
  const youtubeUrl = extractUrl(linkProperty)
  const videoId = extractYouTubeId(youtubeUrl, { allowBareId: true })

  if (!videoId) {
    return { skip: youtubeUrl ? `no YouTube id in "${youtubeUrl}"` : 'no Match Link' }
  }

  const player = firstOption(column(page, 'Player'))
  const team = firstOption(column(page, 'Team'))
  const agent = firstOption(column(page, 'Agent'))
  const map = firstOption(column(page, 'Map'))
  const event = firstOption(column(page, 'Event'))

  const picked = [
    ['Player', player], ['Team', team], ['Agent', agent], ['Map', map], ['Event', event],
  ] as const
  for (const [name, option] of picked) {
    if (option.extra.length > 0) {
      warnings.push(
        `${page.id}: ${name} had ${option.extra.length + 1} values — kept "${option.value}", dropped ${option.extra.join(', ')}`,
      )
    }
  }

  // `player` is NOT NULL in Supabase; an untagged row still deserves a home.
  const playerName = player.value ?? 'Unknown'
  const dateProperty = column(page, 'Date')

  // Notion types these in caps; the rest of the database uses Riot's casing.
  const mapName = canonical('map', map.value)
  const agentName = canonical('agent', agent.value)

  return {
    title: `${playerName} — ${mapName ?? 'Unknown map'}`,
    player: playerName,
    team: team.value,
    agent: agentName,
    map: mapName,
    event: event.value,
    video_id: videoId,
    youtube_url: youtubeUrl,
    played_at: dateProperty?.date?.start ? dateProperty.date.start.slice(0, 10) : null,
    notes: plainText(column(page, 'Notes')) || null,
    notion_page_id: page.id,
    updated_at: new Date().toISOString(),
  }
}

// ----------------------------------------------------------------------- main

async function main() {
  console.log('Fetching rows from Notion…')
  const pages = await fetchAllRows()

  const canonical = await buildCanonicaliser()

  const warnings: string[] = []
  const skipped: string[] = []
  const rows: ReferenceReviewRow[] = []

  for (const page of pages) {
    const mapped = mapRow(page, warnings, canonical)
    if ('skip' in mapped) {
      skipped.push(`${page.id}: ${mapped.skip}`)
      continue
    }
    rows.push(mapped)
  }

  // Two Notion rows pointing at the same video would collide on the `video_id`
  // unique index and fail the whole batch; keep the first, report the rest.
  const seenVideoIds = new Map<string, string>()
  const deduped: ReferenceReviewRow[] = []
  for (const row of rows) {
    const owner = seenVideoIds.get(row.video_id)
    if (owner) {
      skipped.push(`${row.notion_page_id}: duplicate video_id ${row.video_id} (already seeded from ${owner})`)
      continue
    }
    seenVideoIds.set(row.video_id, row.notion_page_id)
    deduped.push(row)
  }

  let upserted = 0
  if (deduped.length > 0) {
    const { data, error } = await supabase
      .from('reference_reviews')
      .upsert(deduped, { onConflict: 'notion_page_id' })
      .select('id')

    if (error) {
      console.error('Supabase upsert failed:', error.message)
      process.exit(1)
    }
    upserted = data?.length ?? 0
  }

  for (const warning of warnings) console.warn(`  warn  ${warning}`)
  for (const skip of skipped) console.warn(`  skip  ${skip}`)

  console.log('')
  console.log(`fetched ${pages.length} · upserted ${upserted} · skipped ${skipped.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
