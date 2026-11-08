import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import EmptyLine from '../components/EmptyLine'
import { useGameContent } from '../hooks/useGameContent'
import { useResource } from '../hooks/useResource'
import { agentIconUrl, mapImageFor, resolveAgentId } from '../lib/gameContent'
import { playsResource } from '../lib/plays'
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
      <span className="text-sm font-medium">New play</span>
    </Link>
  )
}

/** One saved play: the map art behind a scrim, and what the play is at a glance. */
function PlayCard({ play }: { play: Play }) {
  const image = mapImageFor({ map_id: play.map_uuid, map: play.map })
  const side = SIDE_CHIPS[play.side]
  // Names the registry does not know are skipped: no broken icon for a typo.
  const agents = play.comp
    .slice(0, 5)
    .map(name => ({ name, id: resolveAgentId(name) }))
    .filter((a): a is { name: string; id: string } => a.id !== null)
  const summary = play.play?.summary

  return (
    <Link
      to={`/plays/${play.id}`}
      className="group relative block aspect-[2/1] rounded-xl overflow-hidden border border-bg-elevated bg-bg-card hover:border-val-cyan/50 outline-none focus-visible:border-val-cyan transition-colors"
    >
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
        {summary && <div className="text-xs text-text-secondary line-clamp-1">{summary}</div>}
        <div className="font-stats text-[11px] text-text-muted">{shortDate(play.updated_at)}</div>
      </div>
    </Link>
  )
}

/**
 * `/plays` — every set play the user has drawn, grouped by map so a pre-game
 * look-up is one scroll. Each card opens the designer on that play.
 */
export default function PlaysIndex() {
  const { data, loading, error } = useResource(playsResource)
  // Map and agent art resolve through the registry; this re-renders the cards once it has loaded.
  useGameContent()

  const byMap = useMemo(() => {
    const groups = new Map<string, Play[]>()
    for (const p of data ?? []) groups.set(p.map, [...(groups.get(p.map) ?? []), p])
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [data])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold">Plays</h1>
          <div className="flex items-baseline gap-3">
            <p className="text-text-secondary text-sm">Your set plays, drawn on the map</p>
            <Link to="/playbook" className="text-sm text-text-secondary hover:text-val-cyan transition-colors">
              Guides →
            </Link>
          </div>
        </div>
        <NewPlayButton />
      </div>

      {error && (
        <div className="border border-val-red/25 bg-val-red/10 text-val-red text-sm rounded-md px-3 py-2">
          Couldn't load plays: {error}
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
                <PlayCard key={p.id} play={p} />
              ))}
            </div>
          </section>
        ))
      ) : (
        !error && (
          <EmptyLine>
            <p>Build your first play: place agents and abilities on the map, or start from one of your replays.</p>
            <div className="mt-4">
              <NewPlayButton />
            </div>
          </EmptyLine>
        )
      )}
    </div>
  )
}
