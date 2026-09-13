import { supabase } from './supabase'
import { loadGameContent } from './gameContent'
import { parsePlaybookMarkdown } from './playbookParser'
import type { PlaybookImportLog } from './types'

export interface PlaybookImportResult {
  success: boolean
  playbook_id?: string
  slug?: string
  action?: PlaybookImportLog['action']
  chapters_added?: number
  chapters_updated?: number
  chapters_removed?: number
  error?: string
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
 * Parses a vault note in the browser and saves it through the
 * import_playbook() Postgres function, which creates, updates or no-ops the
 * playbook and its chapters in one transaction.
 */
export async function importPlaybookFile(file: File): Promise<PlaybookImportResult> {
  const sourcePath = file.name

  if (!file.name.toLowerCase().endsWith('.md')) {
    return { success: false, error: 'File must be a Markdown (.md) file' }
  }

  const fail = async (error: string): Promise<PlaybookImportResult> => {
    await logFailure(sourcePath, error)
    return { success: false, action: 'failed', error }
  }

  const markdown = await file.text()
  const parsed = parsePlaybookMarkdown(markdown)
  if (!parsed.ok) return fail(parsed.error)

  const { chapters, ...playbook } = parsed.playbook

  const map = await canonicalMapName(playbook.map)
  if (!map) return fail(`Unknown map "${playbook.map}" — check the map: field in the frontmatter.`)

  const { data, error } = await supabase.rpc('import_playbook', {
    p_playbook: { ...playbook, map },
    p_chapters: chapters,
    p_source_path: sourcePath,
    p_content_hash: await sha256Base64(markdown),
  })

  if (error) {
    console.error('[playbookImport] import_playbook failed', error)
    return fail(error.message || 'Import failed')
  }

  return data as PlaybookImportResult
}
