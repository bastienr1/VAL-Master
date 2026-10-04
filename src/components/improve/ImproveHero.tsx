import ArtSlot from '../ArtSlot'
import { HERO_GRADIENT } from '../home/HomeHero'
import { SLOT_KEYS } from '../../lib/artSlots'

/**
 * The top of `/improve`: the mode's name over swappable art. Home's hero
 * without the stat strip. Any slogan belongs to the art image, not to the
 * page, so swapping the picture swaps it too.
 */
export default function ImproveHero() {
  return (
    <ArtSlot
      slotKey={SLOT_KEYS.improveHero}
      scrim="left"
      priority
      gradientFallback={HERO_GRADIENT}
      className="border-b border-bg-elevated"
    >
      <div className="relative max-w-7xl mx-auto px-5 sm:px-10 py-10 sm:py-12 min-h-[14rem] flex flex-col justify-center">
        <h1 className="font-display italic font-extrabold uppercase leading-[0.86] text-6xl sm:text-7xl">Improve</h1>
        <p className="mt-3 text-base sm:text-lg text-text-secondary">What to practice, and how the week is going.</p>
      </div>
    </ArtSlot>
  )
}
