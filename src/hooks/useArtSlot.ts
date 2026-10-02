import { useMemo } from 'react'
import { artSlotsResource } from '../lib/artSlotStore'
import {
  DEFAULT_FOCAL,
  DEFAULT_OVERLAY,
  artCandidates,
  pickActiveSlots,
  type ArtCandidate,
  type ArtSlotRow,
  type ArtSource,
} from '../lib/artSlots'
import { useResource } from './useResource'

export interface ResolvedArtSlot {
  /** What the slot tries first. Null while overrides are still loading. */
  src: string | null
  /** Where `src` comes from. A file that fails to load moves `<ArtSlot>` further down. */
  source: ArtSource
  /** Everything to try, best first; the gradient is what's left when all fail. */
  candidates: ArtCandidate[]
  focal: { x: number; y: number }
  overlay: number
  href: string | null
  /** The override row showing in this slot, if any. */
  override: ArtSlotRow | null
}

const NO_CANDIDATES: ArtCandidate[] = []

/** Every row the user owns plus the one showing per slot, for the admin screen. */
export function useArtSlotRows() {
  const { data, error, loading } = useResource(artSlotsResource)
  const rows = data?.rows
  const active = useMemo(() => pickActiveSlots(rows ?? []), [rows])
  return {
    rows: rows ?? [],
    active,
    tableMissing: data?.tableMissing ?? false,
    error,
    // First load only: a background refresh keeps showing what it has.
    loading: loading && !data,
  }
}

/**
 * Resolves one slot: the user's override if they have one showing, else the API
 * image passed in, else the bundled file.
 *
 * Whether the bundled file exists is not known here — `<ArtSlot>` finds out when
 * its `<img>` fails, and drops to the gradient.
 */
export function useArtSlot(slotKey: string, apiDefault?: string | null): ResolvedArtSlot {
  const { active, loading: pending } = useArtSlotRows()
  const override = active.get(slotKey) ?? null

  // Until overrides have loaded, show the gradient rather than a default that
  // an override would replace a moment later. A failed load is not pending:
  // the slot carries on with its defaults.
  const candidates = useMemo(
    () => (pending ? NO_CANDIDATES : artCandidates(slotKey, override, apiDefault)),
    [pending, slotKey, override, apiDefault],
  )

  return {
    src: candidates[0]?.src ?? null,
    source: candidates[0]?.source ?? 'gradient',
    candidates,
    // Focal point and overlay belong to the override's image; defaults are
    // composed to the slot's own brief and sit centred.
    focal: override ? { x: override.focal_x, y: override.focal_y } : DEFAULT_FOCAL,
    overlay: override ? override.overlay : DEFAULT_OVERLAY,
    href: override?.href ?? null,
    override,
  }
}
