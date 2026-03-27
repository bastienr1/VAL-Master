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
