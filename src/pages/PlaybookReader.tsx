import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { formatTimestamp } from '../lib/playbookParser'
import { usePlaybookBySlug, usePlaybookChapters } from '../hooks/usePlaybooks'
import PlaybookChapterList from '../components/PlaybookChapterList'
import PlaybookChapterReader from '../components/PlaybookChapterReader'
import MatchContextCard from '../components/MatchContextCard'

function ReaderSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-6 animate-pulse">
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-12 rounded-md bg-bg-card" />
        ))}
      </div>
      <div className="space-y-3">
        <div className="aspect-video rounded-lg bg-bg-card" />
        <div className="h-40 rounded-md bg-bg-card" />
      </div>
    </div>
  )
}

export default function PlaybookReader() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { playbook, loading: playbookLoading, error } = usePlaybookBySlug(slug)
  const { chapters, loading: chaptersLoading } = usePlaybookChapters(playbook?.id)
  const [userPicked, setUserPicked] = useState(false)

  // ?chapter=N keeps the active chapter across reloads and makes it linkable.
  const requested = Number(searchParams.get('chapter'))
  const activeChapter = chapters.find(c => c.chapter_number === requested) ?? chapters[0] ?? null

  const selectChapter = (chapterId: string) => {
    const chapter = chapters.find(c => c.id === chapterId)
    if (!chapter) return
    setUserPicked(true)
    setSearchParams({ chapter: String(chapter.chapter_number) }, { replace: true })
  }

  if (playbookLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-16 w-1/2 rounded-md bg-bg-card animate-pulse" />
        <ReaderSkeleton />
      </div>
    )
  }

  if (!playbook) {
    return (
      <div className="max-w-7xl mx-auto py-20 text-center space-y-3">
        <h1 className="font-heading text-2xl font-bold">Playbook not found</h1>
        <p className="text-sm text-text-muted">{error ?? `No playbook with the slug "${slug}".`}</p>
        <Link to="/playbook" className="text-sm text-val-cyan hover:underline">
          Back to Playbook
        </Link>
      </div>
    )
  }

  const totalSeconds = playbook.video_duration_seconds ?? (chapters.length ? Math.max(...chapters.map(c => c.end_seconds)) : null)
  const subtitle = [
    `${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'}`,
    totalSeconds != null ? formatTimestamp(totalSeconds) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <nav className="text-xs text-text-muted">
            <Link to="/playbook" className="hover:text-text-secondary">
              Playbook
            </Link>
            <span className="mx-1.5">/</span>
            <Link to={`/playbook?map=${encodeURIComponent(playbook.map)}`} className="hover:text-text-secondary">
              {playbook.map}
            </Link>
          </nav>
          <h1 className="font-heading text-3xl font-bold leading-tight">{playbook.title}</h1>
          <p className="text-sm text-text-secondary">
            <span className="font-stats text-text-muted">{subtitle}</span>
            {playbook.description && <span className="block mt-1 line-clamp-2">{playbook.description}</span>}
          </p>
        </div>
        <MatchContextCard playbookMap={playbook.map} />
      </div>

      {chaptersLoading ? (
        <ReaderSkeleton />
      ) : !activeChapter ? (
        <div className="py-16 text-center text-sm text-text-muted">This playbook has no chapters yet</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-6 items-start">
          <div className="lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto pr-1">
            <PlaybookChapterList
              chapters={chapters}
              activeChapterId={activeChapter.id}
              onChapterSelect={selectChapter}
              totalSeconds={totalSeconds}
            />
          </div>
          <PlaybookChapterReader chapter={activeChapter} playbook={playbook} autoplay={userPicked} />
        </div>
      )}
    </div>
  )
}
