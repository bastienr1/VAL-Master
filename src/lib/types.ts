export interface MatchCheckin {
  id: string
  created_at: string
  mental_score: number
  physical_score: number
  focus_level: number
  tilt_risk: number
  goal: string
  agent_pick: string
  map: string
  notes: string | null
}

export interface TacticalRead {
  id: string
  created_at: string
  map: string
  side: 'attack' | 'defense'
  round_type: 'pistol' | 'eco' | 'force' | 'full_buy'
  read_description: string
  counter_action: string
  result: 'success' | 'partial' | 'fail' | null
  confidence: number
  match_checkin_id: string | null
  agent?: string
  round_number?: number
  weapons_bought?: string[]
  tactical_intent?: string
}

export interface MatchDebrief {
  id: string
  created_at: string
  match_checkin_id: string | null
  result: 'win' | 'loss' | 'draw'
  rounds_won: number
  rounds_lost: number
  goal_met: boolean
  peak_moment: string
  tilt_moment: string | null
  key_lesson: string
  next_focus: string
  mvp_play: string | null
  youtube_url?: string
}

export interface Match {
  id: string
  created_at: string
  user_id: string
  match_id: string
  match_date: string
  map: string
  agent: string
  agent_role: string | null
  mode: string
  result: 'W' | 'L' | 'draw'
  score: string
  rounds_won: number
  rounds_lost: number
  rounds_played: number
  kills: number
  deaths: number
  assists: number
  kd: number
  kda: number
  acs: number
  headshot_pct: number
  headshots: number
  bodyshots: number
  legshots: number
  kpr: number
  dpr: number
  raw_score: number
  match_checkin_id: string | null
  match_debrief_id: string | null
}

export interface VodReview {
  id: string
  created_at: string
  user_id: string
  match_id: string
  youtube_url: string
  peak_moment: string | null
  key_lesson: string | null
  themes: string | null
  match_quality: number | null
  notes: string | null
  barrier_drop_offset: number | null
}

export interface VodTag {
  id: string
  created_at: string
  user_id: string
  vod_review_id: string
  timestamp_seconds: number
  round_number: number | null
  tag_type: string
  label: string
  side: 'attack' | 'defense' | null
  is_auto: boolean
}

export interface MatchRound {
  id: string
  created_at: string
  user_id: string
  match_id: string
  round_number: number
  side: 'attack' | 'defense'
  round_won: boolean
  end_type: string | null
  kills: number
  deaths: number
  assists: number
  damage_dealt: number
  damage_received: number
  loadout_value: number
  spent: number
  score: number
  kill_events: Array<{ kill_time_ms: number; victim: string; weapon: string }>
  death_events: Array<{ kill_time_ms: number; killer: string; weapon: string }>
  round_duration_ms: number | null
  round_start_ms: number | null
}

export interface VodComment {
  id: string
  created_at: string
  user_id: string
  vod_review_id: string
  timestamp_seconds: number
  round_number: number | null
  tags: string[]
  free_text: string | null
  is_strength: boolean
}