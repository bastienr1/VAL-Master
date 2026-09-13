import { supabase } from './supabase'
import { loadGameContent } from './gameContent'
import { parsePlaybookMarkdown, type ParsedChapter, type ParsedPlaybook } from './playbookParser'
import { notifyPlaybooksChanged, validatePlaybookName } from './playbooks'
import type { PlaybookImportLog } from './types'

export { PLAYBOOKS_CHANGED_EVENT } from './playbooks'

export interface PlaybookImportResult {
  success: boolean
  playbook_id?: string
  slug?: string
  name?: string
  action?: PlaybookImportLog['action']
  chapters_added?: number
  chapters_updated?: number
  chapters_removed?: number
  error?: string
}

/** Everything the save dialog shows — parsed, validated and hashed, but not yet written. */
export interface PreparedPlaybookImport {
  playbook: Omit<ParsedPlaybook, 'chapters'>
  chapters: ParsedChapter[]
  sourcePath: string
  contentHash: string
  /** The saved playbook this note would update, if it was imported before. */
  existing: { id: string; name: string; slug: string; contentHash: string | null } | null
  takeawayCount: number
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Best effort — a failed log write must not mask the original error. */
async function logFailure(sourcePath: string, message: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('playbook_import_log').insert({
    user_id: user.id,
    source_path: sourcePath,
    action: 'failed',
    error_message: message,
  })
  if (error) console.warn('[playbookImport] could not write failure log', error)
}

/** Canonical map name from the registry, or null when the name is unknown. */
async function canonicalMapName(name: string): Promise<string | null> {
  try {
    const registry = await loadGameContent()
    if (registry.maps.byName.size === 0) return name
    return registry.maps.byName.get(name.trim().toLowerCase())?.name ?? null
  } catch {
    // Registry unreachable — don't block an import on it.
    return name
  }
}

/**
 * Step 1 of an import: read, parse, canonicalise the map, hash, and look up
 * whether this note was saved before. Writes nothing except a failure log
 * when the note can't be imported at all.
 */
export async function preparePlaybookImport(
  file: File,
): Promise<{ ok: true; prepared: PreparedPlaybookImport } | { ok: false; error: string }> {
  const sourcePath = file.name

  if (!file.name.toLowerCase().endsWith('.md')) {
    return { ok: false, error: 'File must be a Markdown (.md) file' }
  }

  const fail = async (error: string) => {
    await logFailure(sourcePath, error)
    return { ok: false as const, error }
  }

  const markdown = await file.text()
  const parsed = parsePlaybookMarkdown(markdown)
  if (!parsed.ok) return fail(parsed.error)

  const { chapters, ...playbook } = parsed.playbook

  const map = await canonicalMapName(playbook.map)
  if (!map) return fail(`Unknown map "${playbook.map}" — check the map: field in the frontmatter.`)

  const { data: existing, error } = await supabase
    .from('playbooks')
    .select('id, name, slug, content_hash')
    .eq('slug', playbook.slug)
    .maybeSingle()
  if (error) return { ok: false, error: `Couldn't check saved playbooks: ${error.message}` }

  return {
    ok: true,
    prepared: {
      playbook: { ...playbook, map },
      chapters,
      sourcePath,
      contentHash: await sha256Base64(markdown),
      existing: existing
        ? { id: existing.id, name: existing.name, slug: existing.slug, contentHash: existing.content_hash }
        : null,
      takeawayCount: chapters.reduce((n, c) => n + c.key_takeaways.length, 0),
    },
  }
}

/**
 * Step 2: save under the chosen name through import_playbook(), which
 * creates, updates or no-ops the playbook and its chapters in one transaction.
 */
export async function savePlaybookImport(prepared: PreparedPlaybookImport, rawName: string): Promise<PlaybookImportResult> {
  const checked = validatePlaybookName(rawName)
  if (!checked.ok) return { success: false, error: checked.error }

  const { data, error } = await supabase.rpc('import_playbook', {
    p_playbook: { ...prepared.playbook, name: checked.name },
    p_chapters: prepared.chapters,
    p_source_path: prepared.sourcePath,
    p_content_hash: prepared.contentHash,
  })

  if (error) {
    console.error('[playbookImport] import_playbook failed', error)
    await logFailure(prepared.sourcePath, error.message)
    return { success: false, action: 'failed', error: error.message || 'Import failed' }
  }

  notifyPlaybooksChanged()
  return data as PlaybookImportResult
}
