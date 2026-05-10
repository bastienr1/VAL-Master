export const MANUAL_TAG_TYPES = [
  { type: 'strength', label: 'Strength', color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  { type: 'mistake', label: 'Mistake', color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  { type: 'read', label: 'Read', color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  { type: 'clutch', label: 'Clutch', color: 'bg-val-yellow', textColor: 'text-val-yellow', dotColor: '#FFCA3A' },
  { type: 'comms', label: 'Comms', color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
  { type: 'positioning', label: 'Position', color: 'bg-[#6EE7B7]', textColor: 'text-[#6EE7B7]', dotColor: '#6EE7B7' },
  { type: 'utility', label: 'Utility', color: 'bg-[#F97316]', textColor: 'text-[#F97316]', dotColor: '#F97316' },
  { type: 'economy', label: 'Economy', color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#64748B' },
  { type: 'aim', label: 'Aim', color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
] as const

export const ALL_TAG_COLORS: Record<string, { color: string; textColor: string; dotColor: string }> = {
  strength: { color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  mistake: { color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  read: { color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  clutch: { color: 'bg-val-yellow', textColor: 'text-val-yellow', dotColor: '#FFCA3A' },
  comms: { color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
  positioning: { color: 'bg-[#6EE7B7]', textColor: 'text-[#6EE7B7]', dotColor: '#6EE7B7' },
  utility: { color: 'bg-[#F97316]', textColor: 'text-[#F97316]', dotColor: '#F97316' },
  economy: { color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#64748B' },
  aim: { color: 'bg-val-cyan', textColor: 'text-val-cyan', dotColor: '#53CADC' },
  round: { color: 'bg-text-muted', textColor: 'text-text-muted', dotColor: '#475569' },
  kill: { color: 'bg-val-green', textColor: 'text-val-green', dotColor: '#3DD598' },
  death: { color: 'bg-val-red', textColor: 'text-val-red', dotColor: '#FF4655' },
  half: { color: 'bg-text-secondary', textColor: 'text-text-secondary', dotColor: '#94A3B8' },
}

export const PRIMARY_TAG_TYPES = [
  { type: 'strength', label: 'Strength', color: 'val-green', dotColor: '#3DD598' },
  { type: 'read', label: 'Read', color: 'val-cyan', dotColor: '#53CADC' },
  { type: 'mistake', label: 'Mistake', color: 'val-red', dotColor: '#FF4655' },
] as const

export const SECONDARY_TAG_TYPES = [
  { type: 'clutch', label: 'Clutch', color: 'val-yellow', dotColor: '#FFCA3A' },
  { type: 'comms', label: 'Comms', color: 'text-secondary', dotColor: '#94A3B8' },
  { type: 'positioning', label: 'Position', color: '[#6EE7B7]', dotColor: '#6EE7B7' },
  { type: 'utility', label: 'Utility', color: '[#F97316]', dotColor: '#F97316' },
  { type: 'economy', label: 'Economy', color: 'text-muted', dotColor: '#64748B' },
  { type: 'aim', label: 'Aim', color: 'val-cyan', dotColor: '#53CADC' },
] as const

export const PRIMARY_TAG_TYPE_NAMES: Set<string> = new Set(PRIMARY_TAG_TYPES.map(t => t.type))
export const SECONDARY_TAG_TYPE_NAMES: Set<string> = new Set(SECONDARY_TAG_TYPES.map(t => t.type))

export function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha))
  const byte = Math.round(a * 255).toString(16).padStart(2, '0')
  return `${hex}${byte}`
}
