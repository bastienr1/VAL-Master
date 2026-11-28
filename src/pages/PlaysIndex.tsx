import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Crosshair, Plus } from 'lucide-react'
import EmptyLine from '../components/EmptyLine'
import { useGameContent } from '../hooks/useGameContent'
import { useResource } from '../hooks/useResource'
import { agentIconUrl, mapImageFor, resolveAgentId } from '../lib/gameContent'
import { parseOrigin } from '../lib/playDoc'
import { playsResource } from '../lib/plays'
import { originBack } from '../lib/strategyLink'
import { hasTags, parseStratCard, tagCounts, type StratCard } from '../lib/stratCard'
import { stratRoundsResource } from '../lib/stratRounds'
import type { Play, PlaySide } from '../lib/types'

const SIDE_CHIPS: Record<PlaySide, { label: string; className: string }> = {
  attack: { label: 'Attack', className: 'text-val-red bg-val-red/10' },
  defense: { label: 'Defense', className: 'text-val-cyan bg-val-cyan/10' },
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function NewPlayButton() {
  return (
    <Link
      to="/plays/new"
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-val-cyan/10 text-val-cyan border border-val-cyan/25 rounded-lg hover:bg-val-cyan/20 transition-colors whitespace-nowrap"
    >
      <Plus className="w-4 h-4" />
      <span className="text-sm font-medium">New strat</span>
    </Link>
  )
}

/** At most this many tags on a card; the rest are a count. */
const CARD_TAGS = 3

/** Where a stored play came from, read as loosely as the editor reads it. */
function originOf(play: Play) {
  const raw: unknown = play.play?.replay
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? parseOrigin(raw as Record<string, unknown>) : null
}

/**
 * One saved play as a strat card (docs/plays-editor-v2.md §2.30): the map art
 * behind a scrim, the "When you see…" line, its tags, and the round it came
 * from. The whole card opens the play; the round link sits above it.
 */
function PlayCard({ play, card, rounds }: { play: Play; card: StratCard | null; rounds: number }) {
  const image = mapImageFor({ map_id: play.map_uuid, map: play.map })
  const side = SIDE_CHIPS[play.side]
  // Names the registry does not know are skipped: no broken icon for a typo.
  const agents = play.comp
    .slice(0, 5)
    .map(name => ({ name, id: resolveAgentId(name) }))
    .filter((a): a is { name: string; id: string } => a.id !== null)
  const summary = play.play?.summary
  const back = originBack(originOf(play))
  const tags = card?.tags ?? []

  return (
    <div className="group relative aspect-[2/1] rounded-xl overflow-hidden border border-bg-elevated bg-bg-card hover:border-val-cyan/50 focus-within:border-val-cyan transition-colors">
      <Link to={`/plays/${play.id}`} aria-label={play.title} className="absolute inset-0 z-10 outline-none" />
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-bg-elevated" />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-bg-primary/95 via-bg-primary/50 to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 p-4 space-y-1.5 min-w-0">
        <div className="font-heading text-lg font-bold leading-tight tracking-wide line-clamp-1" title={play.title}>
          {play.title}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${side.className}`}>
            {side.label}
          </span>
          {agents.length > 0 && (
            <div className="flex items-center gap-1">
              {agents.map(a => (
                <img
                  key={a.id}
                  src={agentIconUrl(a.id)}
                  alt={a.name}
                  title={a.name}
                  loading="lazy"
                  className="w-5 h-5 rounded-full bg-bg-elevated object-cover"
                />
              ))}
            </div>
          )}
        </div>
        {card?.when ? (
          <div className="text-xs text-text-primary line-clamp-2" title={card.when}>
            <span className="text-text-muted">When you see </span>
            {card.when}
          </div>
        ) : (
          summary && <div className="text-xs text-text-secondary line-clamp-1">{summary}</div>
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          {tags.slice(0, CARD_TAGS).map(tag => (
            <span key={tag} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-val-cyan/10 text-val-cyan border border-val-cyan/20 whitespace-nowrap">
              {tag}
            </span>
          ))}
          {tags.length > CARD_TAGS && <span className="text-[10px] text-text-muted">+{tags.length - CARD_TAGS}</span>}
          {rounds > 0 && (
            <span className="text-[11px] text-text-secondary ml-auto shrink-0" title="Rounds it is marked as seen on">
              {rounds} round{rounds === 1 ? '' : 's'}
            </span>
          )}
          <span className={`font-stats text-[11px] text-text-muted shrink-0 ${rounds > 0 ? '' : 'ml-auto'}`}>{shortDate(play.updated_at)}</span>
          {back && (
            <Link
              to={back.to}
              title={back.title}
              className="relative z-20 shrink-0 inline-flex items-center gap-0.5 text-[11px] text-text-secondary hover:text-val-cyan transition-colors"
            >
              {back.label}
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

const SIDES: { value: PlaySide | null; label: string }[] = [
  { value: null, label: 'Both' },
  { value: 'attack', label: 'Attack' },
  { value: 'defense', label: 'Defense' },
]

const chipClass = (on: boolean) =>
  `text-xs px-2 py-1 rounded-md border transition-colors whitespace-nowrap ${
    on ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/30' : 'text-text-secondary border-bg-elevated hover:text-text-primary hover:border-text-muted/40'
  }`

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * `/plays` — every set play the user has drawn, grouped by map so a pre-game
 * look-up is one scroll. Each card opens the designer on that play.
 */
export default function PlaysIndex() {
  const { data, loading, error } = useResource(playsResource)
  // Map and agent art resolve through the registry; this re-renders the cards once it has loaded.
  useGameContent()

  // The filters live in the address (?map=Bind&side=attack&tag=Retake&tag=B+hit), so a filtered library can be linked to.
  const [params, setParams] = useSearchParams()
  const mapPick = params.get('map')
  const sideRaw = params.get('side')
  const sidePick: PlaySide | null = sideRaw === 'attack' || sideRaw === 'defense' ? sideRaw : null
  const tagPicks = params.getAll('tag')

  const all = useMemo(() => data ?? [], [data])
  // How many rounds each strat is marked as seen on (§2.31); none while the table is missing.
  const { data: links } = useResource(stratRoundsResource)
  const roundCounts = new Map<string, number>()
  for (const l of links ?? []) roundCounts.set(l.play_id, (roundCounts.get(l.play_id) ?? 0) + 1)
  const cards = useMemo(() => new Map(all.map(p => [p.id, parseStratCard(p.play?.card)])), [all])
  const maps = useMemo(() => [...new Set(all.map(p => p.map))].sort((a, b) => a.localeCompare(b)), [all])
  const onMapAndSide = all.filter(p => (!mapPick || p.map === mapPick) && (!sidePick || p.side === sidePick))
  // Tags of the plays on the map and side picked, so a tag chip never leads to an empty page;
  // a picked tag stays, at 0, so it can be taken off after the map or side changed.
  const counted = tagCounts(onMapAndSide.map(p => cards.get(p.id) ?? null))
  const tags = [
    ...counted,
    ...tagPicks.filter(t => !counted.some(c => sameTag(c.tag, t))).map(tag => ({ tag, count: 0 })),
  ]
  const shown = onMapAndSide.filter(p => hasTags(cards.get(p.id) ?? null, tagPicks))
  const filtered = Boolean(mapPick || sidePick || tagPicks.length > 0)

  const groups = new Map<string, Play[]>()
  for (const p of shown) groups.set(p.map, [...(groups.get(p.map) ?? []), p])
  const byMap = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))

  const setFilter = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    change(next)
    setParams(next, { replace: true })
  }
  const toggleTag = (tag: string) =>
    setFilter(next => {
      const now = next.getAll('tag')
      next.delete('tag')
      const on = now.some(t => sameTag(t, tag))
      for (const t of on ? now.filter(t => !sameTag(t, tag)) : [...now, tag]) next.append('tag', t)
    })

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold">Strategizer</h1>
          <div className="flex items-baseline gap-3">
            <p className="text-text-secondary text-sm">Your strats, drawn on the map</p>
            <Link to="/playbook" className="text-sm text-text-secondary hover:text-val-cyan transition-colors">
              Guides →
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/plays/lineups"
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg-card text-text-primary border border-bg-elevated rounded-lg hover:border-val-cyan/50 hover:text-val-cyan transition-colors whitespace-nowrap"
          >
            <Crosshair className="w-4 h-4" />
            <span className="text-sm font-medium">Line-ups</span>
          </Link>
          <NewPlayButton />
        </div>
      </div>

      {error && (
        <div className="border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2">
          Couldn't load your strats: {error}
        </div>
      )}

      {all.length > 0 && (
        <div className="space-y-2" role="search" aria-label="Filter the strats">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={mapPick ?? ''}
              onChange={e => {
                const value = e.target.value
                setFilter(next => (value ? next.set('map', value) : next.delete('map')))
              }}
              aria-label="Map"
              className="bg-bg-card border border-bg-elevated rounded-md text-sm px-2 py-1 focus:border-val-cyan outline-none"
            >
              <option value="">All maps</option>
              {maps.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div role="group" aria-label="Side" className="flex items-center gap-1">
              {SIDES.map(s => (
                <button
                  key={s.label}
                  type="button"
                  aria-pressed={sidePick === s.value}
                  onClick={() => setFilter(next => (s.value ? next.set('side', s.value) : next.delete('side')))}
                  className={chipClass(sidePick === s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-text-muted ml-auto">
              {shown.length} of {all.length}
            </span>
            {filtered && (
              <button type="button" onClick={() => setParams({}, { replace: true })} className="text-xs text-text-secondary hover:text-val-cyan underline">
                Clear filters
              </button>
            )}
          </div>
          {tags.length > 0 && (
            <div role="group" aria-label="Tags" className="flex flex-wrap items-center gap-1.5">
              {tags.map(({ tag, count }) => {
                const on = tagPicks.some(t => sameTag(t, tag))
                return (
                  <button key={tag} type="button" aria-pressed={on} onClick={() => toggleTag(tag)} className={chipClass(on)}>
                    {tag} <span className="font-stats text-text-muted">{count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="aspect-[2/1] rounded-xl bg-bg-card animate-pulse" />
          ))}
        </div>
      ) : byMap.length > 0 ? (
        byMap.map(([map, plays]) => (
          <section key={map} className="space-y-3">
            <h2 className="font-heading text-xl font-bold">{map}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {plays.map(p => (
                <PlayCard key={p.id} play={p} card={cards.get(p.id) ?? null} rounds={roundCounts.get(p.id) ?? 0} />
              ))}
            </div>
          </section>
        ))
      ) : filtered ? (
        <EmptyLine>
          <p>No strat matches these filters.</p>
        </EmptyLine>
      ) : (
        !error && (
          <EmptyLine>
            <p>Build your first strat: place agents and abilities on the map, or start from one of your replays.</p>
            <div className="mt-4">
              <NewPlayButton />
            </div>
          </EmptyLine>
        )
      )}
    </div>
  )
}
