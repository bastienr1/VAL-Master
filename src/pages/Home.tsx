import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Swords } from 'lucide-react'
import HomeHero from '../components/home/HomeHero'
import SectionHeader from '../components/home/SectionHeader'
import MapCarousel from '../components/home/MapCarousel'
import RecentMatches from '../components/home/RecentMatches'
import AgentStrip from '../components/home/AgentStrip'
import FeatureTiles from '../components/home/FeatureTiles'
import ClosingBanner from '../components/home/ClosingBanner'
import { useHomeStats } from '../hooks/useHomeStats'
import { usePortalMaps } from '../hooks/useMapContent'
import { useGameContent } from '../hooks/useGameContent'
import { useResource } from '../hooks/useResource'
import { profileToPlayer, useProfile } from '../lib/profile'
import { goalsTileLine, localDate, weekProgress, weekStart } from '../lib/weeklyPlan'
import { planResource } from '../lib/weeklyPlanStore'
import type { StatSummary } from '../lib/homeStats'

const block = 'rounded-xl bg-bg-card animate-pulse'

/** Placeholders at the sections' final sizes, so nothing jumps when data lands. */
function MapsSkeleton() {
  return (
    <div className="flex items-center justify-center gap-5 py-8 overflow-hidden" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className={`${block} shrink-0 w-[13rem] aspect-[3/4] ${i === 2 ? 'scale-110' : 'opacity-60'}`} />
      ))}
    </div>
  )
}

function MatchesSkeleton() {
  return (
    <div className="space-y-14" aria-hidden="true">
      <div className="space-y-5">
        <div className={`${block} h-12 w-64`} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className={`${block} min-h-[14rem]`} />
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map(i => (
              <div key={i} className={`${block} flex-1 min-h-[4.25rem]`} />
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-5">
        <div className={`${block} h-12 w-64`} />
        <div className="flex gap-4 p-1 overflow-hidden">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`${block} shrink-0 w-40 aspect-square`} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Stands in for Recent Matches and Explore Agents until there is a match to show. */
function NoMatchesCard({ hasRiotId }: { hasRiotId: boolean }) {
  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl p-10 flex flex-col items-center text-center">
      <Swords className="w-12 h-12 text-text-muted mb-4" />
      <h2 className="text-xl font-heading font-bold mb-1">No matches yet</h2>
      {hasRiotId ? (
        <p className="text-text-secondary text-sm">Hit Load Latest to sync your competitive matches.</p>
      ) : (
        <p className="text-text-secondary text-sm">
          Set your Riot ID in{' '}
          <Link to="/settings" className="text-val-cyan hover:underline">
            Settings
          </Link>
          , then hit Load Latest to sync your competitive matches.
        </p>
      )}
    </section>
  )
}

/**
 * The landing page. Every number on it is a count over the player's `matches`
 * rows; every picture sits in an art slot that can be swapped in Settings.
 */
export default function Home() {
  const stats = useHomeStats()
  const portal = usePortalMaps()
  const { registry } = useGameContent()
  const { profile, loading: profileLoading } = useProfile()
  const plan = useResource(planResource).data
  const [now] = useState(() => new Date())

  const hasMatches = stats.matches.length > 0

  const records = useMemo(() => {
    const byMap = new Map<string, StatSummary>()
    for (const group of stats.maps) byMap.set(group.name.toLowerCase(), group)
    return byMap
  }, [stats.maps])

  // The Goals tile: this week's routine, in the profile's time zone like `/plan`.
  const planLine = useMemo(() => {
    if (!plan) return null
    const today = localDate(now, profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    return goalsTileLine(weekProgress(plan.blocks, plan.logs, weekStart(today)), today)
  }, [plan, now, profile.timezone])

  const recordLabel = stats.scope.kind === 'act' ? stats.scope.act.code : 'All time'
  const error = stats.error ?? portal.error

  return (
    <div className="bg-bg-primary text-text-primary">
      <HomeHero
        summary={hasMatches ? stats.summary : null}
        loading={stats.loading}
        act={stats.act}
        actIsCurrent={stats.actIsCurrent}
        choice={stats.choice}
        onChoice={stats.setChoice}
      />

      <div className="max-w-7xl mx-auto px-5 sm:px-10 py-12 space-y-14">
        {error && (
          <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
            Couldn't load everything — {error}
          </div>
        )}

        <section className="space-y-2">
          <SectionHeader
            title="Explore Maps"
            subtitle="Every guide, pro VOD and match of yours, map by map."
            link={{ to: '/maps', label: 'View All Maps' }}
          />
          {portal.loading ? (
            <MapsSkeleton />
          ) : portal.maps.length > 0 ? (
            <MapCarousel maps={portal.maps} grouped={portal.grouped} records={records} recordLabel={recordLabel} />
          ) : (
            <p className="py-8 text-sm text-text-muted">Map list unavailable right now — check your connection.</p>
          )}
        </section>

        {stats.loading ? (
          <MatchesSkeleton />
        ) : hasMatches ? (
          <>
            <RecentMatches matches={stats.matches} />
            <AgentStrip agents={stats.agents} edgeAgent={stats.edgeAgent} scope={stats.scope} registry={registry} />
          </>
        ) : (
          // Without a profile yet, assume the Riot ID is set rather than flash
          // the "set it in Settings" line at someone who has.
          <NoMatchesCard hasRiotId={profileLoading || profileToPlayer(profile) !== null} />
        )}

        <FeatureTiles weeklyGoal={profile.weekly_goal} planLine={planLine} />
      </div>

      <ClosingBanner />
    </div>
  )
}
