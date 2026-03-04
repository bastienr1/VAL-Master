import * as Slider from '@radix-ui/react-slider'

interface ScoreSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  color?: string
}

const SCORE_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Below Avg',
  3: 'Average',
  4: 'Good',
  5: 'Peak',
}

export default function ScoreSlider({
  label,
  value,
  onChange,
  min = 1,
  max = 5,
  color = 'var(--color-val-cyan)',
}: ScoreSliderProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">{label}</span>
        <span
          className="font-stats text-sm font-medium"
          style={{ color }}
        >
          {value} — {SCORE_LABELS[value] ?? value}
        </span>
      </div>
      <Slider.Root
        className="relative flex items-center select-none touch-none h-5 w-full"
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={1}
      >
        <Slider.Track className="relative grow h-1.5 rounded-full bg-bg-elevated">
          <Slider.Range
            className="absolute h-full rounded-full"
            style={{ backgroundColor: color }}
          />
        </Slider.Track>
        <Slider.Thumb
          className="block w-5 h-5 rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg-primary transition-colors cursor-grab active:cursor-grabbing"
          style={{
            backgroundColor: color,
            boxShadow: `0 0 10px ${color}50`,
          }}
        />
      </Slider.Root>
      <div className="flex justify-between text-[10px] text-text-muted">
        {Array.from({ length: max - min + 1 }, (_, i) => (
          <span key={i}>{min + i}</span>
        ))}
      </div>
    </div>
  )
}
