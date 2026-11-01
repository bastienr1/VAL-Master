import { Pause, Play } from 'lucide-react'
import type { PlayPhase } from '../../lib/playDoc'

interface PhaseStepperProps {
  phases: Pick<PlayPhase, 'id' | 'name'>[]
  index: number
  playing: boolean
  onTogglePlay(): void
  /** A manual pick; the page stops playback. */
  onPick(index: number): void
}

/** Play/Pause and one pill per phase, above the map. */
export default function PhaseStepper({ phases, index, playing, onTogglePlay, onPick }: PhaseStepperProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={phases.length < 2}
        aria-label={playing ? 'Pause phases' : 'Play phases'}
        title={playing ? 'Pause' : 'Play through the phases'}
        className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-bg-elevated text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      {phases.map((phase, i) => (
        <button
          key={phase.id}
          type="button"
          onClick={() => onPick(i)}
          aria-current={i === index ? 'step' : undefined}
          className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
            i === index
              ? 'bg-val-cyan/15 text-val-cyan border-val-cyan/40'
              : 'border-bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          {i + 1} {phase.name}
        </button>
      ))}
    </div>
  )
}
