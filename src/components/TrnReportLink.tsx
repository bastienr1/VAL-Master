import { ExternalLink } from 'lucide-react'
import { trnMatchUrl } from '../lib/trn'

interface TrnReportLinkProps {
  matchId: string
  /** Per-match override; falls back to the id-derived URL when absent. */
  trackerUrl?: string | null
  /** 'compact' fits the collapsed recap bar; 'full' is the expanded block. */
  variant?: 'full' | 'compact'
}

export default function TrnReportLink({ matchId, trackerUrl, variant = 'full' }: TrnReportLinkProps) {
  const url = trackerUrl ?? trnMatchUrl(matchId)
  if (!url) return null

  const compact = variant === 'compact'

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="View full report on tracker.gg"
      className={`inline-flex items-center gap-1 text-val-cyan hover:text-val-cyan/80 transition-colors ${
        compact ? 'text-[10px]' : 'text-xs'
      }`}
    >
      {compact ? 'tracker.gg' : 'View full report on tracker.gg'}
      <ExternalLink className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
    </a>
  )
}
