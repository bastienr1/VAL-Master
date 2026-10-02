# Bundled art

Default pictures for the Home dashboard. Drop a file here with the exact name
below and it shows up on the next page load, with no code change.

A slot with no file here is not an error: it shows a plain gradient until a file
arrives. An image set in **Settings → Home Art** always wins over the file here.

| File | Size | Composition |
|---|---|---|
| `hero.background.webp` | 2560×1100 | Subject in the right third. Left 45% calm for the headline |
| `tile.playbook.webp` | 1200×600 | Bottom-left kept clear for title + subline |
| `tile.stats.webp` | 1200×600 | Bottom-left kept clear for title + subline |
| `tile.provod.webp` | 1200×600 | Bottom-left kept clear for title + subline |
| `tile.goals.webp` | 1200×600 | Bottom-left kept clear for title + subline |
| `cta.banner.webp` | 2400×400 | Centre-left calm for the headline |

Export as **WebP, quality ~82**. The hero should land around 300–400 KB.

## Maps and agents

These use the game's own art by default, so they need no file. To replace one,
upload it in Settings → Home Art, or drop a file here named after its Riot UUID
(used only if the game's image fails to load):

| File | Size | Composition |
|---|---|---|
| `map.<uuid>.webp` | 900×1200 portrait | Landmark in the upper half. Lower 40% gets the stats overlay |
| `agent.<uuid>.webp` | 800×800 | Face in the upper-centre |

A map's own page can also take a wide header, `mapheader.<uuid>` (2400×600,
landmark centre-right, left 40% calm for the map name). It is upload-only, in
Settings → Home Art → Maps & Agents → Map page headers: with none set the page
uses the map picture above.

The slot list and sizes come from `src/lib/artSlots.ts`.
