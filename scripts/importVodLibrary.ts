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
 * Each review row also carries the note's frame — Essence, Key Takeaways, habit
 * cues and Action Items — as markdown, for the review page to show around the
 * video — and its shelf fields: `series`, `skill` (with the group derived from
 * `src/lib/skillTaxonomy.ts`), `playlist-index`, `difficulty` and `published`,
 * which the library groups and orders on. The vault-only `creator-note` is
 * ignored.
 *
 * Idempotent. Reviews upsert on `vault_path`, sections are replaced wholesale,
 * drills upsert on `(reference_review_id, position)` touching content columns
 * only so a drill the user set to `active` stays active, and `practice_logs` is
 * never touched. A drill whose row disappears from the note is marked `dropped`
 * rather than deleted, because deleting it would take its logs with it. For the
 * same reason a review whose note has left the vault is reported, not deleted:
 * the run ends with the stale rows and a `delete` to paste by hand.
 */

import { readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireEnv } from './env'
import { extractYouTubeId } from '../src/lib/youtubeId'
import { skillGroupFor, type SkillGroup } from '../src/lib/skillTaxonomy'
import { GUIDE_DIFFICULTIES, type GuideDifficulty } from '../src/lib/types'
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
  essence_md: string | null
  takeaways_md: string | null
  habit_cues_md: string | null
  action_items_md: string | null
  series: string | null
  skill: string | null
  skill_group: SkillGroup | null
  playlist_index: number | null
  difficulty: GuideDifficulty | null
  published: string | null
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

/**
 * Lower-cased and checked against the three levels. Anything else is dropped
 * with a warning rather than left to fail the whole row on the column check.
 */
function difficultyOf(raw: string | null, warnings: string[]): GuideDifficulty | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  if ((GUIDE_DIFFICULTIES as string[]).includes(value)) return value as GuideDifficulty
  warnings.push(`difficulty "${raw}" is not beginner/intermediate/advanced — dropped`)
  return null
}

/**
 * The skill as stored: lower-cased, and kept even when the list does not know
 * it — the library shelves it under its own name in `Unsorted`, which makes a
 * typo visible where nulling it would hide it. Never on a map guide: those
 * group by map only (decision 2 of 2026-10-03).
 */
function skillOf(raw: string | null, contentType: string | null, warnings: string[]): string | null {
  if (!raw) return null
  if (contentType === 'map-guide') {
    warnings.push('map guides group by map only — skill ignored')
    return null
  }
  const value = raw.trim().toLowerCase()
  if (!skillGroupFor(value)) {
    warnings.push(`skill "${raw}" is not in the agreed list (src/lib/skillTaxonomy.ts) — shelved as Unsorted`)
  }
  return value
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
  const contentType = contentTypeFor(vaultPath, fm)

  const series = firstValue(fm['series'])
  const playlistIndex = toNumber(firstValue(fm['playlist-index']))
  const published = dateOnly(firstValue(fm['published']))
  const skill = skillOf(firstValue(fm['skill']), contentType, warnings)
  if (series && !published) {
    warnings.push('series note without published — sorts by playlist-index instead')
  }
  if (series && playlistIndex === null) warnings.push('series note without playlist-index')

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
    content_type: contentType,
    creator,
    vault_path: vaultPath,
    series_order: toNumber(firstValue(fm['series-order'])),
    duration_seconds: parseClock(firstValue(fm['duration'])),
    focus: arrayOrNull(listValue(fm['focus'])),
    maps: arrayOrNull(maps),
    agents: arrayOrNull(agents),
    // The note's frame. Written even when null, so a section deleted from the
    // note disappears from the app on the next import.
    ...parsed.study,
    // The shelf fields, likewise written even when null.
    series,
    skill,
    skill_group: skillGroupFor(skill),
    playlist_index: playlistIndex,
    difficulty: difficultyOf(firstValue(fm['difficulty']), warnings),
    published,
    updated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------- writing

/** The columns this script writes that arrived after the first guide migration, with the file that adds each set. */
const LATER_COLUMNS: Array<{ columns: string; migration: string }> = [
  {
    columns: 'essence_md, takeaways_md, habit_cues_md, action_items_md',
    migration: 'supabase/migrations/20261002c_guide_study_notes.sql',
  },
  {
    columns: 'series, skill, skill_group, playlist_index, difficulty, published',
    migration: 'supabase/migrations/20261003_guide_series_skill.sql',
  },
]

/**
 * Stops before the first write when a column set is missing.
 *
 * Migrations here are applied by hand, so the script can run ahead of one.
 * Without this check the very first upsert fails on an unknown column, with a
 * PostgREST message that does not say which file to run. One select per set,
 * so the message names the right file.
 */
async function assertGuideColumns(): Promise<void> {
  for (const { columns, migration } of LATER_COLUMNS) {
    const { error } = await supabase().from('reference_reviews').select(columns).limit(1)
    if (!error) continue

    console.error('')
    console.error(`reference_reviews is missing columns from ${migration} (${error.message}).`)
    console.error('Run it in the Supabase SQL editor, then import again. Nothing was written.')
    process.exit(1)
  }
}

/**
 * Vault rows whose note no longer exists at that path — a renamed or moved note
 * leaves its old row behind, since the upsert key is the path. Reported with a
 * paste-ready delete rather than deleted here: a delete cascades to the row's
 * drills and their practice logs, which is a decision for a person.
 */
async function reportStaleRows(importedPaths: Set<string>): Promise<void> {
  const { data, error } = await supabase()
    .from('reference_reviews')
    .select('id, vault_path, title')
    .eq('source', 'vault')
  if (error) throw new Error(`reading vault rows: ${error.message}`)

  const stale = (data ?? []).filter(row => !importedPaths.has(row.vault_path as string))
  if (stale.length === 0) return

  console.log('')
  console.log(`stale rows (${stale.length}) — not deleted; deleting cascades to drills and their logs:`)
  for (const row of stale) console.log(`  ${row.vault_path}  —  ${row.title ?? '(no title)'}`)
  console.log('')
  console.log('  to remove them, in the Supabase SQL editor:')
  console.log(`  delete from reference_reviews where id in (${stale.map(row => `'${row.id}'`).join(', ')});`)
}

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

  await assertGuideColumns()

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

  await reportStaleRows(new Set(notes.map(note => note.vaultPath)))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
