/**
 * The match report's numbers, read off a replay bundle (docs/match-report.md).
 *
 * One pass over the bundle gives, for the player it was built for: every round
 * (where they set up, the route, how far they walked, how close a teammate
 * was), every kill and death as a duel (speed, facing, health, who was alive),
 * the seconds spent on each callout, the kit, and a list of findings worked out
 * by fixed rules.
 *
 * The rules are those of the vault's `match_replay.py` and
 * `match_report_page.py`, so the page in the app and the HTML reports agree:
 * speed is taken over the 0.3 s that end 0.1 s before the kill, facing 0.15 s
 * before it, health 1.5 s before it, and who is alive 0.2 s before it. A trade
 * is the killer dying to a teammate within 5 s.
 *
 * Times are replay milliseconds unless a name ends in `S` (seconds after the
 * round's barrier drop). Positions are world centimetres.
 *
 * Pure: no Supabase, no DOM. Covered by `matchReport.test.ts`.
 */

import type { ReplayBundle, ReplayKill, ReplaySide, ReplayTrackSample } from './replayBundle.ts'
import { playerStateAt } from './replayScene.ts'

/** Slower than this before the shot (units a second) is standing. */
export const STANDING_MAX_SPEED = 150
/** Faster than this is running. */
export const RUNNING_MIN_SPEED = 300
/** A killer further than this from the crosshair was not being looked at. */
export const OFF_CROSSHAIR_DEG = 38
/** A killer who dies to a teammate within this long was traded. */
export const TRADE_WINDOW_MS = 5000

/** A sample older than this says nothing about now (a body stops reporting after a death). */
const STALE_SAMPLE_MS = 400
const SPEED_WINDOW_MS = 300

export interface ReportCallout {
  name: string
  x: number
  y: number
}

export type Stance = 'standing' | 'moving' | 'running'
export type AbilitySlot = 'C' | 'Q' | 'E' | 'X'

export interface ReportDuel {
  round: number
  side: ReplaySide | null
  kind: 'kill' | 'death'
  /** Replay time of the kill. */
  t: number
  clockS: number
  /** The other player's subject. */
  other: string | null
  /** Index into the bundle's weapons; null for an ability. */
  weapon: number | null
  distM: number | null
  myHp: number | null
  theirHp: number | null
  mySpeed: number
  theirSpeed: number
  stance: Stance
  /** Degrees between the view and the other player; null when the track has nothing there. */
  myOffDeg: number | null
  theirOffDeg: number | null
  /** Alive just before the kill: the owner's team, then the other. */
  alive: [number, number]
  nearestMateM: number | null
  /** The first kill of the round. */
  first: boolean
  won: boolean
  where: string | null
  theirWhere: string | null
  /** A death: the killer died to a teammate within 5 s. A kill: the victim had killed a teammate in the 5 s before. */
  traded: boolean
  blinded: boolean
}

export interface ReportRound {
  n: number
  side: ReplaySide | null
  won: boolean
  how: string | null
  barrierMs: number
  /** Whole seconds from the barrier drop to two seconds past the end. */
  durS: number
  plantS: number | null
  plantSite: string | null
  defuseS: number | null
  /** The callout at 0:10 and at 0:20; null when dead or untracked then. */
  setup: string | null
  at20: string | null
  /** Each change of callout, read every two seconds: [second, callout]. */
  route: Array<[number, string]>
  distM: number
  /** Mean distance to the nearest living teammate, read once a second. */
  mateM: number | null
  kills: number
  /** Deaths to another player. */
  deaths: number
  /** Deaths with no killer but the player: an ultimate's second life running out. */
  selfDeaths: number
  deathS: number[]
  firstKillS: number | null
  /** Armour at the barrier drop: 0, 25 or 50. Null without vitals. */
  armor: number | null
  casts: Partial<Record<AbilitySlot, number>>
}

export interface ReportSmoke {
  round: number
  side: ReplaySide | null
  clockS: number
  where: string | null
  x: number
  y: number
  /** Placed after the player's first death of the round. */
  afterDeath: boolean
}

export interface ReportSideTotals {
  rounds: number
  won: number
  kills: number
  deaths: number
  roundsDied: number
  mateM: number | null
}

export type ReportSection = 'rounds' | 'positioning' | 'duels' | 'kit'

export interface ReportFinding {
  tone: 'works' | 'work'
  title: string
  body: string
  section: ReportSection
  /** A moment that shows it, when one does. */
  jump?: { round: number; t: number }
}

export interface NotableDuel {
  duel: ReportDuel
  /** Why it stands out, most telling first. */
  reasons: string[]
}

export interface MatchReport {
  subject: string
  rounds: ReportRound[]
  duels: ReportDuel[]
  /** Seconds alive per callout, most first. */
  dwell: Record<ReplaySide, Array<[string, number]>>
  sides: Record<ReplaySide, ReportSideTotals>
  totals: {
    rounds: number
    won: number
    kills: number
    /** Deaths to another player. */
    deaths: number
    selfDeaths: number
    roundsDied: number
    survivedWon: number
    survived: number
    diedInWon: number
    standingKills: number
    movingDeaths: number
    runningDeaths: number
    offCrosshairDeaths: number
    tradedDeaths: number
    tradeKills: number
    openingDeaths: number
    openingKills: number
  }
  kit: {
    casts: Partial<Record<AbilitySlot, number>>
    smokes: ReportSmoke[]
    /** Rounds with a second life: two deaths, or a death and a timed-out return. */
    secondLives: number[]
  }
  notable: NotableDuel[]
  findings: ReportFinding[]
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

function nearestCallout(callouts: ReadonlyArray<ReportCallout>, x: number, y: number): string | null {
  let best: ReportCallout | null = null
  let bestD = Infinity
  for (const c of callouts) {
    const d = Math.hypot(c.x - x, c.y - y)
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  return best?.name ?? null
}

/** The last row at or before `t`; -1 when there is none. */
function lastAt(rows: ReadonlyArray<readonly [number, ...unknown[]]>, t: number): number {
  let lo = 0
  let hi = rows.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid][0] <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function stanceOf(speed: number): Stance {
  return speed < STANDING_MAX_SPEED ? 'standing' : speed <= RUNNING_MIN_SPEED ? 'moving' : 'running'
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const SIDE_NAME: Record<ReplaySide, string> = { attacker: 'attack', defender: 'defence' }

/**
 * The report for the player the bundle was built for; null when the bundle has
 * no such player or no round with a barrier drop. `callouts` name the places:
 * without them every place is null and the place-based findings are left out.
 */
export function buildMatchReport(bundle: ReplayBundle, callouts: ReadonlyArray<ReportCallout> = []): MatchReport | null {
  const me = bundle.players.find(p => p.isMe)?.subject
  if (!me) return null
  const teamOf = new Map(bundle.players.map(p => [p.subject, p.team]))
  const tracks = bundle.tracks.byPlayer
  const allies = bundle.players.filter(p => p.team === 'ALLY').map(p => p.subject)
  const enemies = bundle.players.filter(p => p.team === 'ENEMY').map(p => p.subject)
  const mates = allies.filter(s => s !== me)

  const stateAt = (subject: string, t: number) => {
    const rows: ReplayTrackSample[] | undefined = tracks[subject]
    if (!rows) return null
    const state = playerStateAt(rows, t)
    return state && t - state.sampledAt <= STALE_SAMPLE_MS ? state : null
  }
  const aliveAt = (subject: string, t: number) => stateAt(subject, t)?.alive === true
  const speedAt = (subject: string, t: number) => {
    const a = stateAt(subject, t - SPEED_WINDOW_MS)
    const b = stateAt(subject, t)
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) / (SPEED_WINDOW_MS / 1000) : 0
  }
  const offAngle = (subject: string, t: number, tx: number, ty: number) => {
    const s = stateAt(subject, t)
    if (!s) return null
    const to = (Math.atan2(ty - s.y, tx - s.x) * 180) / Math.PI
    return Math.abs(((s.yaw - to + 540) % 360) - 180)
  }
  const hpAt = (subject: string, t: number) => {
    const rows = bundle.vitals?.[subject]
    if (!rows) return null
    const i = lastAt(rows, t)
    return i >= 0 ? rows[i] : null
  }
  const place = (x: number, y: number) => nearestCallout(callouts, x, y)

  const rounds: ReportRound[] = []
  const duels: ReportDuel[] = []
  const smokes: ReportSmoke[] = []
  const dwellMaps: Record<ReplaySide, Map<string, number>> = { attacker: new Map(), defender: new Map() }
  const mateBySide: Record<ReplaySide, number[]> = { attacker: [], defender: [] }
  const secondLives: number[] = []

  for (const round of bundle.rounds) {
    const t0 = round.barrierMs
    if (t0 == null) continue
    const n = round.n
    const won = round.winner === 'ALLY'
    const endMs = round.endMs ?? bundle.rounds.find(r => r.n === n + 1)?.buyStartMs ?? bundle.match.durationMs
    const durS = Math.floor((endMs + 2000 - t0) / 1000)
    const roundKills = bundle.kills.filter(k => k.round === n)

    // The path: five samples a second for the distance, one a second for the rest.
    let prev: { x: number; y: number } | null = null
    let dist = 0
    const mateD: number[] = []
    for (let step = 0; step <= durS * 5; step++) {
      const t = t0 + step * 200
      const s = stateAt(me, t)
      if (!s || !s.alive) continue
      if (prev) dist += Math.hypot(s.x - prev.x, s.y - prev.y)
      prev = s
      if (step % 5 !== 0) continue
      const name = place(s.x, s.y)
      if (name && round.side) dwellMaps[round.side].set(name, (dwellMaps[round.side].get(name) ?? 0) + 1)
      const near: number[] = []
      for (const sub of mates) {
        const o = stateAt(sub, t)
        if (o && o.alive) near.push(Math.hypot(o.x - s.x, o.y - s.y))
      }
      if (near.length > 0) mateD.push(Math.min(...near) / 100)
    }
    const whereAt = (sec: number) => {
      const s = stateAt(me, t0 + sec * 1000)
      return s && s.alive ? place(s.x, s.y) : null
    }
    const route: Array<[number, string]> = []
    for (let sec = 0; sec <= durS; sec += 2) {
      const c = whereAt(sec)
      if (c && (route.length === 0 || route[route.length - 1][1] !== c)) route.push([sec, c])
    }

    const myDeaths = roundKills.filter(k => k.victim === me)
    const firstDeath = myDeaths.length > 0 ? Math.min(...myDeaths.map(k => k.t)) : null
    const selfDeaths = myDeaths.filter(k => k.killer === me).length
    if (myDeaths.length > 1) secondLives.push(n)

    const casts: Partial<Record<AbilitySlot, number>> = {}
    for (const cast of bundle.casts) {
      if (cast.round !== n || cast.player !== me) continue
      if (cast.slot === 'C' || cast.slot === 'Q' || cast.slot === 'E' || cast.slot === 'X') casts[cast.slot] = (casts[cast.slot] ?? 0) + 1
    }
    const nextBuy = bundle.rounds.find(r => r.n === n + 1)?.buyStartMs ?? Infinity
    for (const effect of bundle.effects) {
      if (effect.owner !== me || effect.kind !== 'smoke' || effect.start < round.buyStartMs || effect.start >= nextBuy) continue
      smokes.push({
        round: n,
        side: round.side,
        clockS: Math.round((effect.start - t0) / 100) / 10,
        where: place(effect.x, effect.y),
        x: effect.x,
        y: effect.y,
        afterDeath: firstDeath !== null && effect.start > firstDeath,
      })
    }

    const plant = round.plant != null ? bundle.spike.plants.find(p => p.round === n) : undefined
    const firstKillT = roundKills.length > 0 ? Math.min(...roundKills.map(k => k.t)) : null
    const vitals = hpAt(me, t0)
    const mateM = mateD.length > 0 ? Math.round(mean(mateD) * 10) / 10 : null
    if (mateM !== null && round.side) mateBySide[round.side].push(mateM)

    let kills = 0
    let deaths = 0
    for (const k of roundKills) {
      if ((k.killer !== me && k.victim !== me) || k.killer === k.victim) continue
      const mine = k.killer === me
      const other = mine ? k.victim : k.killer
      if (mine) kills++
      else deaths++
      const [mx, my] = mine ? [k.kx, k.ky] : [k.vx, k.vy]
      const [ox, oy] = mine ? [k.vx, k.vy] : [k.kx, k.ky]
      const placed = mx != null && my != null && ox != null && oy != null
      const before = k.t - 200
      const near: number[] = []
      if (mx != null && my != null) {
        for (const sub of mates) {
          const o = stateAt(sub, before)
          if (o && o.alive) near.push(Math.hypot(o.x - mx, o.y - my) / 100)
        }
      }
      const mySpeed = Math.round(speedAt(me, k.t - 100))
      const traded = mine
        ? roundKills.some(q => q.killer === other && q.victim !== me && teamOf.get(q.victim ?? '') === 'ALLY' && q.t < k.t && k.t - q.t <= TRADE_WINDOW_MS)
        : roundKills.some(q => q.victim === other && q.killer !== other && teamOf.get(q.killer ?? '') === 'ALLY' && q.t > k.t && q.t - k.t <= TRADE_WINDOW_MS)
      const round1 = (v: number) => Math.round(v * 10) / 10
      duels.push({
        round: n,
        side: round.side,
        kind: mine ? 'kill' : 'death',
        t: k.t,
        clockS: round1((k.t - t0) / 1000),
        other,
        weapon: k.weapon,
        distM: placed ? round1(Math.hypot((ox as number) - (mx as number), (oy as number) - (my as number)) / 100) : null,
        myHp: hpAt(me, k.t - 1500)?.[1] ?? null,
        theirHp: other ? hpAt(other, k.t - 1500)?.[1] ?? null : null,
        mySpeed,
        theirSpeed: other ? Math.round(speedAt(other, k.t - 100)) : 0,
        stance: stanceOf(mySpeed),
        myOffDeg: ox != null && oy != null ? roundOrNull(offAngle(me, k.t - 150, ox, oy)) : null,
        theirOffDeg: other && mx != null && my != null ? roundOrNull(offAngle(other, k.t - 150, mx, my)) : null,
        alive: [allies.filter(s => aliveAt(s, before)).length, enemies.filter(s => aliveAt(s, before)).length],
        nearestMateM: near.length > 0 ? round1(Math.min(...near)) : null,
        first: firstKillT === k.t,
        won,
        where: mx != null && my != null ? place(mx, my) : null,
        theirWhere: ox != null && oy != null ? place(ox, oy) : null,
        traded,
        blinded: (bundle.blinds?.[me] ?? []).some(([a, b]) => a <= k.t && k.t <= b + 300),
      })
    }

    rounds.push({
      n,
      side: round.side,
      won,
      how: round.how,
      barrierMs: t0,
      durS,
      plantS: round.plant != null ? Math.round((round.plant - t0) / 100) / 10 : null,
      plantSite: plant?.site ?? null,
      defuseS: round.defuse != null ? Math.round((round.defuse - t0) / 100) / 10 : null,
      setup: whereAt(10),
      at20: whereAt(20),
      route,
      distM: Math.round(dist / 100),
      mateM,
      kills,
      deaths,
      selfDeaths,
      deathS: myDeaths.map(k => Math.round((k.t - t0) / 100) / 10).sort((a, b) => a - b),
      firstKillS: firstKillT !== null ? Math.round((firstKillT - t0) / 100) / 10 : null,
      // With vitals recorded, no row yet means the 100 and no armour a player starts on.
      armor: bundle.vitals?.[me] ? (vitals ? vitals[2] : 0) : null,
      casts,
    })
  }
  if (rounds.length === 0) return null

  const sideTotals = (side: ReplaySide): ReportSideTotals => {
    const own = rounds.filter(r => r.side === side)
    return {
      rounds: own.length,
      won: own.filter(r => r.won).length,
      kills: own.reduce((sum, r) => sum + r.kills, 0),
      deaths: own.reduce((sum, r) => sum + r.deaths, 0),
      roundsDied: own.filter(r => r.deathS.length > 0).length,
      mateM: mateBySide[side].length > 0 ? Math.round(mean(mateBySide[side]) * 10) / 10 : null,
    }
  }
  const myKills = duels.filter(d => d.kind === 'kill')
  const myDeaths = duels.filter(d => d.kind === 'death')
  const died = (r: ReportRound) => r.deathS.length > 0
  const firstVictimOf = (n: number): ReplayKill | undefined =>
    bundle.kills.filter(k => k.round === n && k.killer !== k.victim).sort((a, b) => a.t - b.t)[0]
  const casts: Partial<Record<AbilitySlot, number>> = {}
  for (const r of rounds) {
    for (const slot of ['C', 'Q', 'E', 'X'] as const) {
      if (r.casts[slot]) casts[slot] = (casts[slot] ?? 0) + (r.casts[slot] as number)
    }
  }

  const report: MatchReport = {
    subject: me,
    rounds,
    duels,
    dwell: {
      attacker: [...dwellMaps.attacker].sort((a, b) => b[1] - a[1]),
      defender: [...dwellMaps.defender].sort((a, b) => b[1] - a[1]),
    },
    sides: { attacker: sideTotals('attacker'), defender: sideTotals('defender') },
    totals: {
      rounds: rounds.length,
      won: rounds.filter(r => r.won).length,
      kills: myKills.length,
      deaths: myDeaths.length,
      selfDeaths: rounds.reduce((sum, r) => sum + r.selfDeaths, 0),
      roundsDied: rounds.filter(died).length,
      survived: rounds.filter(r => !died(r)).length,
      survivedWon: rounds.filter(r => !died(r) && r.won).length,
      diedInWon: rounds.filter(r => died(r) && r.won).length,
      standingKills: myKills.filter(d => d.stance === 'standing').length,
      movingDeaths: myDeaths.filter(d => d.stance !== 'standing').length,
      runningDeaths: myDeaths.filter(d => d.stance === 'running').length,
      offCrosshairDeaths: myDeaths.filter(d => d.myOffDeg !== null && d.myOffDeg >= OFF_CROSSHAIR_DEG).length,
      tradedDeaths: myDeaths.filter(d => d.traded).length,
      tradeKills: myKills.filter(d => d.traded).length,
      openingDeaths: rounds.filter(r => firstVictimOf(r.n)?.victim === me).length,
      openingKills: myKills.filter(d => d.first).length,
    },
    kit: { casts, smokes, secondLives },
    notable: [],
    findings: [],
  }
  report.notable = notableDuels(report)
  report.findings = findingsOf(report)
  return report
}

function roundOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v)
}

/** The kills worth watching again, best first: a clutch, a trade, a long shot, a fight won low or outnumbered. */
function notableDuels(report: MatchReport): NotableDuel[] {
  const scored = report.duels
    .filter(d => d.kind === 'kill')
    .map(duel => {
      const reasons: Array<[number, string]> = []
      const [us, them] = duel.alive
      if (us === 1 && duel.won) reasons.push([4, them === 1 ? 'One against one, won' : `Last alive against ${them}`])
      if (duel.traded) reasons.push([2, 'Trade for a teammate'])
      if (duel.myHp !== null && duel.myHp <= 40) reasons.push([2, `Won on ${duel.myHp} HP`])
      if (duel.first) reasons.push([2, 'Opening kill of the round'])
      if (us > 1 && us < them) reasons.push([1, `${us} against ${them}`])
      if (duel.distM !== null && duel.distM >= 25) reasons.push([1, `${Math.round(duel.distM)} m`])
      if (duel.stance === 'standing' && duel.theirSpeed > RUNNING_MIN_SPEED) reasons.push([1, 'Standing, on a running target'])
      reasons.sort((a, b) => b[0] - a[0])
      return { duel, score: reasons.reduce((sum, r) => sum + r[0], 0), reasons: reasons.map(r => r[1]) }
    })
    .filter(x => x.score > 0)
  scored.sort((a, b) => b.score - a.score || a.duel.t - b.duel.t)
  return scored.slice(0, 5).map(({ duel, reasons }) => ({ duel, reasons }))
}

/**
 * What the numbers say, by fixed rules. Each finding states a count and the
 * rounds behind it; none of it is a judgement a person wrote.
 */
function findingsOf(report: MatchReport): ReportFinding[] {
  const out: ReportFinding[] = []
  const { totals, rounds, duels, sides } = report
  const kills = duels.filter(d => d.kind === 'kill')
  const deaths = duels.filter(d => d.kind === 'death')
  const roundList = (ns: number[]) => {
    const unique = [...new Set(ns)].sort((a, b) => a - b)
    return unique.length === 1 ? `round ${unique[0]}` : `rounds ${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
  }

  if (kills.length >= 4 && totals.standingKills * 2 >= kills.length) {
    out.push({
      tone: 'works',
      title: 'Your kills come from standing still',
      body: `${totals.standingKills} of ${kills.length} kills were shot at under 1.5 m a second.`,
      section: 'duels',
    })
  }
  if (deaths.length >= 4 && totals.movingDeaths * 2 >= deaths.length) {
    const running = deaths.filter(d => d.stance === 'running')
    out.push({
      tone: 'work',
      title: 'You die while moving',
      body: `${totals.movingDeaths} of ${deaths.length} deaths came at more than 1.5 m a second` + (running.length > 0 ? `, ${running.length} at a full run (${roundList(running.map(d => d.round))}).` : '.'),
      section: 'duels',
      jump: running[0] ? { round: running[0].round, t: running[0].t } : undefined,
    })
  }
  if (totals.survived >= 3 && totals.survivedWon === totals.survived) {
    out.push({
      tone: 'works',
      title: 'Every round you survived was won',
      body: `${plural(totals.survived, 'round')} alive at the end, ${plural(totals.survivedWon, 'win')}.`,
      section: 'rounds',
    })
  }
  if (totals.won >= 4 && totals.diedInWon * 2 >= totals.won) {
    out.push({
      tone: 'work',
      title: `You died in ${totals.diedInWon} of the ${totals.won} rounds your team won`,
      body: `${roundList(rounds.filter(r => r.won && r.deathS.length > 0).map(r => r.n))}. Each one meant buying again.`.replace(/^r/, 'R'),
      section: 'rounds',
    })
  }
  if (totals.openingDeaths === 0 && rounds.length >= 8) {
    out.push({ tone: 'works', title: 'Never the first to die', body: `No opening death in ${rounds.length} rounds.`, section: 'rounds' })
  } else if (totals.openingDeaths >= 3) {
    out.push({
      tone: 'work',
      title: `First to die in ${plural(totals.openingDeaths, 'round')}`,
      body: 'The round started a player down each time.',
      section: 'rounds',
    })
  }
  if (totals.tradeKills >= 3) {
    out.push({
      tone: 'works',
      title: 'You traded your teammates',
      body: `${totals.tradeKills} of your kills came within 5 seconds of that player killing a teammate.`,
      section: 'duels',
    })
  }
  const untraded = deaths.filter(d => !d.traded)
  if (deaths.length >= 4 && untraded.length * 10 >= deaths.length * 6) {
    const far = untraded.filter(d => d.nearestMateM !== null && d.nearestMateM > 15).length
    out.push({
      tone: 'work',
      title: `${untraded.length} of ${deaths.length} deaths went untraded`,
      body: far > 0 ? `In ${far} of them the nearest teammate was more than 15 m away.` : 'A teammate was close each time, and the trade still did not come.',
      section: 'duels',
    })
  }
  const alone = deaths.filter(d => d.alive[0] <= d.alive[1] - 2 && (d.nearestMateM === null || d.nearestMateM > 20))
  if (alone.length >= 2) {
    out.push({
      tone: 'work',
      title: 'Fights taken alone when already down',
      body: `${plural(alone.length, 'death')} two or more players down with no teammate within 20 m: ${roundList(alone.map(d => d.round))}.`,
      section: 'positioning',
      jump: { round: alone[0].round, t: alone[0].t },
    })
  }
  const spots = new Map<string, ReportDuel[]>()
  for (const d of deaths) {
    if (!d.where) continue
    const list = spots.get(d.where)
    if (list) list.push(d)
    else spots.set(d.where, [d])
  }
  const worst = [...spots].sort((a, b) => b[1].length - a[1].length)[0]
  if (worst && worst[1].length >= 3) {
    out.push({
      tone: 'work',
      title: `${worst[1].length} deaths at ${worst[0]}`,
      body: `${roundList(worst[1].map(d => d.round))}, ${worst[1].filter(d => !d.won).length} of them in rounds lost.`.replace(/^r/, 'R'),
      section: 'positioning',
      jump: { round: worst[1][0].round, t: worst[1][0].t },
    })
  }
  const a = sides.attacker
  const d = sides.defender
  if (a.rounds >= 3 && d.rounds >= 3) {
    const rate = (s: ReportSideTotals) => s.kills / s.rounds
    const [strong, weak] = rate(a) >= rate(d) ? (['attacker', 'defender'] as const) : (['defender', 'attacker'] as const)
    const s = sides[strong]
    const w = sides[weak]
    if (rate(s) >= rate(w) * 1.8 && s.kills - w.kills >= 3) {
      out.push({
        tone: 'work',
        title: `Two different halves: ${w.kills} kills on ${SIDE_NAME[weak]}, ${s.kills} on ${SIDE_NAME[strong]}`,
        body: `On ${SIDE_NAME[weak]} you died in ${w.roundsDied} of ${w.rounds} rounds, on ${SIDE_NAME[strong]} in ${s.roundsDied} of ${s.rounds}.`,
        section: 'rounds',
      })
    }
    if (a.mateM !== null && d.mateM !== null && Math.max(a.mateM, d.mateM) >= Math.min(a.mateM, d.mateM) * 1.8) {
      const close = a.mateM < d.mateM ? 'attacker' : 'defender'
      const apart = close === 'attacker' ? 'defender' : 'attacker'
      out.push({
        tone: sides[close].won * sides[apart].rounds >= sides[apart].won * sides[close].rounds ? 'works' : 'work',
        title: `${SIDE_NAME[close][0].toUpperCase()}${SIDE_NAME[close].slice(1)} was played next to someone`,
        body: `The nearest teammate averaged ${Math.round(sides[close].mateM as number)} m on ${SIDE_NAME[close]} and ${Math.round(sides[apart].mateM as number)} m on ${SIDE_NAME[apart]}.`,
        section: 'positioning',
      })
    }
  }
  return out
}
