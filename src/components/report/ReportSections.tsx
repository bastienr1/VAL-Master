import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Play } from 'lucide-react'
import type { AbilitySlot, MatchReport, ReportDuel, ReportFinding, ReportRound, Stance } from '../../lib/matchReport'
import { OFF_CROSSHAIR_DEG } from '../../lib/matchReport'
import { boldRuns, type NoteCard, type ReportNotes, type ReportSectionId, type RoundNote } from '../../lib/matchReportNotes'
import type { TrendRow } from '../../lib/matchReports'
import type { ReplaySide } from '../../lib/replayBundle'
import type { MatchRound } from '../../lib/types'
import { formatTime } from '../../lib/youtube'

export interface ReportNames {
  /** A player's agent, by subject. */
  agent: (subject: string | null) => string
  /** A weapon by its index in the bundle; null is an ability. */
  weapon: (index: number | null) => string
  /** The owner's ability on a key, e.g. E → "Ruse". */
  ability: (slot: AbilitySlot) => string
}

interface ReportSectionsProps {
  report: MatchReport
  /** What was written about the match; every list empty when nothing was. */
  notes: ReportNotes
  /** Recent games with stored counts, this one included, oldest first. */
  trend: TrendRow[]
  /** `match_reports` does not exist yet: say why there are no written notes and no trend. */
  tableMissing: boolean
  names: ReportNames
  /** Henrik's rows for the match, for the loadout column; empty when the match has none stored. */
  matchRounds: MatchRound[]
  /** Shows a replay moment on the stage. */
  onWatch: (replayMs: number) => void
  /** The video second of a replay time, when the match has a synced recording. */
  videoSecond: ((replayMs: number) => number) | null
  matchId: string
}

const SECTION_LABEL: Record<ReportSectionId, string> = {
  findings: 'Short version',
  rounds: 'Rounds',
  positioning: 'Positioning',
  duels: 'Duels',
  economy: 'Economy',
  kit: 'Kit',
  trend: 'Trend',
  next: 'Next',
}
const SECTION_ORDER: ReportSectionId[] = ['findings', 'rounds', 'positioning', 'duels', 'economy', 'kit', 'trend', 'next']
const OPEN_AT_FIRST: Record<ReportSectionId, boolean> = {
  findings: true, rounds: true, positioning: false, duels: true, economy: false, kit: false, trend: false, next: true,
}

const SIDE_LABEL: Record<ReplaySide, string> = { attacker: 'Attack', defender: 'Defence' }
const STANCE_TONE: Record<Stance, string> = {
  standing: 'bg-val-green/10 text-val-green',
  moving: 'bg-val-yellow/10 text-val-yellow',
  running: 'bg-val-red/10 text-val-red',
}
const SLOTS: AbilitySlot[] = ['C', 'Q', 'E', 'X']
/** How long before a moment the stage starts, so the fight is seen coming. */
const LEAD_MS = 3000

const armourLabel = (armor: number | null) => (armor === null ? '–' : armor >= 50 ? 'Heavy' : armor >= 25 ? 'Light' : armor > 0 ? String(armor) : 'None')
const metres = (m: number | null) => (m === null ? '–' : `${m} m`)
const TH = 'pr-2 font-normal'

function WatchButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-6 h-6 shrink-0 rounded bg-val-cyan/10 text-val-cyan hover:bg-val-cyan/25 inline-flex items-center justify-center transition-colors"
    >
      <Play className="w-3 h-3" />
    </button>
  )
}

function Tile({ value, of, label, tone }: { value: number; of: number; label: string; tone: 'good' | 'bad' | 'plain' }) {
  const color = tone === 'good' ? 'text-val-cyan' : tone === 'bad' ? 'text-val-red' : 'text-text-primary'
  return (
    <div className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
      <div className={`font-stats text-xl ${color}`}>
        {value}
        <span className="text-xs text-text-muted"> of {of}</span>
      </div>
      <div className="text-[11px] text-text-secondary">{label}</div>
    </div>
  )
}

/** A written line: `**bold**` is the only markup. */
function Rich({ line }: { line: string }) {
  return (
    <>
      {boldRuns(line).map((run, i) => (run.bold ? <strong key={i} className="font-semibold text-text-primary">{run.text}</strong> : <span key={i}>{run.text}</span>))}
    </>
  )
}

function Points({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <ul className="space-y-1.5 text-sm text-text-secondary">
      {lines.map(line => (
        <li key={line} className="pl-3 border-l-2 border-val-cyan/40">
          <Rich line={line} />
        </li>
      ))}
    </ul>
  )
}

const Label = ({ children, tone = 'text-text-muted' }: { children: ReactNode; tone?: string }) => (
  <p className={`text-[11px] uppercase tracking-wider mb-2 ${tone}`}>{children}</p>
)

/**
 * The report's text (docs/match-report.md): collapsible sections under a bar
 * that stays in view, every round, duel, ability and note with a button that
 * shows its moment on the stage beside it. What a person wrote about the match
 * comes first in each section; what the rules find is always there under it.
 */
export default function ReportSections({ report, notes, trend, tableMissing, names, matchRounds, onWatch, videoSecond, matchId }: ReportSectionsProps) {
  const [open, setOpen] = useState(OPEN_AT_FIRST)
  const [kitFilter, setKitFilter] = useState<AbilitySlot | 'all'>('all')

  const { totals, sides } = report
  const kills = report.duels.filter(d => d.kind === 'kill')
  const deaths = report.duels.filter(d => d.kind === 'death')
  const works = report.findings.filter(f => f.tone === 'works')
  const work = report.findings.filter(f => f.tone === 'work')
  const loadoutOf = new Map(matchRounds.map(r => [r.round_number, r]))
  const roundByN = new Map(report.rounds.map(r => [r.n, r]))
  const written = notes.works.length > 0 || notes.work.length > 0

  const shown: Record<ReportSectionId, boolean> = {
    findings: true,
    rounds: true,
    positioning: true,
    duels: true,
    economy: notes.economy.length > 0,
    kit: true,
    trend: trend.length > 1,
    next: notes.next.length > 0,
  }
  const sections = SECTION_ORDER.filter(id => shown[id])

  const setAll = (value: boolean) => setOpen(prev => Object.fromEntries(Object.keys(prev).map(id => [id, value])) as Record<ReportSectionId, boolean>)
  const goTo = (id: ReportSectionId) => {
    if (!shown[id]) return
    setOpen(prev => ({ ...prev, [id]: true }))
    // After the section has opened, so the scroll lands on its content.
    requestAnimationFrame(() => document.getElementById(`report-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const watch = (replayMs: number) => onWatch(replayMs - LEAD_MS)
  /** A written note's moment: its second of the round, or the round's start. */
  const watchNote = (note: RoundNote) => {
    const round = roundByN.get(note.round)
    if (!round) return
    if (note.clockS === null) onWatch(round.barrierMs - 1000)
    else watch(round.barrierMs + note.clockS * 1000)
  }
  const videoCell = (replayMs: number) =>
    videoSecond && (
      <td className="font-stats pr-2">
        <Link
          to={`/review/${matchId}?t=${Math.max(0, Math.floor(videoSecond(replayMs) - LEAD_MS / 1000))}`}
          title="Open the review at this moment of the video"
          className="text-text-muted hover:text-val-cyan transition-colors"
        >
          {formatTime(Math.max(0, videoSecond(replayMs)))}
        </Link>
      </td>
    )

  const section = (id: ReportSectionId, title: string, sub: string, children: ReactNode) =>
    shown[id] && (
      <section id={`report-${id}`} className="scroll-mt-20 bg-bg-secondary border border-bg-elevated rounded-lg">
        <h2>
          <button
            type="button"
            onClick={() => setOpen(prev => ({ ...prev, [id]: !prev[id] }))}
            aria-expanded={open[id]}
            className="w-full flex items-center gap-2 px-4 py-3 text-left"
          >
            {open[id] ? <ChevronDown className="w-4 h-4 shrink-0 text-text-muted" /> : <ChevronRight className="w-4 h-4 shrink-0 text-text-muted" />}
            <span className="text-base font-semibold tracking-wide uppercase whitespace-nowrap">{title}</span>
            <span className="text-xs text-text-muted font-normal normal-case truncate">{sub}</span>
          </button>
        </h2>
        {open[id] && <div className="px-4 pb-4 space-y-4">{children}</div>}
      </section>
    )

  const finding = (f: ReportFinding) => (
    <li key={f.title} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
      <p className="text-sm font-medium text-text-primary">{f.title}</p>
      <p className="text-xs text-text-secondary mt-0.5">{f.body}</p>
      <p className="mt-1.5 flex items-center gap-3 text-[11px]">
        {f.jump && (
          <button type="button" onClick={() => watch(f.jump!.t)} className="text-val-cyan hover:underline inline-flex items-center gap-1">
            <Play className="w-3 h-3" /> Show round {f.jump.round}
          </button>
        )}
        <button type="button" onClick={() => goTo(f.section)} className="text-text-muted hover:text-val-cyan transition-colors">
          See the numbers
        </button>
      </p>
    </li>
  )
  const findingColumns = (
    <div className="grid gap-4 xl:grid-cols-2">
      <div>
        <Label tone="text-val-cyan">Already works</Label>
        {works.length > 0 ? <ul className="space-y-2">{works.map(finding)}</ul> : <p className="text-xs text-text-muted">Nothing by these rules.</p>}
      </div>
      <div>
        <Label tone="text-val-red">Work on</Label>
        {work.length > 0 ? <ul className="space-y-2">{work.map(finding)}</ul> : <p className="text-xs text-text-muted">Nothing by these rules.</p>}
      </div>
    </div>
  )

  const noteCard = (card: NoteCard) => (
    <li key={card.title} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
      <p className="text-sm font-medium text-text-primary">{card.title}</p>
      <p className="text-xs text-text-secondary mt-0.5"><Rich line={card.body} /></p>
      {card.section && shown[card.section] && (
        <button type="button" onClick={() => goTo(card.section!)} className="mt-1.5 text-[11px] text-text-muted hover:text-val-cyan transition-colors">
          See the evidence
        </button>
      )}
    </li>
  )

  const roundNotes = (items: RoundNote[], verb: string) => (
    <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
      {items.map(note => (
        <li key={`${note.round}-${note.title}`} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            {roundByN.has(note.round) && <WatchButton label={`${verb} round ${note.round}`} onClick={() => watchNote(note)} />}
            <span>
              <span className="font-stats text-text-secondary">R{note.round}{note.clockS !== null && ` ${formatTime(note.clockS)}`}</span> {note.title}
            </span>
          </p>
          <p className="text-xs text-text-secondary mt-1"><Rich line={note.body} /></p>
        </li>
      ))}
    </ul>
  )

  const duelRow = (d: ReportDuel, i: number) => (
    <tr key={`${d.t}-${i}`} className="border-t border-bg-elevated/60 hover:bg-bg-card/60">
      <td className="py-1 pr-2">
        <WatchButton label={`Watch this ${d.kind}, round ${d.round}`} onClick={() => watch(d.t)} />
      </td>
      <td className="font-stats text-text-secondary pr-2">{d.round}</td>
      <td className={`pr-2 font-medium ${d.kind === 'kill' ? 'text-val-cyan' : 'text-val-red'}`}>{d.kind === 'kill' ? 'Kill' : 'Death'}</td>
      <td className="font-stats text-text-secondary pr-2">{formatTime(d.clockS)}</td>
      {videoCell(d.t)}
      <td className="pr-2">{names.agent(d.other)}</td>
      <td className="text-text-secondary pr-2">{names.weapon(d.weapon)}</td>
      <td className="font-stats text-right pr-2">{metres(d.distM)}</td>
      <td className="font-stats text-right pr-2">{d.myHp ?? '–'}</td>
      <td className="pr-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${STANCE_TONE[d.stance]}`}>{d.stance}</span>
      </td>
      <td className={`font-stats text-right pr-2 ${d.myOffDeg !== null && d.myOffDeg >= OFF_CROSSHAIR_DEG ? 'text-val-red' : 'text-text-secondary'}`}>
        {d.myOffDeg === null ? '–' : `${d.myOffDeg}°`}
      </td>
      <td className="font-stats pr-2">{d.alive[0]}v{d.alive[1]}</td>
      <td className="text-text-secondary pr-2">{d.where ?? '–'}</td>
      <td className="text-text-muted">{d.traded ? (d.kind === 'kill' ? 'trade' : 'traded') : ''}</td>
    </tr>
  )

  const roundRow = (r: ReportRound) => {
    const henrik = loadoutOf.get(r.n)
    return (
      <tr key={r.n} className="border-t border-bg-elevated/60 hover:bg-bg-card/60">
        <td className="py-1 pr-2">
          <WatchButton label={`Watch round ${r.n}`} onClick={() => onWatch(r.barrierMs - 1000)} />
        </td>
        <td className="font-stats pr-2">{r.n}</td>
        <td className="text-text-secondary pr-2">{r.side ? SIDE_LABEL[r.side] : '–'}</td>
        <td className={`pr-2 font-medium ${r.won ? 'text-val-green' : 'text-val-red'}`}>{r.won ? 'Won' : 'Lost'}</td>
        <td className="pr-2">{r.setup ?? '–'}</td>
        <td className="pr-2">{r.at20 ?? '–'}</td>
        <td className="font-stats text-text-secondary pr-2">{r.plantS === null ? '–' : `${r.plantSite ?? ''} ${formatTime(r.plantS)}`.trim()}</td>
        <td className="font-stats text-right pr-2">{r.distM} m</td>
        <td className="font-stats text-right pr-2">{metres(r.mateM)}</td>
        <td className="font-stats pr-2">
          {r.kills}/{r.deaths + r.selfDeaths}
        </td>
        <td className="text-text-secondary pr-2">{armourLabel(r.armor)}</td>
        <td className="font-stats text-right text-text-secondary">{henrik ? henrik.loadout_value.toLocaleString('en-US') : '–'}</td>
      </tr>
    )
  }

  const sideCard = (side: ReplaySide) => {
    const s = sides[side]
    if (s.rounds === 0) return null
    const top = report.dwell[side].slice(0, 6)
    const max = top[0]?.[1] ?? 1
    return (
      <div key={side} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-3">
        <p className="text-sm font-medium">
          {SIDE_LABEL[side]} <span className="font-stats text-text-secondary">{s.won} of {s.rounds} won</span>
        </p>
        <p className="text-xs text-text-secondary mt-0.5">
          {s.kills} kills, {s.deaths} deaths, died in {s.roundsDied} of {s.rounds} rounds.
          {s.mateM !== null && ` Nearest teammate ${Math.round(s.mateM)} m on average.`}
        </p>
        <ul className="mt-2 space-y-1">
          {top.map(([name, seconds]) => (
            <li key={name} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs">
              <span className="truncate text-text-secondary">{name}</span>
              <span className="h-1.5 rounded bg-bg-elevated overflow-hidden">
                <span className="block h-full bg-val-cyan/70" style={{ width: `${(seconds / max) * 100}%` }} />
              </span>
              <span className="font-stats text-right text-text-muted">{seconds} s</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const smokesBy = (side: ReplaySide) => {
    const counts = new Map<string, number>()
    for (const s of report.kit.smokes) {
      if (s.side === side && s.where) counts.set(s.where, (counts.get(s.where) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }
  const uses = report.kit.uses.filter(u => kitFilter === 'all' || u.slot === kitFilter)

  return (
    <div className="space-y-3 min-w-0">
      <nav aria-label="Sections" className="sticky top-8 z-20 bg-bg-primary/95 backdrop-blur border border-bg-elevated rounded-lg px-2 py-1.5 flex flex-wrap items-center gap-1">
        {sections.map(id => (
          <button
            key={id}
            type="button"
            onClick={() => goTo(id)}
            className="px-2 py-1 rounded text-[11px] uppercase tracking-wide text-text-secondary hover:text-val-cyan hover:bg-bg-card transition-colors"
          >
            {SECTION_LABEL[id]}
          </button>
        ))}
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={() => setAll(true)} className="px-2 py-1 rounded text-[11px] text-text-muted hover:text-val-cyan transition-colors">
            Open all
          </button>
          <button type="button" onClick={() => setAll(false)} className="px-2 py-1 rounded text-[11px] text-text-muted hover:text-val-cyan transition-colors">
            Close all
          </button>
        </span>
      </nav>

      {section('findings', 'The short version', written ? 'The written review, then what the rules find' : 'What the replay says, by fixed rules', (
        <>
          {notes.lede && <p className="text-sm text-text-primary">{notes.lede}</p>}
          {written && (
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <Label tone="text-val-cyan">Already works</Label>
                <ul className="space-y-2">{notes.works.map(noteCard)}</ul>
              </div>
              <div>
                <Label tone="text-val-red">Work on</Label>
                <ul className="space-y-2">{notes.work.map(noteCard)}</ul>
              </div>
            </div>
          )}
          {report.findings.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing stands out by the rules this page applies.</p>
          ) : written ? (
            <details className="group">
              <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-text-muted hover:text-val-cyan transition-colors">
                What the rules found ({report.findings.length})
              </summary>
              <div className="mt-3">{findingColumns}</div>
            </details>
          ) : (
            findingColumns
          )}
          {tableMissing && (
            <p className="text-[11px] text-text-muted">
              Written notes and the trend are kept in a table this database does not have yet (migration 20261120_match_reports.sql).
            </p>
          )}
        </>
      ))}

      {section('rounds', 'Rounds', `${totals.won} of ${totals.rounds} won, died in ${totals.roundsDied}`, (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile value={totals.survivedWon} of={totals.survived} label="rounds survived that were won" tone="good" />
            <Tile value={totals.diedInWon} of={totals.won} label="rounds won that you died in" tone={totals.diedInWon * 2 >= totals.won ? 'bad' : 'plain'} />
            <Tile value={totals.openingDeaths} of={totals.rounds} label="rounds as the first to die" tone={totals.openingDeaths >= 3 ? 'bad' : 'plain'} />
            <Tile value={totals.openingKills} of={totals.rounds} label="rounds with the opening kill" tone="good" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="text-[10px] uppercase tracking-wider text-text-muted text-left">
                <tr>
                  <th className="pb-1" /><th className={TH}>Rd</th><th className={TH}>Side</th><th className={TH}>Result</th><th className={TH}>At 0:10</th>
                  <th className={TH}>At 0:20</th><th className={TH}>Spike</th><th className={`${TH} text-right`}>Walked</th><th className={`${TH} text-right`}>Teammate</th>
                  <th className={TH}>K/D</th><th className={TH}>Armour</th><th className="font-normal text-right">Loadout</th>
                </tr>
              </thead>
              <tbody>{report.rounds.map(roundRow)}</tbody>
            </table>
          </div>
          <p className="text-[11px] text-text-muted">
            Teammate is the mean distance to your nearest living teammate. The loadout is the match record’s; the rest is read off the replay.
          </p>
        </>
      ))}

      {section('positioning', 'Positioning', 'Where you spent the rounds, by side', (
        <>
          {notes.paths.length > 0 && (
            <div>
              <Label tone="text-val-cyan">Best paths</Label>
              {roundNotes(notes.paths, 'Watch')}
            </div>
          )}
          {notes.pathFixes.length > 0 && (
            <div>
              <Label tone="text-val-red">Paths to change</Label>
              {roundNotes(notes.pathFixes, 'Watch')}
            </div>
          )}
          <Points lines={notes.positioning} />
          <div className="grid gap-3 xl:grid-cols-2">{(['defender', 'attacker'] as const).map(sideCard)}</div>
        </>
      ))}

      {section('duels', 'Duels', `${kills.length} kills, ${deaths.length} deaths`, (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile value={totals.standingKills} of={kills.length} label="kills standing or nearly standing" tone="good" />
            <Tile value={totals.runningDeaths} of={deaths.length} label="deaths at running speed" tone="bad" />
            <Tile value={totals.offCrosshairDeaths} of={deaths.length} label={`deaths with the killer ${OFF_CROSSHAIR_DEG}° or more off your crosshair`} tone="bad" />
            <Tile value={deaths.length - totals.tradedDeaths} of={deaths.length} label="deaths not traded" tone="bad" />
          </div>
          {notes.bestDuels.length > 0 ? (
            <div>
              <Label>Your best duels</Label>
              {roundNotes(notes.bestDuels, 'Watch the duel in')}
            </div>
          ) : report.notable.length > 0 && (
            <div>
              <Label>Worth watching again</Label>
              <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {report.notable.map(({ duel, reasons }) => (
                  <li key={duel.t} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <WatchButton label={`Watch the kill in round ${duel.round}`} onClick={() => watch(duel.t)} />
                      <span>
                        Round {duel.round} <span className="font-stats text-text-secondary">{formatTime(duel.clockS)}</span>
                      </span>
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      {names.agent(duel.other)}, {names.weapon(duel.weapon)}
                      {duel.distM !== null && `, ${duel.distM} m`}
                      {roundByN.get(duel.round)?.won ? '. Round won.' : '. Round lost.'}
                    </p>
                    <p className="text-[11px] text-val-cyan mt-1">{reasons.join(' · ')}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Points lines={notes.duels} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="text-[10px] uppercase tracking-wider text-text-muted text-left">
                <tr>
                  <th className="pb-1" /><th className={TH}>Rd</th><th className={TH} /><th className={TH}>Time</th>
                  {videoSecond && <th className={TH}>Video</th>}
                  <th className={TH}>Opponent</th><th className={TH}>Weapon</th><th className={`${TH} text-right`}>Distance</th><th className={`${TH} text-right`}>HP</th>
                  <th className={TH}>You were</th><th className={`${TH} text-right`}>Aim</th><th className={TH}>Alive</th><th className={TH}>Where</th><th />
                </tr>
              </thead>
              <tbody>{report.duels.map(duelRow)}</tbody>
            </table>
          </div>
          <p className="text-[11px] text-text-muted">
            Standing is under 1.5 m a second in the 0.3 seconds before the kill, running over 3 m a second. Aim is the angle between your view and the other
            player 0.15 seconds before the kill. A trade is your killer dying to a teammate within 5 seconds.
            {totals.selfDeaths > 0 && ` ${totals.selfDeaths === 1 ? 'One more death was' : `${totals.selfDeaths} more deaths were`} a second life running out, which is not a duel.`}
          </p>
        </>
      ))}

      {section('economy', 'Economy', 'What the buys cost and kept', (
        <>
          <Points lines={notes.economy} />
          <p className="text-[11px] text-text-muted">
            The loadout and the armour of each round are in the{' '}
            <button type="button" onClick={() => goTo('rounds')} className="underline hover:text-val-cyan">Rounds</button> table.
          </p>
        </>
      ))}

      {section('kit', 'Kit', `${report.kit.uses.length} ability uses, each with its moment`, (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SLOTS.map(slot => (
              <div key={slot} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
                <div className="font-stats text-xl">{report.kit.casts[slot] ?? 0}</div>
                <div className="text-[11px] text-text-secondary">{names.ability(slot)}</div>
              </div>
            ))}
          </div>
          <Points lines={notes.kit} />
          {report.kit.uses.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-1 mb-2" role="group" aria-label="Show one ability">
                <span className="text-[11px] uppercase tracking-wider text-text-muted mr-1">Every use</span>
                {(['all', ...SLOTS.filter(slot => report.kit.casts[slot])] as const).map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setKitFilter(key)}
                    aria-pressed={kitFilter === key}
                    className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                      kitFilter === key ? 'bg-val-cyan/15 text-val-cyan' : 'bg-bg-card text-text-secondary hover:text-val-cyan'
                    }`}
                  >
                    {key === 'all' ? `All ${report.kit.uses.length}` : `${names.ability(key)} ${report.kit.casts[key]}`}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="text-[10px] uppercase tracking-wider text-text-muted text-left sticky top-0 bg-bg-secondary">
                    <tr>
                      <th className="pb-1" /><th className={TH}>Rd</th><th className={TH}>Time</th>
                      {videoSecond && <th className={TH}>Video</th>}
                      <th className={TH}>Ability</th><th className={TH}>You were at</th><th className={TH}>It went to</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {uses.map(u => (
                      <tr key={`${u.t}-${u.slot}`} className="border-t border-bg-elevated/60 hover:bg-bg-card/60">
                        <td className="py-1 pr-2">
                          <WatchButton label={`Watch ${names.ability(u.slot)}, round ${u.round}`} onClick={() => watch(u.t)} />
                        </td>
                        <td className="font-stats text-text-secondary pr-2">{u.round}</td>
                        <td className="font-stats text-text-secondary pr-2">{u.clockS < 0 ? 'buy' : formatTime(u.clockS)}</td>
                        {videoCell(u.t)}
                        <td className="pr-2">{names.ability(u.slot)}</td>
                        <td className="text-text-secondary pr-2">{u.where ?? '–'}</td>
                        <td className="pr-2">{u.lands ?? '–'}</td>
                        <td className="text-val-yellow">{u.afterDeath ? 'after your death' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {report.kit.smokes.length > 0 && (
            <div className="grid gap-3 xl:grid-cols-2">
              {(['defender', 'attacker'] as const).map(side => {
                const places = smokesBy(side)
                if (places.length === 0) return null
                return (
                  <div key={side} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
                    <p className="text-sm font-medium">Smokes on {SIDE_LABEL[side].toLowerCase()}</p>
                    <ul className="mt-1 text-xs text-text-secondary space-y-0.5">
                      {places.map(([name, n]) => (
                        <li key={name} className="flex justify-between">
                          <span>{name}</span>
                          <span className="font-stats">{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
          {report.kit.secondLives.length > 0 && (
            <p className="text-xs text-text-secondary">
              A second life in round{report.kit.secondLives.length === 1 ? '' : 's'} {report.kit.secondLives.join(', ')}.{' '}
              {report.kit.secondLives.map(n => (
                <button key={n} type="button" onClick={() => onWatch((roundByN.get(n)?.barrierMs ?? 0) + (roundByN.get(n)?.deathS[0] ?? 0) * 1000 - LEAD_MS)} className="text-val-cyan hover:underline mr-2">
                  Show round {n}
                </button>
              ))}
            </p>
          )}
          <p className="text-[11px] text-text-muted">
            “It went to” is where the replay recorded what the ability made: a smoke where it stood, a projectile where it came down. A dash means the
            replay recorded nothing of yours at that moment. Places are the nearest callout.
          </p>
        </>
      ))}

      {section('trend', 'Trend', `The last ${trend.length} games with a report`, (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="text-[10px] uppercase tracking-wider text-text-muted text-left">
                <tr>
                  <th className={`${TH} pb-1`}>Date</th><th className={TH}>Map, agent</th><th className={TH}>Result</th><th className={`${TH} text-right`}>K/D/A</th>
                  <th className={`${TH} text-right`}>ACS</th><th className={`${TH} text-right`}>HS%</th><th className={`${TH} text-right`}>Kills standing</th>
                  <th className={`${TH} text-right`}>Deaths moving</th><th className={`${TH} text-right`}>Untraded</th><th className={`${TH} text-right`}>Rounds died in</th>
                  <th className="font-normal text-right">First to die</th>
                </tr>
              </thead>
              <tbody>
                {trend.map(({ match, summary: s }) => {
                  const here = match.match_id === matchId
                  return (
                    <tr key={match.match_id} className={`border-t border-bg-elevated/60 ${here ? 'bg-val-cyan/5' : 'hover:bg-bg-card/60'}`}>
                      <td className="py-1.5 pr-2 font-stats text-text-secondary">
                        {new Date(match.match_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="pr-2">
                        {here ? (
                          <span className="font-medium">{match.map}, {match.agent}</span>
                        ) : (
                          <Link to={`/report/${match.match_id}`} className="hover:text-val-cyan transition-colors">{match.map}, {match.agent}</Link>
                        )}
                      </td>
                      <td className={`pr-2 font-medium ${match.result === 'W' ? 'text-val-green' : match.result === 'L' ? 'text-val-red' : 'text-val-yellow'}`}>
                        {match.result === 'W' ? 'Win' : match.result === 'L' ? 'Loss' : 'Draw'} {match.score}
                      </td>
                      <td className="font-stats text-right pr-2">{match.kills}/{match.deaths}/{match.assists}</td>
                      <td className="font-stats text-right pr-2">{Math.round(match.acs)}</td>
                      <td className="font-stats text-right pr-2">{Math.round(match.headshot_pct)}</td>
                      <td className="font-stats text-right pr-2">{s.standingKills} / {s.kills}</td>
                      <td className="font-stats text-right pr-2">{s.movingDeaths} / {s.deaths}</td>
                      <td className="font-stats text-right pr-2">{s.untradedDeaths} / {s.deaths}</td>
                      <td className="font-stats text-right pr-2">{s.roundsDied} / {s.rounds}</td>
                      <td className="font-stats text-right">{s.openingDeaths}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-text-muted">
            A game joins this table the first time its report is opened, which is when its counts are saved. All of them use the same rules.
          </p>
        </>
      ))}

      {section('next', 'Next session', 'What to take into the next game', (
        <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {notes.next.map(item => (
            <li key={item.title} className="bg-bg-card border border-val-cyan/25 rounded-lg px-3 py-2">
              {item.tag && <p className="text-[10px] uppercase tracking-wider text-val-cyan">{item.tag}</p>}
              <p className="text-sm font-medium text-text-primary mt-0.5">{item.title}</p>
              <p className="text-xs text-text-secondary mt-1"><Rich line={item.body} /></p>
            </li>
          ))}
        </ul>
      ))}

      <p className="text-[11px] text-text-muted px-1">
        The replay shows where everyone was and what they used, not what anyone could see. Whether a wall was in the way is not in the data.
      </p>
    </div>
  )
}
