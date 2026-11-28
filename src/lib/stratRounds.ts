import { createResource } from './resourceStore'
import { scopeToUser } from './sessionScope'
import { supabase } from './supabase'

/**
 * Strat recall (docs/plays-editor-v2.md §2.31), the Supabase side: the rounds
 * a strat was marked "Seen here" on (`strat_rounds`, migration
 * `20261128_strat_rounds.sql`). Owner-only under RLS; `user_id` defaults to
 * `auth.uid()` on insert. One shared resource, invalidated by every write.
 */

import type { StratRound } from './stratRecall'

export type { StratRound }

export type StratRoundInput = Pick<StratRound, 'play_id' | 'match_id' | 'round' | 'replay_ms' | 'page'>

/** Said when the table is not there yet: the migration has not been run. */
export const MISSING_TABLE = 'Seen here needs the strat_rounds table: run supabase/migrations/20261128_strat_rounds.sql in the Supabase SQL editor.'

function failure(error: { message: string; code?: string }): Error {
  const missing = error.code === '42P01' || error.code === 'PGRST205' || /strat_rounds/.test(error.message)
  return new Error(missing ? MISSING_TABLE : error.message)
}

/** Every link, oldest first. A handful per strat: the whole table is small. */
export async function listStratRounds(): Promise<StratRound[]> {
  const { data, error } = await supabase.from('strat_rounds').select('*').order('created_at', { ascending: true })
  if (error) throw failure(error)
  return (data ?? []) as StratRound[]
}

export const stratRoundsResource = scopeToUser(createResource(listStratRounds))

export async function addStratRound(input: StratRoundInput): Promise<StratRound> {
  const { data, error } = await supabase.from('strat_rounds').insert(input).select('*').single()
  if (error) throw failure(error)
  stratRoundsResource.invalidate()
  return data as StratRound
}

export async function removeStratRound(id: string): Promise<void> {
  const { error } = await supabase.from('strat_rounds').delete().eq('id', id)
  if (error) throw failure(error)
  stratRoundsResource.invalidate()
}
