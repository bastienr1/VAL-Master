import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Map as MapIcon } from 'lucide-react'
import ArtSlot from '../components/ArtSlot'
import ContentShelf from '../components/ContentShelf'
import GameImage from '../components/GameImage'
import MapAgentPanel from '../components/MapAgentPanel'
import PlaybookCard from '../components/PlaybookCard'
import ReviewCard from '../components/ReviewCard'
import { usePortalMaps } from '../hooks/useMapContent'
import { mapSlotKey } from '../lib/artSlots'
import { agentImageFor, mapImageFor } from '../lib/gameContent'
import { formatScore, summarize } from '../lib/homeStats'
import { contentForMap, filterContentByAgent, mapSlug, type MapVod } from '../lib/mapContent'
import { agentStatsForMap, pickBestAgent } from '../lib/mapStats'

// Class names spelled out in full so Tailwind sees them.
const RESULT = {
  W: { label: 'W', text: 'text-val-cyan', chip: 'bg-val-cyan/20 text-val-cyan border-val-cyan/30' },
  L: { label: 'L', text: 'text-val-red', chip: 'bg-val-red/20 text-val-red border-val-red/30' },
  draw: { label: 'DRAW', text: 'text-val-yellow', chip: 'bg-val-yellow/20 text-val-yellow border-val-yellow/30' },
} as const

/** One of the player's matches on the map, opening its review. */
function VodCard({ vod }: { vod: MapVod }) {
  const { match, reviewed } = vod
  const result = RESULT[match.result]
  const date = new Date(match.match_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <Link
      to={`/review/${match.match_id}`}
      className="group block bg-bg-card border border-bg-elevated rounded-xl overflow-hidden hover:border-val-cyan/30 transition-all"
    >
      <div className="relative h-28">
        <GameImage
          kind="map"
          src={mapImageFor(match)}
          alt={match.map}
          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-card to-transparent" />

        {reviewed && (
          <span className="absolute top-2 left-3 px-1.5 py-0.5 rounded bg-val-cyan/15 text-val-cyan text-[10px] font-medium">
            Reviewed
          </span>
        )}
        <span className="absolute top-2 right-3 font-stats text-[10px] text-text-secondary">{date}</span>

        <div className="absolute bottom-2 left-3 right-3 flex items-center gap-2 min-w-0">
          <GameImage
            kind="agent"
            src={agentImageFor(match)}
            alt={match.agent}
            className="w-10 h-10 rounded-full border-2 border-bg-card shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold text-base leading-tight text-text-primary truncate">{match.agent}</div>
            <div className="font-stats text-[11px] text-text-secondary truncate">
              {match.acs} ACS · {match.kills}/{match.deaths}/{match.assists}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`font-stats text-lg font-bold leading-tight ${result.text}`}>{formatScore(match.score)}</div>
            <span className={`inline-block px-1.5 text-[10px] font-bold rounded border ${result.chip}`}>
              {result.label}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

/** `/maps/:slug` — everything the player has for one map, on four shelves. */
export default function MapHub() {
  const { slug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { maps, grouped, guideCounts, loading, error } = usePortalMaps()

  const map = maps.find(m => mapSlug(m.name) === mapSlug(slug)) ?? null
  const content = map ? contentForMap(grouped, map.name) : null

  // Everything about the player on this map comes from their matches on it.
  // One map's worth of rows, so it is recounted each render rather than memoised.
  const played = (content?.myVods ?? []).map(v => v.match)
  const record = summarize(played)
  const agentStats = agentStatsForMap(played)
  const agents = agentStats.map(a => a.name)

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!map || !content) {
    return (
      <div className="max-w-md mx-auto mt-16 bg-bg-card border border-bg-elevated rounded-xl p-8 flex flex-col items-center text-center">
        <MapIcon className="w-12 h-12 text-text-muted mb-3" />
        <h1 className="text-xl font-heading font-bold mb-1">Map not found</h1>
        <p className="text-text-secondary text-sm mb-5">
          There is no map called “{slug}” in the competitive pool.
        </p>
        <Link to="/maps" className="inline-flex items-center gap-1.5 text-sm text-val-cyan hover:underline">
          <ArrowLeft className="w-4 h-4" />
          All maps
        </Link>
      </div>
    )
  }

  // `?agent=` makes "Raze on Ascent" a link. A name the player hasn't played
  // here is ignored rather than shown as an empty page.
  const wanted = searchParams.get('agent')?.trim().toLowerCase()
  const agent = agents.find(name => name.toLowerCase() === wanted) ?? null
  const shown = filterContentByAgent(content, agent)

  const selectAgent = (name: string | null) => setSearchParams(name ? { agent: name } : {}, { replace: true })

  const chip = (active: boolean) =>
    `pl-1 pr-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
      active
        ? 'bg-val-cyan/10 text-val-cyan border-val-cyan/30'
        : 'bg-transparent text-text-muted border-bg-elevated hover:border-text-muted'
    }`

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <ArtSlot
        slotKey={mapSlotKey(map.uuid ?? mapSlug(map.name))}
        apiDefault={map.splash}
        scrim="left"
        defaultOverlay={0.85}
        className="rounded-xl border border-bg-elevated"
      >
        <div className="relative px-6 py-8 min-h-[11rem] flex flex-col justify-end">
          <Link
            to="/maps"
            className="inline-flex items-center gap-1.5 self-start text-xs text-text-secondary hover:text-val-cyan transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            All maps
          </Link>
          <h1 className="mt-2 font-display italic font-extrabold uppercase text-6xl leading-none tracking-wide">{map.name}</h1>
          <p className="mt-2 font-stats text-sm text-text-secondary">
            {record.total === 0 ? (
              'Not played yet'
            ) : (
              <>
                <span className="text-val-cyan">{record.wins}W</span> <span className="text-val-red">{record.losses}L</span>
                {record.draws > 0 && <> {record.draws}D</>}
                {record.winRate !== null && <> · {record.winRate}% WR</>} · {record.total}{' '}
                {record.total === 1 ? 'match' : 'matches'}
              </>
            )}
          </p>
        </div>
      </ArtSlot>

      {error && (
        <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
          Couldn't load everything — {error}
        </div>
      )}

      <MapAgentPanel
        mapName={map.name}
        agents={agentStats}
        best={pickBestAgent(agentStats)}
        selected={agent}
        onSelectAgent={selectAgent}
        playbooksLink={content.playbooks.length > 0 ? `/playbook?map=${encodeURIComponent(map.name)}` : null}
      />

      {agents.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted w-12 shrink-0">Agent</span>
          <button type="button" onClick={() => selectAgent(null)} aria-pressed={agent === null} className={`${chip(agent === null)} pl-2.5`}>
            All
          </button>
          {agents.map(name => (
            <button key={name} type="button" onClick={() => selectAgent(name)} aria-pressed={agent === name} className={chip(agent === name)}>
              <GameImage kind="agent" src={agentImageFor({ agent: name })} alt="" className="w-4 h-4 rounded-full shrink-0" />
              {name}
            </button>
          ))}
        </div>
      )}

      <ContentShelf title="My VODs" emptyLine={`Play ${map.name}, hit Load Latest, then add a VOD link to the match.`}>
        {shown.myVods.map(vod => (
          <VodCard key={vod.match.match_id} vod={vod} />
        ))}
      </ContentShelf>

      <ContentShelf title="Strategy" emptyLine="Import a playbook from the vault: Playbook → Import from vault.">
        {shown.playbooks.map(playbook => (
          <PlaybookCard key={playbook.id} playbook={playbook} />
        ))}
      </ContentShelf>

      <ContentShelf title="Video guides" emptyLine="File a map guide in the vault, then run npm run import:guides.">
        {shown.guides.map(review => (
          <ReviewCard key={review.id} review={review} counts={guideCounts.get(review.id)} />
        ))}
      </ContentShelf>

      <ContentShelf
        title="Pro VODs"
        emptyLine={
          agent && content.proVods.length > 0
            ? `No pro VODs of ${agent} on ${map.name} yet. Add one in Notion, then re-seed.`
            : 'Add pro VODs in Notion, then re-seed: npm run seed:prostudy.'
        }
      >
        {shown.proVods.map(review => (
          <ReviewCard key={review.id} review={review} counts={guideCounts.get(review.id)} />
        ))}
      </ContentShelf>
    </div>
  )
}
