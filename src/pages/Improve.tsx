import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark } from 'lucide-react'
import SectionHeader from '../components/home/SectionHeader'
import ImproveHero from '../components/improve/ImproveHero'
import PlanSummary from '../components/improve/PlanSummary'
import HubCard from '../components/improve/HubCard'
import { useResource } from '../hooks/useResource'
import { useGameContent } from '../hooks/useGameContent'
import { mapImageFor } from '../lib/gameContent'
import { reviewHeading, shortCreator } from '../lib/guideDisplay'
import { studyContentResource } from '../lib/homeData'
import { HUB_ROW, metaLine, pickGuides, pickPlaybooks, pickProVods, youtubeThumbnail } from '../lib/improveHub'
import { useProfile } from '../lib/profile'
import { savedDrillsResource } from '../lib/savedDrills'
import { localDate, weekProgress, weekStart } from '../lib/weeklyPlan'
import { planResource } from '../lib/weeklyPlanStore'
import type { Playbook } from '../lib/types'

const SIDE_LABELS: Record<NonNullable<Playbook['side']>, string> = {
  attack: 'Attack',
  defense: 'Defense',
  both: 'Both sides',
}

const ROW_GRID = 'grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
const block = 'rounded-xl bg-bg-card animate-pulse'

/** A row's cards before they load, at their final size. */
function RowSkeleton() {
  return (
    <div className={ROW_GRID} aria-hidden="true">
      {Array.from({ length: HUB_ROW }, (_, i) => (
        <div key={i} className={`${block} aspect-[2/1]`} />
      ))}
    </div>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-bg-elevated rounded-xl px-4 py-5 text-sm text-text-muted">{children}</p>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] uppercase tracking-widest text-text-secondary">{children}</h3>
}

/**
 * `/improve` — the front page of the IMPROVE mode, built like Home: the week's
 * plan first, because it changes daily, then the two libraries. Every section
 * is a preview that opens the page behind it; nothing is edited here.
 */
export default function Improve() {
  const plan = useResource(planResource)
  const study = useResource(studyContentResource)
  const saved = useResource(savedDrillsResource)
  const { profile } = useProfile()
  // Map art resolves through the registry; this re-renders the cards once it has loaded.
  useGameContent()
  const [now] = useState(() => new Date())

  const today = localDate(now, profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const week = weekStart(today)
  const progress = useMemo(
    () => (plan.data ? weekProgress(plan.data.blocks, plan.data.logs, week) : []),
    [plan.data, week],
  )

  const playbooks = useMemo(() => pickPlaybooks(study.data?.playbooks ?? []), [study.data])
  const guides = useMemo(() => pickGuides(study.data?.reviews ?? []), [study.data])
  const proVods = useMemo(() => pickProVods(study.data?.reviews ?? []), [study.data])

  const planLoading = plan.loading && !plan.data
  const studyLoading = study.loading && !study.data
  const error = plan.error ?? study.error ?? saved.error
  const playbookCount = study.data?.playbooks.length ?? 0

  return (
    <div className="bg-bg-primary text-text-primary">
      <ImproveHero />

      <div className="max-w-7xl mx-auto px-5 sm:px-10 py-12 space-y-14">
        {error && (
          <div className="bg-bg-card border border-val-red/30 rounded-lg px-4 py-3 text-sm text-val-red">
            Couldn't load everything — {error}
          </div>
        )}

        <section className="space-y-5">
          <SectionHeader title="Weekly Plan" link={{ to: '/plan', label: 'Open Weekly Plan' }} />
          {planLoading ? (
            <div className={`${block} h-48`} aria-hidden="true" />
          ) : (
            <PlanSummary
              week={week}
              today={today}
              progress={progress}
              goals={plan.data?.goals ?? []}
              headline={profile.weekly_goal}
            />
          )}
        </section>

        <section className="space-y-5">
          <SectionHeader
            title="Playbooks"
            link={{ to: '/playbook', label: studyLoading ? 'View all' : `View all ${playbookCount}` }}
          />
          {studyLoading ? (
            <RowSkeleton />
          ) : playbooks.length > 0 ? (
            <div className={ROW_GRID}>
              {playbooks.map(playbook => (
                <HubCard
                  key={playbook.id}
                  to={`/playbook/${playbook.slug}`}
                  image={mapImageFor({ map: playbook.map })}
                  title={playbook.map}
                  meta={metaLine([
                    playbook.side ? SIDE_LABELS[playbook.side] : null,
                    `${playbook.chapter_count} ${playbook.chapter_count === 1 ? 'chapter' : 'chapters'}`,
                  ])}
                  mark="arrow"
                />
              ))}
            </div>
          ) : (
            <EmptyLine>Import a playbook from the vault: Playbook → Import from vault.</EmptyLine>
          )}
        </section>

        <section className="space-y-5">
          <SectionHeader title="Study" link={{ to: '/study', label: 'Open Pro Study' }} />

          <div className="space-y-3">
            <SubHeading>Guides</SubHeading>
            {studyLoading ? (
              <RowSkeleton />
            ) : guides.length > 0 ? (
              <div className={ROW_GRID}>
                {guides.map(review => (
                  <HubCard
                    key={review.id}
                    to={`/study/${review.id}`}
                    image={youtubeThumbnail(review.video_id)}
                    title={reviewHeading(review)}
                    meta={metaLine([shortCreator(review.creator), review.map, review.agent])}
                    mark="play"
                  />
                ))}
              </div>
            ) : (
              <EmptyLine>File a map guide in the vault, then run npm run import:guides.</EmptyLine>
            )}
          </div>

          <div className="space-y-3">
            <SubHeading>Pro VODs</SubHeading>
            {studyLoading ? (
              <RowSkeleton />
            ) : proVods.length > 0 ? (
              <div className={ROW_GRID}>
                {proVods.map(review => (
                  <HubCard
                    key={review.id}
                    to={`/study/${review.id}`}
                    image={youtubeThumbnail(review.video_id)}
                    title={review.player}
                    meta={metaLine([review.team, review.agent, review.map])}
                    mark="play"
                  />
                ))}
              </div>
            ) : (
              <EmptyLine>No pro VODs yet. Add one in Notion, then re-seed.</EmptyLine>
            )}
          </div>

          <Link
            to="/study/drills"
            className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-val-cyan transition-colors"
          >
            <Bookmark className="w-4 h-4 text-val-yellow" aria-hidden="true" />
            Saved drills ({saved.data?.length ?? 0})
          </Link>
        </section>
      </div>
    </div>
  )
}
