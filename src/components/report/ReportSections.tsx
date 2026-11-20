import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Play } from 'lucide-react'
import type { AbilitySlot, MatchReport, ReportDuel, ReportFinding, ReportRound, ReportSection, Stance } from '../../lib/matchReport'
import { OFF_CROSSHAIR_DEG } from '../../lib/matchReport'
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
  names: ReportNames
  /** Henrik's rows for the match, for the loadout column; empty when the match has none stored. */
  matchRounds: MatchRound[]
  /** Shows a replay moment on the stage. */
  onWatch: (replayMs: number) => void
  /** The video second of a replay time, when the match has a synced recording. */
  videoSecond: ((replayMs: number) => number) | null
  matchId: string
}

type SectionId = 'findings' | ReportSection

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'findings', label: 'Short version' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'positioning', label: 'Positioning' },
  { id: 'duels', label: 'Duels' },
  { id: 'kit', label: 'Kit' },
]
const OPEN_AT_FIRST: Record<SectionId, boolean> = { findings: true, rounds: true, positioning: false, duels: true, kit: false }

const SIDE_LABEL: Record<ReplaySide, string> = { attacker: 'Attack', defender: 'Defence' }
const STANCE_TONE: Record<Stance, string> = {
  standing: 'bg-val-green/10 text-val-green',
  moving: 'bg-val-yellow/10 text-val-yellow',
  running: 'bg-val-red/10 text-val-red',
}
/** How long before a moment the stage starts, so the fight is seen coming. */
const LEAD_MS = 3000

const armourLabel = (armor: number | null) => (armor === null ? '–' : armor >= 50 ? 'Heavy' : armor >= 25 ? 'Light' : armor > 0 ? String(armor) : 'None')
const metres = (m: number | null) => (m === null ? '–' : `${m} m`)

function WatchButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-6 h-6 rounded bg-val-cyan/10 text-val-cyan hover:bg-val-cyan/25 inline-flex items-center justify-center transition-colors"
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

/**
 * The report's text (docs/match-report.md): collapsible sections under a bar
 * that stays in view, every round, duel and finding with a button that shows
 * its moment on the stage beside it.
 */
export default function ReportSections({ report, names, matchRounds, onWatch, videoSecond, matchId }: ReportSectionsProps) {
  const [open, setOpen] = useState(OPEN_AT_FIRST)
  const setAll = (value: boolean) => setOpen({ findings: value, rounds: value, positioning: value, duels: value, kit: value })
  const goTo = (id: SectionId) => {
    setOpen(prev => ({ ...prev, [id]: true }))
    // After the section has opened, so the scroll lands on its content.
    requestAnimationFrame(() => document.getElementById(`report-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const watch = (replayMs: number) => onWatch(replayMs - LEAD_MS)

  const section = (id: SectionId, title: string, sub: string, children: ReactNode) => (
    <section id={`report-${id}`} className="scroll-mt-20 bg-bg-secondary border border-bg-elevated rounded-lg">
      <h2>
        <button
          type="button"
          onClick={() => setOpen(prev => ({ ...prev, [id]: !prev[id] }))}
          aria-expanded={open[id]}
          className="w-full flex items-center gap-2 px-4 py-3 text-left"
        >
          {open[id] ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
          <span className="text-base font-semibold tracking-wide uppercase">{title}</span>
          <span className="text-xs text-text-muted font-normal normal-case truncate">{sub}</span>
        </button>
      </h2>
      {open[id] && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </section>
  )

  const { totals, sides } = report
  const kills = report.duels.filter(d => d.kind === 'kill')
  const deaths = report.duels.filter(d => d.kind === 'death')
  const works = report.findings.filter(f => f.tone === 'works')
  const work = report.findings.filter(f => f.tone === 'work')
  const loadoutOf = new Map(matchRounds.map(r => [r.round_number, r]))
  const roundByN = new Map(report.rounds.map(r => [r.n, r]))

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

  const duelRow = (d: ReportDuel, i: number) => (
    <tr key={`${d.t}-${i}`} className="border-t border-bg-elevated/60 hover:bg-bg-card/60">
      <td className="py-1 pr-2">
        <WatchButton label={`Watch this ${d.kind}, round ${d.round}`} onClick={() => watch(d.t)} />
      </td>
      <td className="font-stats text-text-secondary pr-2">{d.round}</td>
      <td className={`pr-2 font-medium ${d.kind === 'kill' ? 'text-val-cyan' : 'text-val-red'}`}>{d.kind === 'kill' ? 'Kill' : 'Death'}</td>
      <td className="font-stats text-text-secondary pr-2">{formatTime(d.clockS)}</td>
      {videoSecond && (
        <td className="font-stats pr-2">
          <Link
            to={`/review/${matchId}?t=${Math.max(0, Math.floor(videoSecond(d.t) - LEAD_MS / 1000))}`}
            title="Open the review at this moment of the video"
            className="text-text-muted hover:text-val-cyan transition-colors"
          >
            {formatTime(Math.max(0, videoSecond(d.t)))}
          </Link>
        </td>
      )}
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

  return (
    <div className="space-y-3 min-w-0">
      <nav aria-label="Sections" className="sticky top-8 z-20 bg-bg-primary/95 backdrop-blur border border-bg-elevated rounded-lg px-2 py-1.5 flex flex-wrap items-center gap-1">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => goTo(s.id)}
            className="px-2 py-1 rounded text-[11px] uppercase tracking-wide text-text-secondary hover:text-val-cyan hover:bg-bg-card transition-colors"
          >
            {s.label}
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

      {section('findings', 'The short version', 'What the replay says, by fixed rules', (
        report.findings.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing stands out by the rules this page applies.</p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-val-cyan mb-2">Already works</p>
              {works.length > 0 ? <ul className="space-y-2">{works.map(finding)}</ul> : <p className="text-xs text-text-muted">Nothing by these rules.</p>}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-val-red mb-2">Work on</p>
              {work.length > 0 ? <ul className="space-y-2">{work.map(finding)}</ul> : <p className="text-xs text-text-muted">Nothing by these rules.</p>}
            </div>
          </div>
        )
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
                  <th className="pb-1" /><th className="pr-2">Rd</th><th className="pr-2">Side</th><th className="pr-2">Result</th><th className="pr-2">At 0:10</th>
                  <th className="pr-2">At 0:20</th><th className="pr-2">Spike</th><th className="pr-2 text-right">Walked</th><th className="pr-2 text-right">Teammate</th>
                  <th className="pr-2">K/D</th><th className="pr-2">Armour</th><th className="text-right">Loadout</th>
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
        <div className="grid gap-3 xl:grid-cols-2">{(['defender', 'attacker'] as const).map(sideCard)}</div>
      ))}

      {section('duels', 'Duels', `${kills.length} kills, ${deaths.length} deaths`, (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile value={totals.standingKills} of={kills.length} label="kills standing or nearly standing" tone="good" />
            <Tile value={totals.runningDeaths} of={deaths.length} label="deaths at running speed" tone="bad" />
            <Tile value={totals.offCrosshairDeaths} of={deaths.length} label={`deaths with the killer ${OFF_CROSSHAIR_DEG}° or more off your crosshair`} tone="bad" />
            <Tile value={deaths.length - totals.tradedDeaths} of={deaths.length} label="deaths not traded" tone="bad" />
          </div>
          {report.notable.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Worth watching again</p>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="text-[10px] uppercase tracking-wider text-text-muted text-left">
                <tr>
                  <th className="pb-1" /><th className="pr-2">Rd</th><th className="pr-2" /><th className="pr-2">Time</th>
                  {videoSecond && <th className="pr-2">Video</th>}
                  <th className="pr-2">Opponent</th><th className="pr-2">Weapon</th><th className="pr-2 text-right">Distance</th><th className="pr-2 text-right">HP</th>
                  <th className="pr-2">You were</th><th className="pr-2 text-right">Aim</th><th className="pr-2">Alive</th><th className="pr-2">Where</th><th />
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

      {section('kit', 'Kit', 'What you used, and where the smokes landed', (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['C', 'Q', 'E', 'X'] as const).map(slot => (
              <div key={slot} className="bg-bg-card border border-bg-elevated rounded-lg px-3 py-2">
                <div className="font-stats text-xl">{report.kit.casts[slot] ?? 0}</div>
                <div className="text-[11px] text-text-secondary">{names.ability(slot)}</div>
              </div>
            ))}
          </div>
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
          <p className="text-[11px] text-text-muted">A smoke is named by the callout nearest to where it landed.</p>
        </>
      ))}

      <p className="text-[11px] text-text-muted px-1">
        The replay shows where everyone was and what they used, not what anyone could see. Whether a wall was in the way is not in the data.
      </p>
    </div>
  )
}
