import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Clapperboard, Image as ImageIcon, Map as MapIcon, Plus } from 'lucide-react'
import ArtSlot from '../components/ArtSlot'
import EmptyLine from '../components/EmptyLine'
import PurposeChips from '../components/PurposeChips'
import { useGameContent } from '../hooks/useGameContent'
import { mapSlotKey } from '../lib/artSlots'
import { agentIconUrl } from '../lib/gameContent'
import {
  PURPOSE_LABELS,
  boardLink,
  groupByAbility,
  libraryLink,
  libraryPick,
  libraryTree,
  ofPurpose,
  parsePurposeFilter,
  pictureCount,
  purposePick,
  recipeLine,
  type Lineup,
  type LineupSide,
  type PurposeFilter,
} from '../lib/lineupModel'
import { lineupImageUrl, listLineups, type LineupsState } from '../lib/lineups'
import type { AbilitySlot } from '../lib/playDoc'

const SIDES: readonly LineupSide[] = ['attack', 'defense']
const SIDE_LABELS: Record<LineupSide, string> = { attack: 'Attack', defense: 'Defense' }

const count = (n: number) => `${n} ${n === 1 ? 'line-up' : 'line-ups'}`

/** A step of the walk, named the way a folder path is: what it asks, and what was answered before it. */
function StepTitle({ step, title, trail }: { step: number; title: string; trail?: string }) {
  return (
    <h2 className="flex items-center gap-2 text-xs uppercase tracking-wider text-text-muted">
      <span className="w-5 h-5 rounded-full bg-bg-elevated text-text-secondary font-stats text-[11px] flex items-center justify-center">{step}</span>
      <span className="text-text-secondary font-semibold">{title}</span>
      {trail && (
        <>
          <ChevronRight className="w-3 h-3" aria-hidden="true" />
          <span className="normal-case tracking-normal">{trail}</span>
        </>
      )}
    </h2>
  )
}

/** One line-up of the library: its best picture, its name, its recipe. Opens on the board, under the purpose it was found by. */
function LineupTile({ lineup, purpose }: { lineup: Lineup; purpose: PurposeFilter | null }) {
  const picture = lineup.result_image ?? lineup.aim_image ?? lineup.stand_image
  const recipe = recipeLine(lineup)
  // Where from and where to, unless the name already says both (the name the board gives does).
  const named = !!lineup.stand_callout && !!lineup.land_callout && lineup.title.includes(lineup.stand_callout) && lineup.title.includes(lineup.land_callout)
  const way = lineup.stand_callout && lineup.land_callout && !named ? `${lineup.stand_callout} → ${lineup.land_callout}` : null
  return (
    <Link
      to={boardLink({ id: lineup.id, purpose })}
      className="group block rounded-xl overflow-hidden bg-bg-card border border-bg-elevated hover:border-val-cyan/50 focus-visible:border-val-cyan outline-none transition-colors"
    >
      <div className="relative aspect-video bg-bg-primary">
        {picture ? (
          <img src={lineupImageUrl(picture)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-text-muted">
            <ImageIcon className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-[11px]">No picture yet</span>
          </div>
        )}
        {/* The line-up's own line colour, as it is drawn on the map. */}
        {lineup.line_color && <span className="absolute inset-x-0 bottom-0 h-1" style={{ backgroundColor: lineup.line_color }} aria-hidden="true" />}
        {lineup.purpose && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-bg-primary/85 text-[11px] text-text-secondary">{PURPOSE_LABELS[lineup.purpose]}</span>
        )}
      </div>
      <div className="px-3 py-2.5 space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight line-clamp-2" title={lineup.title}>
            {lineup.title}
          </span>
          <span className="shrink-0 flex items-center gap-1.5 pt-0.5 text-[11px] text-text-muted font-stats">
            {lineup.video_url && <Clapperboard className="w-3.5 h-3.5" aria-label="Has a clip" />}
            <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
            {pictureCount(lineup)}/3
          </span>
        </div>
        {way && <div className="text-[11px] text-text-muted line-clamp-1">{way}</div>}
        {recipe && <div className="text-[11px] text-text-secondary line-clamp-1">{recipe}</div>}
      </div>
    </Link>
  )
}

/**
 * `/plays/lineups`: the line-ups that exist, walked the way they are looked
 * for. Maps first, then the map's agents, then the side; what is left is a
 * handful of line-ups, each a way into the board at `/plays/lineups/board`,
 * where line-ups are drawn and edited. The address holds the walk, so a place
 * in the library is a link and Back steps out of it. At the last step the
 * line-ups can be narrowed to one purpose, which is kept from place to place.
 */
export default function LineupLibrary() {
  const { registry } = useGameContent()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [state, setState] = useState<LineupsState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listLineups()
      .then(setState)
      .catch(err => setError(err instanceof Error ? err.message : 'Line-ups could not be loaded.'))
  }, [])

  const rows = useMemo(() => state?.rows ?? [], [state])
  const tree = useMemo(() => libraryTree(rows), [rows])
  const pick = useMemo(() => libraryPick(tree, { map: params.get('map'), agent: params.get('agent'), side: params.get('side') }), [tree, params])
  const pickedMap = tree.find(m => m.map === pick.map) ?? null
  const pickedAgent = pickedMap?.agents.find(a => a.agent === pick.agent) ?? null

  // The game's maps and agents by the name a line-up keeps them under.
  const gameMaps = useMemo(() => new Map(registry ? [...registry.maps.byId.values()].map(m => [m.name, m] as const) : []), [registry])
  const gameAgents = useMemo(() => new Map(registry ? [...registry.agents.byId.values()].map(a => [a.name, a] as const) : []), [registry])

  // Every map the board can draw has a tile, and so does a map that holds line-ups but cannot be drawn right now.
  const mapNames = useMemo(() => {
    const drawable = [...gameMaps.values()].filter(m => m.transform && m.callouts.length > 0).map(m => m.name)
    return [...new Set([...drawable, ...tree.map(m => m.map)])].sort((a, b) => a.localeCompare(b))
  }, [gameMaps, tree])

  // The purpose looked for goes along through the walk: it narrows the last step, wherever that is.
  const askedPurpose = parsePurposeFilter(params.get('purpose'))
  const go = (next: { map?: string | null; agent?: string | null; side?: LineupSide | null }) => navigate(libraryLink({ ...next, purpose: askedPurpose }))

  const inPlace = useMemo(
    () => rows.filter(row => row.map === pick.map && row.agent === pick.agent && row.side === pick.side),
    [rows, pick],
  )
  const purpose = purposePick(inPlace, askedPurpose)
  const shown = ofPurpose(inPlace, purpose)
  const anyPurpose = inPlace.some(row => row.purpose)
  const groups = groupByAbility(shown)
  const agentOf = (name: string) => gameAgents.get(name) ?? null
  const abilityOf = (agent: string, slot: AbilitySlot) => {
    const found = agentOf(agent)?.abilities.find(a => a.slot === slot)
    return { name: found?.name ?? slot, icon: found?.icon ?? null }
  }

  const loading = !state && !error
  const empty = !!state && !state.tableMissing && rows.length === 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/plays" className="text-sm text-text-secondary hover:text-val-cyan transition-colors">
            ← Plays
          </Link>
          <h1 className="font-heading text-3xl font-bold">Line-ups</h1>
          <p className="text-text-secondary text-sm">
            {rows.length > 0 ? `${count(rows.length)} on ${tree.length} ${tree.length === 1 ? 'map' : 'maps'}. Pick a map, then an agent, then a side.` : 'Your library: by map, by agent, by side'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={boardLink({ ...pick, purpose })}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg-card text-text-primary border border-bg-elevated rounded-lg hover:border-val-cyan/50 hover:text-val-cyan transition-colors whitespace-nowrap"
          >
            <MapIcon className="w-4 h-4" />
            <span className="text-sm font-medium">{pick.map ? `Open ${pick.map} on the board` : 'Open the board'}</span>
          </Link>
          <Link
            to={boardLink({ ...pick, purpose, fresh: true })}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">New line-up</span>
          </Link>
        </div>
      </div>

      {state?.tableMissing && (
        <div className="border border-val-yellow/30 bg-val-yellow/10 text-sm rounded-md px-3 py-2">
          The line-ups table is not in the database yet. Run <code className="font-stats">supabase/migrations/20261124_lineups.sql</code> in the Supabase SQL editor, then reload.
        </div>
      )}
      {error && <div className="border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2">{error}</div>}

      {empty && (
        <EmptyLine>
          <p>
            No line-up yet. Open the board, press New line-up, pick the ability, then click where you stand and where it lands. Every line-up you make is filed here by map, agent and side.
          </p>
        </EmptyLine>
      )}

      {/* 1. The map */}
      <section className="space-y-2.5" aria-label="Map">
        <StepTitle step={1} title="Map" />
        {loading && mapNames.length === 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2.5" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="aspect-[4/3] rounded-xl bg-bg-card animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2.5">
            {mapNames.map(name => {
              const gameMap = gameMaps.get(name) ?? null
              const held = tree.find(m => m.map === name) ?? null
              const on = pick.map === name
              const art = (
                <ArtSlot
                  slotKey={mapSlotKey(gameMap?.uuid ?? name)}
                  apiDefault={gameMap?.listViewIconTall ?? null}
                  scrim="bottom"
                  defaultOverlay={0.9}
                  className="aspect-[4/3]"
                  imgClassName={held ? 'group-hover:scale-105' : 'grayscale'}
                >
                  <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2">
                    <div className="font-display italic font-bold uppercase text-lg leading-none tracking-wide text-text-primary">{name}</div>
                    <div className={`mt-1 text-[11px] font-stats ${held ? 'text-text-primary/90' : 'text-text-muted'}`}>{held ? count(held.count) : 'None yet'}</div>
                  </div>
                </ArtSlot>
              )
              // A map with line-ups opens its agents; one without is a way to the board, to make its first.
              return held ? (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => go(on ? {} : { map: name })}
                  className={`group block text-left rounded-xl overflow-hidden border-2 outline-none transition-colors ${
                    on ? 'border-val-cyan' : 'border-bg-elevated hover:border-val-cyan/50 focus-visible:border-val-cyan'
                  } ${pick.map && !on ? 'opacity-60 hover:opacity-100' : ''}`}
                >
                  {art}
                </button>
              ) : (
                <Link
                  key={name}
                  to={boardLink({ map: name, fresh: true })}
                  title={`No line-up on ${name} yet: make the first on the board`}
                  className="group block rounded-xl overflow-hidden border-2 border-bg-elevated opacity-45 hover:opacity-90 hover:border-val-cyan/40 focus-visible:border-val-cyan outline-none transition"
                >
                  {art}
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* 2. The agent */}
      {pickedMap && (
        <section className="space-y-2.5" aria-label="Agent">
          <StepTitle step={2} title="Agent" trail={pickedMap.map} />
          <div className="flex flex-wrap gap-2.5">
            {pickedMap.agents.map(entry => {
              const agent = agentOf(entry.agent)
              const on = pick.agent === entry.agent
              return (
                <button
                  key={entry.agent}
                  type="button"
                  aria-pressed={on}
                  onClick={() => go(on && pickedMap.agents.length > 1 ? { map: pickedMap.map } : { map: pickedMap.map, agent: entry.agent })}
                  className={`flex items-center gap-3 pl-2 pr-4 py-2 rounded-xl border-2 text-left outline-none transition-colors ${
                    on ? 'bg-val-cyan/10 border-val-cyan' : 'bg-bg-card border-bg-elevated hover:border-val-cyan/50 focus-visible:border-val-cyan'
                  }`}
                >
                  <span className="w-11 h-11 rounded-lg overflow-hidden bg-bg-elevated shrink-0 flex items-center justify-center text-xs text-text-muted">
                    {agent ? <img src={agentIconUrl(agent.uuid)} alt="" className="w-full h-full object-cover" /> : entry.agent.slice(0, 2)}
                  </span>
                  <span className="leading-tight">
                    <span className="block text-sm font-semibold">{entry.agent}</span>
                    <span className="block text-[11px] text-text-muted font-stats">{count(entry.count)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 3. The side, and what is on it */}
      {pickedMap && pickedAgent && pick.side && (
        <section className="space-y-4" aria-label="Side">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <StepTitle step={3} title="Side" trail={`${pickedMap.map} · ${pickedAgent.agent}`} />
            <div className="inline-flex rounded-lg border border-bg-elevated overflow-hidden" role="group" aria-label="Side">
              {SIDES.map(value => {
                const on = pick.side === value
                const n = pickedAgent.sides[value]
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    disabled={n === 0}
                    title={n === 0 ? `${pickedAgent.agent} has no line-up on ${SIDE_LABELS[value].toLowerCase()} here yet` : undefined}
                    onClick={() => go({ map: pickedMap.map, agent: pickedAgent.agent, side: value })}
                    className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      on ? (value === 'attack' ? 'bg-val-red/15 text-val-red' : 'bg-val-cyan/15 text-val-cyan') : 'bg-bg-card text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <span>{SIDE_LABELS[value]}</span>
                    <span className="font-stats text-[11px] opacity-80">{n}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-text-secondary font-semibold">Purpose</span>
              {anyPurpose ? (
                // A filter is a way of looking at this step, not a step: it does not add to Back.
                <PurposeChips rows={inPlace} value={purpose} onPick={next => navigate(libraryLink({ ...pick, purpose: next }), { replace: true })} />
              ) : (
                <span className="text-xs text-text-muted">None set here yet. Give a line-up a purpose on its card to filter by it.</span>
              )}
            </div>
          </div>

          {groups.map(group => {
            const ability = abilityOf(group.agent, group.slot)
            return (
              <div key={group.slot} className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span className="w-7 h-7 rounded-md bg-bg-elevated flex items-center justify-center">
                    {ability.icon ? <img src={ability.icon} alt="" className="w-4 h-4 object-contain" /> : null}
                  </span>
                  <span>{ability.name}</span>
                  <span className="text-[11px] font-normal text-text-muted font-stats">{group.rows.length}</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {group.rows.map(row => (
                    <LineupTile key={row.id} lineup={row} purpose={purpose} />
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* What the next step is, while the walk is not finished. */}
      {rows.length > 0 && !pickedMap && <p className="text-sm text-text-muted">Pick a map to see whose line-ups it holds.</p>}
      {pickedMap && !pickedAgent && <p className="text-sm text-text-muted">Pick an agent to see their line-ups on {pickedMap.map}.</p>}
    </div>
  )
}
