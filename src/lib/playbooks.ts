import { supabase } from './supabase'

/** Fired on window after any playbook write, so every playbook view can reload. */
export const PLAYBOOKS_CHANGED_EVENT = 'val-master:playbooks-changed'

export const PLAYBOOK_NAME_MAX = 120

/** Trimmed name, or an error message when it can't be saved. */
export function validatePlaybookName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Give the playbook a name.' }
  if (name.length > PLAYBOOK_NAME_MAX) return { ok: false, error: `Keep the name under ${PLAYBOOK_NAME_MAX} characters.` }
  return { ok: true, name }
}

export function notifyPlaybooksChanged() {
  window.dispatchEvent(new Event(PLAYBOOKS_CHANGED_EVENT))
}

/** Renames a playbook. The slug (and so its URL) stays the same. */
export async function renamePlaybook(id: string, rawName: string): Promise<string> {
  const checked = validatePlaybookName(rawName)
  if (!checked.ok) throw new Error(checked.error)

  const { error } = await supabase
    .from('playbooks')
    .update({ name: checked.name, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)

  notifyPlaybooksChanged()
  return checked.name
}

/** Deletes a playbook. Chapters and any map fundamentals row pointing at it cascade. */
export async function deletePlaybook(id: string): Promise<void> {
  const { error } = await supabase.from('playbooks').delete().eq('id', id)
  if (error) throw new Error(error.message)
  notifyPlaybooksChanged()
}
