export const COMMENT_TAG_CATEGORIES = {
  technique: {
    label: 'Technique',
    color: '#53CADC',
    tags: ['Flick', 'Spray Transfer', '1-Tap', 'Hold Angle', 'Burst', 'Counter-strafe', 'Jiggle Peek', 'Wide Swing'],
  },
  positioning: {
    label: 'Positioning',
    color: '#6EE7B7',
    tags: ['Hold', 'Off-angle', 'Angle Advantage', 'Rush', 'Rotate', 'Anchor', 'Lurk', 'Peek'],
  },
  equipment: {
    label: 'Equipment',
    color: '#F97316',
    tags: ['Classic', 'Sheriff', 'Spectre', 'Vandal', 'Phantom', 'Operator', 'Satchels', 'Ultimate', 'Shorty', 'Marshal'],
  },
  play_type: {
    label: 'Play Type',
    color: '#FFCA3A',
    tags: ['Entry', 'Trade', 'Clutch', 'Retake', 'Post-plant', 'Support', 'Anti-eco', 'Save'],
  },
} as const

export type CommentTagCategory = keyof typeof COMMENT_TAG_CATEGORIES

export const DEBRIEF_THEMES = [
  'Crosshair Placement', 'Game Sense', 'Utility Usage', 'Positioning',
  'Communication', 'Economy', 'Clutch Factor', 'Trading',
  'Map Control', 'Entry Fragging', 'Patience', 'Aggression',
] as const
