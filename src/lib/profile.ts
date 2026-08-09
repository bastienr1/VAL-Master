import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export interface Profile {
  riot_name: string
  riot_tag: string
  riot_puuid: string | null
  region: string
  timezone: string
  weekly_goal: string
}

// Neutral defaults ONLY — never a real person's identity. Empty Riot ID means "not configured".
export const EMPTY_PROFILE: Profile = {
  riot_name: '',
  riot_tag: '',
  riot_puuid: null,
  region: 'ap',
  timezone: 'Asia/Singapore',
  weekly_goal: '',
}

export interface PlayerConfig {
  name: string
  tag: string
  region: string
  puuid?: string
}

// Returns null when the Riot ID isn't set — callers MUST NOT sync in that case.
export function profileToPlayer(p: Profile): PlayerConfig | null {
  const name = p.riot_name.trim()
  const tag = p.riot_tag.trim()
  if (!name || !tag) return null
  return {
    name,
    tag,
    region: (p.region || 'ap').trim().toLowerCase(),
    puuid: p.riot_puuid ?? undefined,
  }
}

export async function getProfile(): Promise<Profile> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return EMPTY_PROFILE
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data) return EMPTY_PROFILE
  return {
    riot_name: data.riot_name ?? '',
    riot_tag: data.riot_tag ?? '',
    riot_puuid: data.riot_puuid ?? null,
    region: data.region ?? 'ap',
    timezone: data.timezone ?? 'Asia/Singapore',
    weekly_goal: data.weekly_goal ?? '',
  }
}

export async function upsertProfile(patch: Partial<Profile>): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const { error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  return { error: error?.message ?? null }
}

// Look up a Riot ID via Henrik to get puuid + region. Used when the user saves their ID.
export async function resolveRiotAccount(
  name: string,
  tag: string,
): Promise<{ puuid: string; region: string | null } | { error: string }> {
  const key = import.meta.env.VITE_HENRIK_API_KEY
  const url = `https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?api_key=${key}`
  try {
    const res = await fetch(url)
    if (!res.ok) return { error: `Riot ID not found (${res.status}). Check name and tag.` }
    const json = await res.json()
    const d = json?.data ?? {}
    if (!d.puuid) return { error: 'Riot ID not found. Check name and tag.' }
    return { puuid: d.puuid, region: d.region ?? null }
  } catch {
    return { error: 'Could not reach Henrik to verify the Riot ID.' }
  }
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    setLoading(true)
    setProfile(await getProfile())
    setLoading(false)
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  const save = useCallback(async (patch: Partial<Profile>) => {
    const res = await upsertProfile(patch)
    if (!res.error) setProfile((p) => ({ ...p, ...patch }))
    return res
  }, [])
  return { profile, loading, reload, save }
}
