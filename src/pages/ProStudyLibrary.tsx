import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, GraduationCap } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { getGuideCounts, listReviews, listWatched, type GuideCounts } from '../lib/referenceReviews'
import { savedDrillsResource } from '../lib/savedDrills'
import { agentImageFor } from '../lib/gameContent'
import {
  GROUP_BY_LABELS,
  GROUP_BY_OPTIONS,
  buildShelves,
  type GroupBy,
} from '../lib/libraryShelves'
import { skillLabel, skillOrder } from '../lib/skillTaxonomy'
import { useGameContent } from '../hooks/useGameContent'
import GameImage from '../components/GameImage'
import LibraryShelf from '../components/LibraryShelf'
import ReviewCard from '../components/ReviewCard'
import { GUIDE_DIFFICULTIES, type GuideContentType, type ReferenceReview } from '../lib/types'

/**
 * The two capture surfaces, as the chip row spells them.
 *
 * There is no "All" chip: `FilterRow` clears on a click of the active chip, so
 * no selection already means everything — one convention across all the rows.
 */
const SOURCE_LABELS = { 'Pro VODs': 'notion', Guides: 'vault' } as const
type SourceLabel = keyof typeof SOURCE_LABELS

const CONTENT_TYPES: GuideContentType[] = [
  'map-guide',
  'pro-review',
  'agent-guide',
  'mechanics',
  'mindset',
]

// --------------------------------------------------------------- remembered UI

const GROUP_BY_KEY = 'prostudy.library.groupBy'
const OPEN_BLOCKS_KEY = 'prostudy.library.open'

/**
 * The grouping and which shelves are open survive a reload, the way the replay
 * layers and the column splitter do. Storage can be missing or blocked, so a
 * failed read is the default and a failed write is nothing.
 */
function readStored<T>(key: string, fallback: T, accept: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return accept(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // nothing to do — the choice just will not be remembered
  }
}

const isGroupBy = (value: unknown): value is GroupBy =>
  typeof value === 'string' && (GROUP_BY_OPTIONS as string[]).includes(value)

const isOpenMap = (value: unknown): value is Record<string, boolean> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// --------------------------------------------------------------------- chips

interface FilterRowProps {
  label: string
  options: string[]
  selected: string | null
  onSelect: (value: string | null) => void
  /** Optional per-option thumbnail — agents are quicker to spot by face. */
  iconFor?: (option: string) => string | null
  /** What the chip says when the option value is not for display (a skill slug). */
  labelFor?: (option: string) => string
}

function FilterRow({ label, options, selected, onSelect, iconFor, labelFor }: FilterRowProps) {
  if (options.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-text-muted w-12 shrink-0">{label}</span>
      {options.map(option => {
        const active = selected === option
        const text = labelFor ? labelFor(option) : option
        return (
          <button
            key={option}
            type="button"
            // Clicking the active chip clears it — no separate "All" chip needed.
            onClick={() => onSelect(active ? null : option)}
            // Vault creators can be a sentence ("Unknown (coaching dojo VOD —
            // names in chat: …)"); the full value stays in the tooltip.
            title={option}
            className={`pl-1 pr-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
              active
                ? 'bg-val-cyan/10 text-val-cyan border-val-cyan/30'
                : 'bg-transparent text-text-muted border-bg-elevated hover:border-text-muted'
            }`}
          >
            {iconFor && (
              <GameImage
                kind="agent"
                src={iconFor(option)}
                alt=""
                className="w-4 h-4 rounded-full shrink-0"
              />
            )}
            <span className={`truncate max-w-[14rem] ${iconFor ? '' : 'pl-1.5'}`}>{text}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------- page

export default function ProStudyLibrary() {
  const [reviews, setReviews] = useState<ReferenceReview[]>([])
  const [counts, setCounts] = useState<Map<string, GuideCounts>>(new Map())
  // Review ids the user marked watched on the review page.
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Mounted so the grid re-renders once the registry lands; resolution itself
  // is synchronous against the shared cache.
  useGameContent()
  const { data: savedDrills } = useResource(savedDrillsResource)

  const [groupBy, setGroupBy] = useState<GroupBy>(() => readStored(GROUP_BY_KEY, 'series', isGroupBy))
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>(() =>
    readStored(OPEN_BLOCKS_KEY, {}, isOpenMap),
  )

  const [source, setSource] = useState<SourceLabel | null>(null)
  const [contentType, setContentType] = useState<string | null>(null)
  const [creator, setCreator] = useState<string | null>(null)
  const [skill, setSkill] = useState<string | null>(null)
  const [difficulty, setDifficulty] = useState<string | null>(null)
  const [player, setPlayer] = useState<string | null>(null)
  const [map, setMap] = useState<string | null>(null)
  const [agent, setAgent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([listReviews(), getGuideCounts(), listWatched()])
      .then(([data, guideCounts, watchedAt]) => {
        if (cancelled) return
        setReviews(data)
        setCounts(guideCounts)
        setWatched(new Set(watchedAt.keys()))
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const chooseGroupBy = (value: GroupBy) => {
    setGroupBy(value)
    writeStored(GROUP_BY_KEY, value)
  }

  const toggleBlock = (key: string) => {
    setOpenBlocks(current => {
      const next = { ...current, [key]: !current[key] }
      writeStored(OPEN_BLOCKS_KEY, next)
      return next
    })
  }

  // The whole library is a couple of hundred rows — filtering stays client-side.
  const options = useMemo(() => {
    const unique = (values: Array<string | null | undefined>) =>
      [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))

    // Every row the source chip lets through, so the remaining rows offer only
    // chips that can actually match. A guide's `player` column holds its creator
    // as a NOT NULL fallback, which would otherwise put sentence-long coaching
    // credits in the Player row.
    const inScope = source ? reviews.filter(r => r.source === SOURCE_LABELS[source]) : reviews
    const proVods = inScope.filter(r => r.source === 'notion')
    const guides = inScope.filter(r => r.source === 'vault')

    return {
      sources: Object.keys(SOURCE_LABELS).filter(label =>
        reviews.some(r => r.source === SOURCE_LABELS[label as SourceLabel]),
      ),
      // Only the content types actually present, in the skill's own order.
      contentTypes: CONTENT_TYPES.filter(type => inScope.some(r => r.content_type === type)),
      creators: unique(guides.map(r => r.creator)),
      // In the taxonomy's order, a value the list does not know after the rest.
      skills: unique(guides.map(r => r.skill)).sort(
        (a, b) => skillOrder(a) - skillOrder(b) || a.localeCompare(b),
      ),
      difficulties: GUIDE_DIFFICULTIES.filter(level => guides.some(r => r.difficulty === level)),
      players: unique(proVods.map(r => r.player)),
      maps: unique(inScope.map(r => r.map)),
      // One chip per agent: a guide names every agent it covers, a pro VOD one.
      agents: unique(inScope.flatMap(r => (r.agents?.length ? r.agents : [r.agent]))),
    }
  }, [reviews, source])

  const filtered = useMemo(
    () =>
      reviews.filter(
        r =>
          (!source || r.source === SOURCE_LABELS[source]) &&
          (!contentType || r.content_type === contentType) &&
          (!creator || r.creator === creator) &&
          (!skill || r.skill === skill) &&
          (!difficulty || r.difficulty === difficulty) &&
          (!player || r.player === player) &&
          (!map || r.map === map) &&
          (!agent || r.agent === agent || (r.agents?.includes(agent) ?? false)),
      ),
    [reviews, source, contentType, creator, skill, difficulty, player, map, agent],
  )

  // Null for Date added — that is the flat grid below.
  const shelves = useMemo(
    () => buildShelves(filtered, counts, groupBy, watched),
    [filtered, counts, groupBy, watched],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <GraduationCap className="w-5 h-5 text-val-cyan" />
        <h1 className="font-heading text-xl font-bold tracking-wide">Pro Study</h1>
        <span className="text-text-muted text-xs ml-1">
          {filtered.length === reviews.length
            ? `${reviews.length} VOD${reviews.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${reviews.length}`}
        </span>
        <Link
          to="/study/drills"
          className="ml-auto flex items-center gap-1.5 text-xs text-text-secondary hover:text-val-cyan transition-colors"
        >
          <Bookmark className="w-3.5 h-3.5 text-val-yellow" />
          Saved drills
          <span className="font-stats text-text-muted">{savedDrills?.length ?? 0}</span>
        </Link>
      </div>

      {error && (
        <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
          Couldn't load pro VODs — {error}
        </div>
      )}

      {reviews.length === 0 && !error ? (
        <div className="bg-bg-card border border-bg-elevated rounded-xl p-8 flex flex-col items-center text-center">
          <GraduationCap className="w-12 h-12 text-text-muted mb-3" />
          <h2 className="text-lg font-heading font-bold mb-1">No pro VODs yet</h2>
          <p className="text-text-secondary text-sm">
            Run <code className="font-stats text-val-cyan">npm run seed:prostudy</code> for pro VODs, or{' '}
            <code className="font-stats text-val-cyan">npm run import:guides</code> for study guides.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {/* Single-select: one grouping is always active, so a click on the
                active chip (which the row reports as null) changes nothing. */}
            <FilterRow
              label="Group by"
              options={GROUP_BY_OPTIONS}
              selected={groupBy}
              onSelect={value => {
                if (isGroupBy(value)) chooseGroupBy(value)
              }}
              labelFor={option => GROUP_BY_LABELS[option as GroupBy]}
            />
            <FilterRow
              label="Source"
              options={options.sources}
              selected={source}
              onSelect={value => {
                setSource(value as SourceLabel | null)
                // Type, creator, skill and difficulty only mean something inside
                // Guides; a stale one would silently empty the grid.
                if (value !== 'Guides') {
                  setContentType(null)
                  setCreator(null)
                  setSkill(null)
                  setDifficulty(null)
                }
                if (value === 'Guides') setPlayer(null)
              }}
            />
            {source === 'Guides' && (
              <>
                <FilterRow
                  label="Type"
                  options={options.contentTypes}
                  selected={contentType}
                  onSelect={setContentType}
                />
                <FilterRow
                  label="Creator"
                  options={options.creators}
                  selected={creator}
                  onSelect={setCreator}
                />
                <FilterRow
                  label="Skill"
                  options={options.skills}
                  selected={skill}
                  onSelect={setSkill}
                  labelFor={skillLabel}
                />
                <FilterRow
                  label="Level"
                  options={options.difficulties}
                  selected={difficulty}
                  onSelect={setDifficulty}
                />
              </>
            )}
            <FilterRow label="Player" options={options.players} selected={player} onSelect={setPlayer} />
            <FilterRow label="Map" options={options.maps} selected={map} onSelect={setMap} />
            <FilterRow
              label="Agent"
              options={options.agents}
              selected={agent}
              onSelect={setAgent}
              iconFor={name => agentImageFor({ agent: name })}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-text-muted text-sm py-8 text-center">
              No pro VODs match those filters.
            </p>
          ) : shelves ? (
            <div className="space-y-3">
              {shelves.map(block => (
                <LibraryShelf
                  key={block.key}
                  block={block}
                  open={!!openBlocks[block.key]}
                  onToggle={() => toggleBlock(block.key)}
                  counts={counts}
                  watched={watched}
                />
              ))}
            </div>
          ) : (
            // The flat grid has no series, so no "Up next" — only the check.
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map(review => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  counts={counts.get(review.id)}
                  badge={watched.has(review.id) ? 'watched' : null}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
