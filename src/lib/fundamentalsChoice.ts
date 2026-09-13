/**
 * Map fundamentals choice ↔ database row.
 *
 * A map's fundamentals point at either an external URL or a saved playbook,
 * never both (enforced by the map_fundamentals_one_target constraint).
 *
 * Pure — no Supabase import — so `npm test` can load it directly.
 */

import { normalizeUrl } from './url.ts'

export type FundamentalsChoice =
  | { kind: 'none' }
  | { kind: 'url'; url: string }
  | { kind: 'playbook'; playbookId: string }

export interface FundamentalsRow {
  url: string | null
  playbook_id: string | null
}

/** Row fields for a choice. null means "delete the row". */
export function toFundamentalsRow(choice: FundamentalsChoice): FundamentalsRow | null {
  switch (choice.kind) {
    case 'none':
      return null
    case 'url': {
      const url = normalizeUrl(choice.url)
      return url ? { url, playbook_id: null } : null
    }
    case 'playbook':
      return choice.playbookId ? { url: null, playbook_id: choice.playbookId } : null
  }
}

/** The choice a stored row represents. */
export function fromFundamentalsRow(row: FundamentalsRow | null): FundamentalsChoice {
  if (!row) return { kind: 'none' }
  // The constraint forbids both being set; if it ever happens, the playbook wins.
  if (row.playbook_id) return { kind: 'playbook', playbookId: row.playbook_id }
  if (row.url) return { kind: 'url', url: row.url }
  return { kind: 'none' }
}
