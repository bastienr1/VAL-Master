/**
 * The maps that have a baked ground picture: the level's own floor textures
 * seen straight down, roofs removed, framed on the same world rectangle as the
 * Riot minimap art, so it sits under that art with the same placement and turn
 * (docs/plays-editor-v2.md §2.11).
 *
 * Each map has one picture per look, `public/maps/ground/<map uuid>-<look>.webp`,
 * 4096 px square with transparent walls, made outside the app by the bake in
 * `VAL_REPLAY_HOME/mapbake`. A map joins this list when both its files are added.
 *
 * Pure, no imports, so `node --test` can type-check it.
 */

/**
 * How a ground is lit: `lit` by the level's own sun, sky and lamps, so each
 * room keeps its mood; `unlit` evenly, so every floor shows its plain colour.
 */
export const GROUND_LOOKS = ['lit', 'unlit'] as const
export type GroundLook = (typeof GROUND_LOOKS)[number]

/** Map uuid (valorant-api) of every map with a bake, by name. */
export const GROUND_MAPS: Readonly<Record<string, string>> = {
  Abyss: '224b0a95-48b9-f703-1bd8-67aca101a61f',
  Ascent: '7eaecc1b-4337-bbf6-6ab9-04b8f06b3319',
  Bind: '2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba',
  Breeze: '2fb9a4fd-47b8-4e7d-a969-74b4046ebd53',
  Corrode: '1c18ab1f-420d-0d8b-71d0-77ad3c439115',
  Fracture: 'b529448b-4d60-346e-e89e-00a4c527a405',
  Haven: '2bee0dc9-4ffe-519b-1cbd-7fbe763a6047',
  Icebox: 'e2ad5c54-4114-a870-9641-8ea21279579a',
  Lotus: '2fe4ed3a-450a-948b-6d6b-e89a78e680a9',
  Pearl: 'fd267378-4d1d-484f-ff52-77821ed10dc2',
  Split: 'd960549e-485c-e861-8d71-aa9d1aed12a2',
  Summit: '756da597-416b-c0f2-f47b-afbdf28670bc',
  Sunset: '92584fbe-486a-b1b2-9faa-39b0f486b498',
}

const GROUND_IDS: ReadonlySet<string> = new Set(Object.values(GROUND_MAPS))

/** The baked ground of that map in that look, or null when the map has none. */
export function mapGroundUrl(mapUuid: string | null | undefined, look: GroundLook = 'lit'): string | null {
  const id = (mapUuid ?? '').toLowerCase()
  return GROUND_IDS.has(id) ? `/maps/ground/${id}-${look}.webp` : null
}
