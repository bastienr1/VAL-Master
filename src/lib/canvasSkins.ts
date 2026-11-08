/**
 * The looks of the plays canvas (docs/plays-editor-v2.md §2.11): every colour
 * the canvas draws with, per skin. The map art is tinted from two colours, the
 * floor's and the walls', so a skin needs no art of its own.
 *
 * Pure, no imports beyond `playScene`, so `node --test` can type-check it.
 */

import { UTILITY_COLORS } from './playScene.ts'
import type { UtilityKind } from './playDoc.ts'

export const CANVAS_SKIN_IDS = ['graphite', 'teal', 'blueprint', 'radar', 'sand', 'contrast'] as const
export type CanvasSkinId = (typeof CANVAS_SKIN_IDS)[number]

export interface CanvasSkin {
  id: CanvasSkinId
  name: string
  /** One line in the picker: what the skin is for. */
  blurb: string
  /** The void around the map, and the halo behind map text. */
  back: string
  /** The map art's two tints: a floor pixel of luminance² 0 becomes `floor`, a wall of 1 `wall`. */
  floor: string
  wall: string
  mapOpacity: number
  callout: string
  ally: string
  enemy: string
  spike: string
  /** Behind an agent's portrait. */
  tile: string
  /** The name under an ally's tile, and an enemy's. */
  allyName: string
  enemyName: string
  /** Small map labels. */
  label: string
  /** Selection outlines, handles and drafts, and what a drawing stored in white is drawn in. */
  ink: string
  /** The hover and selection card. */
  card: string
  cardBorder: string
  cardText: string
  cardMuted: string
  utility: Record<UtilityKind, string>
}

const DARK_CARD = { card: '#111827', cardBorder: '#242938', cardText: '#F1F5F9', cardMuted: '#94A3B8' }
const DARK = { spike: '#FFCA3A', label: '#CBD5E1', ink: '#FFFFFF', utility: UTILITY_COLORS, ...DARK_CARD }

export const CANVAS_SKINS: Record<CanvasSkinId, CanvasSkin> = {
  graphite: {
    ...DARK,
    id: 'graphite',
    name: 'Graphite',
    blurb: 'Quiet map, so utility and teams carry the colour',
    back: '#101216',
    floor: '#000000',
    wall: '#C9CDD6',
    mapOpacity: 0.75,
    callout: '#8A91A0',
    ally: '#6FB7FF',
    enemy: '#FF5A5F',
    tile: '#1C1F26',
    allyName: '#E5E7EB',
    enemyName: '#FFB3B5',
  },
  teal: {
    ...DARK,
    id: 'teal',
    name: 'Teal',
    blurb: 'The original look',
    back: '#0B1220',
    floor: '#000000',
    wall: '#2BB3C9',
    mapOpacity: 0.85,
    callout: '#5B8A98',
    ally: '#53CADC',
    enemy: '#FF4655',
    tile: '#1A1F2E',
    allyName: '#E2E8F0',
    enemyName: '#FCA5A5',
  },
  blueprint: {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'Light, for screenshots and sharing a strat',
    back: '#E6ECF4',
    floor: '#FBFCFE',
    wall: '#17365C',
    mapOpacity: 1,
    callout: '#47607D',
    ally: '#0B6FC2',
    enemy: '#D1293D',
    spike: '#B7791F',
    tile: '#FFFFFF',
    allyName: '#14263D',
    enemyName: '#A81E30',
    label: '#14263D',
    ink: '#14263D',
    card: '#FFFFFF',
    cardBorder: '#B8C6D8',
    cardText: '#14263D',
    cardMuted: '#47607D',
    utility: {
      ...UTILITY_COLORS,
      smoke: '#6D4FD1',
      recon: '#0E8FA8',
      trap: '#B7791F',
      wall: '#0284C7',
      other: '#64748B',
      stun: '#9333EA',
      flash: '#CA8A04',
    },
  },
  radar: {
    ...DARK,
    id: 'radar',
    name: 'Radar',
    blurb: 'Phosphor green, enemies in amber',
    back: '#07100C',
    floor: '#000000',
    wall: '#4CE08A',
    mapOpacity: 0.8,
    callout: '#5FA47F',
    ally: '#7DF5B0',
    enemy: '#FFB020',
    tile: '#0F1B15',
    allyName: '#D6F5E3',
    enemyName: '#FFD27A',
  },
  sand: {
    ...DARK,
    id: 'sand',
    name: 'Sand',
    blurb: 'Warm and easy on the eyes over long reviews',
    back: '#15110C',
    floor: '#000000',
    wall: '#D9B27C',
    mapOpacity: 0.8,
    callout: '#A8926B',
    ally: '#8FD3FF',
    enemy: '#FF6B4A',
    tile: '#221C14',
    allyName: '#F3E8D2',
    enemyName: '#FFB39E',
  },
  contrast: {
    ...DARK,
    id: 'contrast',
    name: 'High contrast',
    blurb: 'Blue against orange, safe for red-green colour blindness',
    back: '#000000',
    floor: '#000000',
    wall: '#FFFFFF',
    mapOpacity: 1,
    callout: '#D0D0D0',
    ally: '#4DA3FF',
    enemy: '#FF9A1F',
    tile: '#111111',
    allyName: '#FFFFFF',
    enemyName: '#FFC98A',
  },
}

export const DEFAULT_CANVAS_SKIN: CanvasSkinId = 'graphite'

/** The skin of that id; the default for anything else (a value stored by another version). */
export function canvasSkin(id: string | null | undefined): CanvasSkin {
  return (CANVAS_SKIN_IDS as readonly string[]).includes(id ?? '') ? CANVAS_SKINS[id as CanvasSkinId] : CANVAS_SKINS[DEFAULT_CANVAS_SKIN]
}

/** The skin `step` places on from this one in the picker's order, wrapping round. */
export function nextCanvasSkin(id: CanvasSkinId, step: 1 | -1 = 1): CanvasSkinId {
  const n = CANVAS_SKIN_IDS.length
  return CANVAS_SKIN_IDS[(CANVAS_SKIN_IDS.indexOf(id) + step + n) % n]
}

const channels = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A `#rrggbb` as its three 0–255 channels. */
export const hexChannels = channels

/**
 * The `feColorMatrix` values that tint the map art, applied to a grey image
 * (R = G = B): grey 0 becomes the skin's floor, grey 1 its wall. Alpha is kept.
 */
export function skinMapMatrix(skin: Pick<CanvasSkin, 'floor' | 'wall'>): string {
  const f = channels(skin.floor).map(c => c / 255)
  const w = channels(skin.wall).map(c => c / 255)
  const n = (v: number) => Number(v.toFixed(4))
  return [0, 1, 2]
    .map(i => {
      const row = [0, 0, 0, 0, n(f[i])]
      row[i] = n(w[i] - f[i])
      return row.join(' ')
    })
    .concat('0 0 0 1 0')
    .join('  ')
}

/** A drawing's stored colour as this skin shows it: stored white is the skin's ink, so it stays visible on a light map. */
export function skinDrawColor(skin: Pick<CanvasSkin, 'ink'>, color: string): string {
  return color.trim().toUpperCase() === '#FFFFFF' ? skin.ink : color
}
