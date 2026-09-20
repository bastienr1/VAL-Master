/**
 * Imports the Obsidian VOD library into Pro Study as study guides.
 *
 * Run:  npm run import:guides            write
 *       npm run import:guides -- --dry   parse and print, touch nothing
 *       npm run import:guides -- --strict fail if a chapter heading has no range
 *
 * Dev-machine only: it reads the local vault, so it cannot run on Vercel. Same
 * "capture outside, re-run the import" pattern as the Notion seed — the markdown
 * is the source of truth and the app has no editor for guide content.
 *
 * Idempotent. Reviews upsert on `vault_path`, sections are replaced wholesale,
 * drills upsert on `(reference_review_id, position)` touching content columns
 * only so a drill the user set to `active` stays active, and `practice_logs` is
 * never touched. A drill whose row disappears from the note is marked `dropped`
 * rather than deleted, because deleting it would take its logs with it.
 */

import { readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireEnv } from './env'
import { extractYouTubeId } from '../src/lib/youtubeId'
import {
  contentTypeFor,
  firstValue,
  listValue,
  parseClock,
  parseGuideNote,
  splitPlayerAndTeam,
  type ParsedDrill,
  type ParsedGuide,
  type ParsedSection,
} from '../src/lib/vodLibraryParser'

// ------------------------------------------------------------------------ setup

const DRY = process.argv.includes('--dry')
const STRICT = process.argv.includes('--strict')

/**
 * Only these folders are read.
 *
 * An allowlist rather than a `Valorant/**` glob on purpose: the vault also holds
 * `_to_delete/` (a stale duplicate of a note that is still live elsewhere),
 * plus `Pro-Settings/` and `Warm-Up/`, which are not study guides.
 */
const GUIDE_FOLDERS = ['Map-Analysis', 'Pro-Reviews', 'Agent-Guides', 'Mechanics', 'Mindset']

const VOD_LIBRARY_ROOT = requireEnv(
  'VOD_LIBRARY_ROOT',
  'Point it at the vault\'s Valorant folder in .env.local (server-side — never VITE_-prefixed).',
)

let client: SupabaseClient | null = null

/** Built on first use so `--dry` runs without Supabase credentials. */
function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      requireEnv('VITE_SUPABASE_URL', 'Expected in .env.local alongside the app config.'),
      requireEnv('VITE_SUPABASE_ANON_KEY', 'Expected in .env.local alongside the app config.'),
    )
  }
  return client
}

// ------------------------------------------------------------------- file walk

/** Every `.md` under `dir`, recursively — the map guides sit in per-map subfolders. */
function walkMarkdown(dir: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return [] // an allowlisted folder that does not exist yet is not an error
  }

  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkMarkdown(full))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(full)
  }
  return files
}

/** Vault-relative, forward slashes — this is the upsert key, so it must be stable. */
function vaultPathOf(absolute: string): string {
  return relative(VOD_LIBRARY_ROOT, absolute).split(sep).join('/')
}

// ------------------------------------------------------------------ row shapes

interface GuideRow {
  title: string | null
  player: string
  team: string | null
  agent: string | null
  map: string | null
  video_id: string | null
  youtube_url: string | null
  played_at: string | null
  source: 'vault'
  content_type: string | null
  creator: string | null
  vault_path: string
  series_order: number | null
  duration_seconds: number | null
  focus: string[] | null
  maps: string[] | null
  agents: string[] | null
  updated_at: string
}

interface Note {
  vaultPath: string
  parsed: ParsedGuide
  row: GuideRow
  warnings: string[]
}

function arrayOrNull(values: string[]): string[] | null {
  return values.length > 0 ? values : null
}

/** `2026-09-19` out of a frontmatter date, which may carry a time. */
function dateOnly(raw: string | null): string | null {
  if (!raw) return null
  const match = raw.match(/\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

function toNumber(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function buildRow(vaultPath: string, parsed: ParsedGuide, warnings: string[]): GuideRow {
  const fm = parsed.frontmatter

  const rawLink = firstValue(fm['video_url']) ?? firstValue(fm['video-link'])
  const videoId = rawLink ? extractYouTubeId(rawLink, { allowBareId: true }) : null
  if (rawLink && !videoId) {
    warnings.push(`video link present but no id could be read from "${rawLink}"`)
  }
  if (!rawLink) {
    warnings.push('no video_url — chapters import, but seeking is disabled until a link is added')
  }

  const { player, team } = splitPlayerAndTeam(firstValue(fm['player']))
  const creator = firstValue(fm['creator'])
  const maps = listValue(fm['map'])
  const agents = listValue(fm['agents'])

  return {
    title: firstValue(fm['title']),
    // NOT NULL in Postgres, and the card shows it where a pro VOD shows a
    // player: a guide has a creator instead, and a map guide may have neither.
    player: player ?? creator ?? 'Unknown',
    team,
    agent: agents[0] ?? null,
    // `map` singular feeds the existing card splash; `maps` keeps the full set.
    map: maps[0] ?? null,
    video_id: videoId,
    youtube_url: rawLink,
    played_at: dateOnly(firstValue(fm['date'])),
    source: 'vault',
    content_type: contentTypeFor(vaultPath, fm),
    creator,
    vault_path: vaultPath,
    series_order: toNumber(firstValue(fm['series-order'])),
    duration_seconds: parseClock(firstValue(fm['duration'])),
    focus: arrayOrNull(listValue(fm['focus'])),
    maps: arrayOrNull(maps),
    agents: arrayOrNull(agents),
    updated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------- writing

async function writeSections(reviewId: string, sections: ParsedSection[]): Promise<void> {
  // Replaced wholesale: the note is the source of truth and nothing the user
  // does lives on these rows.
  const { error: deleteError } = await supabase()
    .from('reference_sections')
    .delete()
    .eq('reference_review_id', reviewId)
  if (deleteError) throw new Error(`deleting sections: ${deleteError.message}`)

  if (sections.length === 0) return

  const { error } = await supabase()
    .from('reference_sections')
    .insert(sections.map(section => ({ ...section, reference_review_id: reviewId })))
  if (error) throw new Error(`inserting sections: ${error.message}`)
}

interface DrillWriteResult {
  written: number
  dropped: number
}

async function writeDrills(reviewId: string, drills: ParsedDrill[]): Promise<DrillWriteResult> {
  const { data: existing, error: readError } = await supabase()
    .from('practice_drills')
    .select('position')
    .eq('reference_review_id', reviewId)
  if (readError) throw new Error(`reading drills: ${readError.message}`)

  if (drills.length > 0) {
    // `status` is deliberately absent from the payload: on insert Postgres
    // applies its 'planned' default, and on conflict an omitted column is left
    // alone — so a drill the user activated survives the re-import.
    const { error } = await supabase()
      .from('practice_drills')
      .upsert(
        drills.map(drill => ({
          ...drill,
          reference_review_id: reviewId,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'reference_review_id,position' },
      )
    if (error) throw new Error(`upserting drills: ${error.message}`)
  }

  // A row that left the note is marked dropped, never deleted — a delete would
  // cascade to its logs.
  const stale = (existing ?? [])
    .map(row => row.position as number)
    .filter(position => position > drills.length)

  if (stale.length > 0) {
    const { error } = await supabase()
      .from('practice_drills')
      .update({ status: 'dropped', updated_at: new Date().toISOString() })
      .eq('reference_review_id', reviewId)
      .in('position', stale)
    if (error) throw new Error(`dropping drills: ${error.message}`)
  }

  return { written: drills.length, dropped: stale.length }
}

async function writeNote(note: Note): Promise<DrillWriteResult> {
  const { data, error } = await supabase()
    .from('reference_reviews')
    .upsert(note.row, { onConflict: 'vault_path' })
    .select('id')
    .single()

  if (error) throw new Error(`upserting review: ${error.message}`)

  await writeSections(data.id, note.parsed.sections)
  return writeDrills(data.id, note.parsed.drills)
}

// ---------------------------------------------------------------------- output

function printSummary(notes: Note[]): void {
  const pathWidth = Math.max(4, ...notes.map(n => n.vaultPath.length))

  console.log('')
  console.log(`${'note'.padEnd(pathWidth)}  chapters  drills  warnings`)
  console.log(`${'-'.repeat(pathWidth)}  --------  ------  --------`)

  for (const note of notes) {
    console.log(
      `${note.vaultPath.padEnd(pathWidth)}  ${String(note.parsed.sections.length).padStart(8)}  ` +
        `${String(note.parsed.drills.length).padStart(6)}  ${note.warnings.length}`,
    )
  }

  const totals = notes.reduce(
    (acc, note) => ({
      sections: acc.sections + note.parsed.sections.length,
      drills: acc.drills + note.parsed.drills.length,
      warnings: acc.warnings + note.warnings.length,
    }),
    { sections: 0, drills: 0, warnings: 0 },
  )

  console.log(`${'-'.repeat(pathWidth)}  --------  ------  --------`)
  console.log(
    `${String(`${notes.length} guides`).padEnd(pathWidth)}  ${String(totals.sections).padStart(8)}  ` +
      `${String(totals.drills).padStart(6)}  ${totals.warnings}`,
  )

  const withWarnings = notes.filter(note => note.warnings.length > 0)
  if (withWarnings.length > 0) {
    console.log('')
    for (const note of withWarnings) {
      console.log(`  ${note.vaultPath}`)
      for (const warning of note.warnings) console.log(`    warn  ${warning}`)
    }
  }
}

// ------------------------------------------------------------------------ main

async function main() {
  console.log(`Reading ${VOD_LIBRARY_ROOT}`)

  const files = GUIDE_FOLDERS.flatMap(folder => walkMarkdown(join(VOD_LIBRARY_ROOT, folder)))
  const notes: Note[] = []
  const skipped: string[] = []

  for (const file of files.sort()) {
    const vaultPath = vaultPathOf(file)
    const parsed = parseGuideNote(readFileSync(file, 'utf8'))

    // The skill marks every library note `type: transcript`; anything else in
    // these folders is an index, a MOC or a scratch file.
    if (firstValue(parsed.frontmatter['type']) !== 'transcript') {
      skipped.push(`${vaultPath}: not type: transcript`)
      continue
    }

    const warnings = [...parsed.warnings]
    const row = buildRow(vaultPath, parsed, warnings)
    notes.push({ vaultPath, parsed, row, warnings })
  }

  for (const skip of skipped) console.log(`  skip  ${skip}`)

  if (notes.length === 0) {
    console.error('No guide notes found — check VOD_LIBRARY_ROOT and the folder names.')
    process.exit(1)
  }

  printSummary(notes)

  // Checked before any write, so a bad note cannot leave the tables half updated.
  const unranged = notes.filter(note => note.parsed.unranged.length > 0)
  if (STRICT && unranged.length > 0) {
    console.error('')
    console.error('--strict: chapter headings with no [MM:SS–MM:SS] range')
    for (const note of unranged) {
      console.error(`  ${note.vaultPath}`)
      for (const heading of note.parsed.unranged) console.error(`    ### ${heading}`)
    }
    process.exit(1)
  }

  if (DRY) {
    console.log('')
    console.log('--dry: nothing written.')
    return
  }

  console.log('')
  let dropped = 0
  for (const note of notes) {
    const result = await writeNote(note)
    dropped += result.dropped
    console.log(
      `  wrote  ${note.vaultPath} — ${note.parsed.sections.length} chapters, ${result.written} drills` +
        (result.dropped > 0 ? `, ${result.dropped} dropped` : ''),
    )
  }

  console.log('')
  console.log(
    `imported ${notes.length} guides · skipped ${skipped.length}` +
      (dropped > 0 ? ` · ${dropped} drills dropped` : ''),
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
