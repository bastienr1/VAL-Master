import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import ArtSlot from '../ArtSlot'
import { SLOT_KEYS } from '../../lib/artSlots'

/** The page's last word: review is only worth it if it becomes a habit. */
export default function ClosingBanner() {
  return (
    <ArtSlot slotKey={SLOT_KEYS.banner} scrim="left" className="border-t border-bg-elevated">
      <div className="relative max-w-7xl mx-auto px-5 sm:px-10 py-10 flex items-center justify-between gap-6 flex-wrap">
        <div>
          <h2 className="font-display italic font-extrabold uppercase text-4xl sm:text-5xl leading-[0.9] text-val-cyan">
            From review
            <br />
            to improvement.
          </h2>
          <p className="mt-3 text-sm text-text-secondary">Save patterns. Build habits. Play better.</p>
        </div>
        <Link
          to="/playbook"
          className="inline-flex items-center gap-2.5 px-6 py-3 rounded-md bg-val-red text-white text-sm font-medium hover:bg-val-red/90 transition-colors"
        >
          Open Playbook
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </ArtSlot>
  )
}
