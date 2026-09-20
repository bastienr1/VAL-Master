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
  map_id: string | null
  agent: string
  agent_id: string | null
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
  /** Valoplant 2D replay for this match, embedded in the VOD workstation. */
  valoplant_replay_url: string | null
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
  // Bumped on every edit. Nullable so rows written before the column existed still parse.
  updated_at: string | null
  user_id: string
  vod_review_id: string
  timestamp_seconds: number
  round_number: number | null
  tags: string[]
  /** Markdown source. */
  free_text: string | null
  is_strength: boolean
}

export interface RoundScreenshot {
  id: string
  created_at: string
  user_id: string
  match_id: string
  round_number: number
  storage_path: string
  image_url: string
  file_size: number | null
  width: number | null
  height: number | null
}
export interface Playbook {
  id: string
  user_id: string
  visibility: 'private' | 'unlisted' | 'public'
  /** User-chosen display name. Identity stays with slug (from the note title). */
  name: string
  title: string
  slug: string
  map: string
  agent: string | null
  side: 'attack' | 'defense' | 'both' | null
  video_url: string | null
  video_duration_seconds: number | null
  description: string | null
  source: 'obsidian_import' | 'manual' | 'coach_import'
  source_path: string | null
  source_last_synced_at: string | null
  content_hash: string | null
  created_at: string
  updated_at: string
}

export type PlaybookWithCount = Playbook & { chapter_count: number }

export interface PlaybookChapter {
  id: string
  playbook_id: string
  chapter_number: number
  title: string
  subtitle: string | null
  start_seconds: number
  end_seconds: number
  notes_markdown: string | null
  key_takeaways: string[] | null
  transcript_excerpt: string | null
  related_clip_urls: string[] | null
  role_context: string | null
  /**
   * 1 = chapter, 2 = sub-chapter. Two levels, hard cap.
   *
   * `chapter_number` stays a flat sequence across both depths — it is the
   * re-import matching key and what `?chapter=N` addresses — so a sub-chapter
   * points at its parent by number rather than by id.
   */
  depth: 1 | 2
  parent_chapter_number: number | null
  created_at: string
  updated_at: string
}

/**
 * A pro VOD attached to one of the user's matches.
 *
 * `match_id` is text (`matches.match_id`, a Riot UUID) rather than a key into
 * `matches.id`, matching how the other match-scoped tables address a match.
 */
export interface MatchProReference {
  id: string
  user_id: string | null
  match_id: string
  reference_review_id: string
  created_at: string
}

export interface PlaybookImportLog {
  id: string
  playbook_id: string | null
  user_id: string
  source_path: string
  action: 'created' | 'updated' | 'unchanged' | 'failed'
  chapters_added: number
  chapters_updated: number
  chapters_removed: number
  error_message: string | null
  synced_at: string
}

/** Where a Pro Study row came from — a Notion link, or a vault study guide. */
export type ReviewSource = 'notion' | 'vault'

/** The `valorant-vod-library` skill's content types, as written in frontmatter. */
export type GuideContentType =
  | 'map-guide'
  | 'pro-review'
  | 'agent-guide'
  | 'mechanics'
  | 'mindset'

/**
 * A pro VOD in the Pro Study section. Never written by the app: `notion` rows
 * are seeded by `scripts/seedProStudy.ts`, `vault` rows imported from the
 * Obsidian VOD library by `scripts/importVodLibrary.ts`. Carries no Henrik
 * data: a pro match has no round timeline of ours.
 *
 * The guide columns are all nullable so the 70 Notion rows keep working
 * untouched — `source` is the only one they are guaranteed to have.
 */
export interface ReferenceReview {
  id: string
  title: string | null
  player: string
  team: string | null
  agent: string | null
  map: string | null
  event: string | null
  /**
   * Bare 11-char YouTube id — the player component wants it unwrapped. Null on
   * a vault guide whose note carries no `video_url` yet; the review screen then
   * renders its chapters as a reading view.
   */
  video_id: string | null
  youtube_url: string | null
  played_at: string | null
  notes: string | null
  /** Upsert key for re-seeding from Notion. */
  notion_page_id: string | null
  created_at: string
  updated_at: string | null
  source: ReviewSource
  content_type: GuideContentType | null
  /** Channel or coach the guide came from — a guide's answer to `player`. */
  creator: string | null
  /** Upsert key for re-importing from the vault; relative, forward slashes. */
  vault_path: string | null
  series_order: number | null
  duration_seconds: number | null
  focus: string[] | null
  /** Every map the guide covers; `map` holds the first, for the card splash. */
  maps: string[] | null
  agents: string[] | null
}

/**
 * One chapter of a study guide — a `###` heading carrying a `[MM:SS–MM:SS]`
 * range.
 *
 * Replaced wholesale on every import: the markdown is the source of truth and
 * nothing the user does touches these rows.
 */
export interface ReferenceSection {
  id: string
  reference_review_id: string
  position: number
  heading: string
  /** Null only for a heading the note left unranged; seeking is disabled then. */
  start_seconds: number | null
  end_seconds: number | null
  map: string | null
  agent: string | null
  body_md: string
  created_at: string
}

export type DrillStatus = 'planned' | 'active' | 'done' | 'dropped'

/**
 * One row of a guide's Practice Extraction table.
 *
 * Re-imported by `(reference_review_id, position)` updating content columns
 * only — `status` is the user's, and an import never resets it.
 */
export interface PracticeDrill {
  id: string
  reference_review_id: string
  position: number
  title: string
  venue: string | null
  cue: string | null
  success_signal: string | null
  source_start_seconds: number | null
  source_end_seconds: number | null
  status: DrillStatus
  target_sessions: number | null
  created_at: string
  updated_at: string | null
}

export type PracticeOutcome = 'hit' | 'partial' | 'miss'

/** A logged session against a drill. Pure user data — imports never touch it. */
export interface PracticeLog {
  id: string
  drill_id: string
  logged_at: string
  outcome: PracticeOutcome | null
  note: string | null
  linked_match_id: string | null
  created_at: string
}

/** A drill plus its rolled-up log counts, as the Practice panel needs it. */
export interface DrillWithProgress extends PracticeDrill {
  log_count: number
  hit_count: number
  partial_count: number
  /** Outcome of the most recent log, or null when nothing is logged yet. */
  last_outcome: PracticeOutcome | null
  last_logged_at: string | null
}

/** A study guide with everything the review screen renders, in one shape. */
export interface ReviewWithGuide {
  review: ReferenceReview
  sections: ReferenceSection[]
  drills: DrillWithProgress[]
}

/**
 * A note on a pro VOD. Mirrors the frozen note card anatomy — timestamp,
 * category chip, text, label — so PPTX exports both review types unchanged.
 */
export interface ReferenceNote {
  id: string
  reference_review_id: string
  timestamp_seconds: number
  category: string | null
  /** Markdown source, same as `VodComment.free_text`. */
  text: string
  label: ReferenceLabel | null
  /** Schema only in v1 — no linking UI yet. */
  linked_match_id: string | null
  linked_tag_id: string | null
  created_at: string
}

export type ReferenceLabel = 'Replicate' | 'Concept' | 'Setup' | 'Util'

export interface ReferenceNoteInput {
  reference_review_id: string
  timestamp_seconds: number
  category?: string | null
  text: string
  label?: ReferenceLabel | null
}

// ----------------------------------------------------------------- moment tags

/** The two review surfaces a moment tag can be applied on. */
export type ReviewSurface = 'vod' | 'reference'

/**
 * Which review a moment belongs to.
 *
 * `id` is text on both sides because the two surfaces key differently: a vod
 * review is addressed by `matches.match_id` (a Riot UUID string), a Pro Study
 * review by `reference_reviews.id`. One text supertype covers both.
 */
export interface ReviewRef {
  type: ReviewSurface
  id: string
}

/**
 * A tag in the user's own vocabulary — one pool shared by both surfaces, so a
 * tag created while reviewing a pro VOD is there on an own-match review too.
 */
export interface ReviewTag {
  id: string
  created_at: string
  user_id: string
  name: string
  color: string
}

/**
 * One application of a tag to a moment in a review.
 *
 * `note_id` is nullable and carries no foreign key: it points at `vod_comments`
 * or `reference_notes` depending on `review_type`, and a column cannot reference
 * two tables. A moment tag with no note is the quick-drop case.
 */
export interface MomentTag {
  id: string
  created_at: string
  user_id: string
  tag_id: string
  review_type: ReviewSurface
  review_id: string
  video_ts: number
  note_id: string | null
}
