import { Link } from 'react-router-dom'
import ArtSlot from '../ArtSlot'
import { mapSlotKey } from '../../lib/artSlots'
import { mapSlug, type MapContent, type PortalMap } from '../../lib/mapContent'
import type { StatSummary } from '../../lib/homeStats'

interface MapPortalCardProps {
  map: PortalMap
  counts: MapContent['counts']
  /** The player's record on the map, or null when they haven't played it in the period. */
  record: StatSummary | null
  /** What period `record` covers, e.g. `V26A5` or `All time`. */
  recordLabel: string
  className?: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The way into one map's study material. Leads with what there is to study;
 * the player's record is one quiet line, there to help pick what to work on.
 */
export default function MapPortalCard({ map, counts, record, recordLabel, className = '' }: MapPortalCardProps) {
  const empty = counts.guides + counts.proVods + counts.myVods === 0

  return (
    <Link
      to={`/maps/${mapSlug(map.name)}`}
      className={`group block rounded-xl overflow-hidden border border-bg-elevated hover:border-val-cyan/60 focus-visible:border-val-cyan outline-none transition-colors ${className}`}
    >
      <ArtSlot
        slotKey={mapSlotKey(map.uuid ?? mapSlug(map.name))}
        apiDefault={map.listViewIconTall}
        scrim="bottom"
        // The game's art is busy all the way down; the counts need a firm base.
        defaultOverlay={0.9}
        className="aspect-[3/4]"
        imgClassName="group-hover:scale-105"
      >
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="font-display italic font-bold uppercase text-2xl leading-none tracking-wide text-text-primary">
            {map.name}
          </div>
          {empty ? (
            <div className="mt-2 text-xs text-val-yellow/80">Nothing here yet</div>
          ) : (
            <div className="mt-2 text-xs text-text-primary/90 leading-relaxed">
              {plural(counts.guides, 'guide', 'guides')} · {plural(counts.proVods, 'pro VOD', 'pro VODs')}
              <br />
              {plural(counts.myVods, 'your VOD', 'your VODs')}
            </div>
          )}
          {record && record.total > 0 && (
            <div className="mt-1.5 font-stats text-[11px] text-text-secondary">
              {recordLabel} · {record.wins}–{record.losses}
              {record.winRate !== null && ` · ${record.winRate}%`}
            </div>
          )}
        </div>
      </ArtSlot>
    </Link>
  )
}
