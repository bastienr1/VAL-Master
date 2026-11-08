/**
 * The plays canvas' size options (docs/plays-editor-v2.md §2.13): how big the
 * callout and player names are, whether each grows with the zoom, and how big
 * the agent tiles are. Per device, not part of a play.
 *
 * Pure, no imports, so `node --test` can type-check it.
 */

export const CALLOUT_SIZES = [
  { id: 's', label: 'S', name: 'Small', units: 15 },
  { id: 'm', label: 'M', name: 'Medium', units: 18 },
  { id: 'l', label: 'L', name: 'Large', units: 22 },
  { id: 'xl', label: 'XL', name: 'Extra large', units: 28 },
] as const
export type CalloutSizeId = (typeof CALLOUT_SIZES)[number]['id']

export const NAME_SIZES = [
  { id: 's', label: 'S', name: 'Small', units: 13 },
  { id: 'm', label: 'M', name: 'Medium', units: 16 },
  { id: 'l', label: 'L', name: 'Large', units: 20 },
  { id: 'xl', label: 'XL', name: 'Extra large', units: 26 },
] as const
export type NameSizeId = (typeof NAME_SIZES)[number]['id']

/** Tiles are drawn at 44 viewBox units, then scaled. An agent's position is the tile's centre at every size. */
export const AGENT_SIZES = [
  { id: 's', label: 'S', name: 'Small', scale: 0.6 },
  { id: 'm', label: 'M', name: 'Medium', scale: 0.77 },
  { id: 'l', label: 'L', name: 'Large', scale: 1 },
] as const
export type AgentSizeId = (typeof AGENT_SIZES)[number]['id']

export interface CanvasSizes {
  callout: CalloutSizeId
  /** True: callout names grow and shrink with the map. False: they keep their size on screen. */
  calloutsFollowZoom: boolean
  /** The player names under the agent icons. */
  name: NameSizeId
  /** True: player names grow and shrink with the map. False: they keep their size on screen. */
  namesFollowZoom: boolean
  agent: AgentSizeId
}

export const DEFAULT_CANVAS_SIZES: CanvasSizes = { callout: 'l', calloutsFollowZoom: false, name: 'l', namesFollowZoom: false, agent: 'm' }

export const calloutUnits = (id: CalloutSizeId): number => CALLOUT_SIZES.find(s => s.id === id)?.units ?? 22
export const nameUnits = (id: NameSizeId): number => NAME_SIZES.find(s => s.id === id)?.units ?? 20
export const agentScale = (id: AgentSizeId): number => AGENT_SIZES.find(s => s.id === id)?.scale ?? 1

/** The sizes stored as JSON, field by field; anything unknown takes its default. */
export function parseCanvasSizes(raw: string | null | undefined): CanvasSizes {
  let value: Partial<Record<keyof CanvasSizes, unknown>> = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (parsed && typeof parsed === 'object') value = parsed
  } catch {
    /* a broken value is the defaults */
  }
  return {
    callout: CALLOUT_SIZES.find(s => s.id === value.callout)?.id ?? DEFAULT_CANVAS_SIZES.callout,
    calloutsFollowZoom: typeof value.calloutsFollowZoom === 'boolean' ? value.calloutsFollowZoom : DEFAULT_CANVAS_SIZES.calloutsFollowZoom,
    name: NAME_SIZES.find(s => s.id === value.name)?.id ?? DEFAULT_CANVAS_SIZES.name,
    namesFollowZoom: typeof value.namesFollowZoom === 'boolean' ? value.namesFollowZoom : DEFAULT_CANVAS_SIZES.namesFollowZoom,
    agent: AGENT_SIZES.find(s => s.id === value.agent)?.id ?? DEFAULT_CANVAS_SIZES.agent,
  }
}
