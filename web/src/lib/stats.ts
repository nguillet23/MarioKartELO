// Derived stats over the result history: head-to-head records, streaks,
// rivals, personal bests, and the post-submission recap.
//
// Everything here is a pure function of `GrandPrix[]` (oldest first) so it can
// be unit-tested without a database — see `stats.test.ts`. Nothing here needs
// a new table: `gp_results` already stores each player's points and the exact
// rating they carried into and out of every GP.

import { expectedScore, pairwiseEloExchange } from './elo'
import { rosterFromHistory } from './history'
import type { GrandPrix, GpEntry } from './history'

/** One GP two specific players both raced in. */
export interface Meeting {
  grandPrixId: string
  playedAt: string
  /** Field size, which is what scales the pairwise Elo exchange. */
  fieldSize: number
  points: number
  opponentPoints: number
  /** How much of this GP's rating change came from this opponent, unrounded. */
  eloSwing: number
}

/** One player's record against one opponent, across every GP they shared. */
export interface OpponentRecord {
  opponentId: string
  opponentName: string
  meetings: Meeting[]
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  /** Cumulative Elo taken off this opponent (negative: given to them). */
  netElo: number
}

export interface StreakInfo {
  /** Consecutive GP wins ending at this player's most recent GP. */
  current: number
  /** Longest run of GP wins ever. */
  longest: number
}

export interface PlayerBests {
  gpCount: number
  currentElo: number
  peakElo: number
  peakEloAt: string | null
  /** True when the player's rating is sitting at its all-time high right now. */
  atPeakNow: boolean
  bestPoints: number
  bestPointsAt: string | null
  worstPoints: number
  wins: number
}

/** Grand prix this player raced in, oldest first. */
export function gpsFor(history: GrandPrix[], playerId: string): GrandPrix[] {
  return history.filter((gp) => gp.entries.some((e) => e.playerId === playerId))
}

export function entryFor(gp: GrandPrix, playerId: string): GpEntry | undefined {
  return gp.entries.find((e) => e.playerId === playerId)
}

/**
 * How many GPs each player had already raced going into each GP. That count is
 * what set their K factor at the time, so reproducing a historical pairwise
 * Elo exchange needs it — a player's first GPs moved their rating further than
 * their later ones (see `kFactorFor`).
 */
function gpCountsBefore(history: GrandPrix[]): Map<string, Map<string, number>> {
  const byGp = new Map<string, Map<string, number>>()
  const running = new Map<string, number>()

  for (const gp of history) {
    const counts = new Map<string, number>()
    for (const entry of gp.entries) {
      counts.set(entry.playerId, running.get(entry.playerId) ?? 0)
    }
    byGp.set(gp.id, counts)
    for (const entry of gp.entries) {
      running.set(entry.playerId, (running.get(entry.playerId) ?? 0) + 1)
    }
  }

  return byGp
}

/**
 * This player's record against every opponent they have ever shared a GP with,
 * most-played first. Powers both the head-to-head page and the rival line on a
 * profile.
 *
 * `netElo` is the pairwise share of the rating each took off the other, not the
 * difference in their total GP deltas — out-scoring one opponent while the rest
 * of the field beats you both still counts as Elo taken off them.
 */
export function opponentRecords(history: GrandPrix[], playerId: string): OpponentRecord[] {
  const counts = gpCountsBefore(history)
  const records = new Map<string, OpponentRecord>()

  for (const gp of history) {
    const me = entryFor(gp, playerId)
    if (!me) continue

    const gpCount = counts.get(gp.id)?.get(playerId) ?? 0

    for (const other of gp.entries) {
      if (other.playerId === playerId) continue

      const record = records.get(other.playerId) ?? {
        opponentId: other.playerId,
        opponentName: other.playerName,
        meetings: [],
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        netElo: 0,
      }

      const eloSwing = pairwiseEloExchange(
        { rating: me.eloBefore, points: me.points, gpCount },
        { rating: other.eloBefore, points: other.points },
        gp.entries.length,
      )

      record.opponentName = other.playerName
      record.meetings.push({
        grandPrixId: gp.id,
        playedAt: gp.playedAt,
        fieldSize: gp.entries.length,
        points: me.points,
        opponentPoints: other.points,
        eloSwing,
      })
      if (me.points > other.points) record.wins += 1
      else if (me.points < other.points) record.losses += 1
      else record.ties += 1
      record.pointsFor += me.points
      record.pointsAgainst += other.points
      record.netElo += eloSwing

      records.set(other.playerId, record)
    }
  }

  // Rounded once at the end, after summing every GP: rounding each meeting
  // first would drift by up to half a point per GP played.
  return [...records.values()]
    .map((record) => ({ ...record, netElo: Math.round(record.netElo) }))
    .sort(
      (a, b) =>
        b.meetings.length - a.meetings.length || a.opponentName.localeCompare(b.opponentName),
    )
}

/** The two players' record against each other, or null if they've never met. */
export function headToHead(
  history: GrandPrix[],
  playerId: string,
  opponentId: string,
): OpponentRecord | null {
  if (playerId === opponentId) return null
  return opponentRecords(history, playerId).find((r) => r.opponentId === opponentId) ?? null
}

/**
 * The opponent this player has swung the most Elo against, in either direction
 * — the racer their rating is most entangled with. Ties broken by GPs shared.
 */
export function rivalOf(history: GrandPrix[], playerId: string): OpponentRecord | null {
  const records = opponentRecords(history, playerId)
  if (records.length === 0) return null

  return records.reduce((best, record) => {
    const gap = Math.abs(record.netElo) - Math.abs(best.netElo)
    if (gap > 0) return record
    if (gap === 0 && record.meetings.length > best.meetings.length) return record
    return best
  })
}

/**
 * Win streaks, where a win is finishing first in a GP. A shared first place
 * counts as a win for everyone tied at the top — nobody out-scored them.
 */
export function streaksFor(history: GrandPrix[], playerId: string): StreakInfo {
  let current = 0
  let longest = 0

  for (const gp of gpsFor(history, playerId)) {
    if (entryFor(gp, playerId)?.rank === 1) {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }

  return { current, longest }
}

/** How many of a player's most recent GPs count toward their "form" figure. */
export const FORM_WINDOW = 5

/**
 * Elo gained (or lost) across a player's last `window` GPs — "who's hot right
 * now" next to the all-time rating on the Leaderboard, as opposed to the
 * rating itself, which never forgets. Fewer than `window` GPs played sums
 * whatever they've got.
 */
export function recentForm(
  history: GrandPrix[],
  playerId: string,
  window: number = FORM_WINDOW,
): number {
  const gps = gpsFor(history, playerId).slice(-window)
  return gps.reduce((sum, gp) => sum + (entryFor(gp, playerId)?.eloDelta ?? 0), 0)
}

/**
 * Peak rating, best and worst GP, and whether this player is at their all-time
 * high right now.
 *
 * The baseline is the rating they carried into their first GP, so a player who
 * has only ever lost ground reads as below their peak rather than at it.
 */
export function playerBests(history: GrandPrix[], playerId: string): PlayerBests | null {
  const gps = gpsFor(history, playerId)
  if (gps.length === 0) return null

  const entries = gps.map((gp) => ({ gp, entry: entryFor(gp, playerId)! }))
  const currentElo = entries[entries.length - 1].entry.eloAfter

  let peakElo = entries[0].entry.eloBefore
  let peakEloAt: string | null = null
  let bestPoints = entries[0].entry.points
  let bestPointsAt = entries[0].gp.playedAt
  let worstPoints = entries[0].entry.points
  let wins = 0

  for (const { gp, entry } of entries) {
    if (entry.eloAfter > peakElo) {
      peakElo = entry.eloAfter
      peakEloAt = gp.playedAt
    }
    if (entry.points > bestPoints) {
      bestPoints = entry.points
      bestPointsAt = gp.playedAt
    }
    if (entry.points < worstPoints) worstPoints = entry.points
    if (entry.rank === 1) wins += 1
  }

  return {
    gpCount: gps.length,
    currentElo,
    peakElo,
    peakEloAt,
    atPeakNow: currentElo >= peakElo,
    bestPoints,
    bestPointsAt,
    worstPoints,
    wins,
  }
}

/**
 * Whose rating is sitting at its all-time high right now, by player id. Same
 * rule as `playerBests().atPeakNow`, computed for the whole field in one pass
 * so the leaderboard can flag peaks without a per-player scan.
 */
export function playersAtPeak(history: GrandPrix[]): Set<string> {
  const peaks = new Map<string, number>()
  const current = new Map<string, number>()

  for (const gp of history) {
    for (const entry of gp.entries) {
      const seen = peaks.get(entry.playerId) ?? entry.eloBefore
      peaks.set(entry.playerId, Math.max(seen, entry.eloAfter))
      current.set(entry.playerId, entry.eloAfter)
    }
  }

  const atPeak = new Set<string>()
  for (const [playerId, elo] of current) {
    if (elo >= (peaks.get(playerId) ?? elo)) atPeak.add(playerId)
  }

  return atPeak
}

/**
 * Expected-score ceiling for counting a win as an upset: 0.25 means the
 * winner was no better than a 3:1 underdog per pre-GP ratings. `expectedScore`
 * already turns two ratings into odds; this just names the cutoff.
 */
export const UPSET_EXPECTED_THRESHOLD = 0.25

export interface Upset {
  opponentId: string
  opponentName: string
  /** The winner's win probability against that opponent, per pre-GP ratings. */
  expected: number
}

/**
 * The most lopsided opponent this player beat in this GP by points, or null
 * if they didn't beat anyone they weren't expected to. "Beat" means
 * out-scored, same as everywhere else in this file — not finishing position.
 */
function biggestUpsetIn(gp: GrandPrix, playerId: string): Upset | null {
  const me = entryFor(gp, playerId)
  if (!me) return null

  let best: Upset | null = null
  for (const other of gp.entries) {
    if (other.playerId === playerId || me.points <= other.points) continue
    const expected = expectedScore(me.eloBefore, other.eloBefore)
    if (expected <= UPSET_EXPECTED_THRESHOLD && (!best || expected < best.expected)) {
      best = { opponentId: other.playerId, opponentName: other.playerName, expected }
    }
  }
  return best
}

export interface RecapEntry extends GpEntry {
  /** This GP put the player at a rating they have never been above. */
  peakElo: boolean
  /** Their highest points total ever — needs at least one earlier GP. */
  bestPoints: boolean
  /** Their lowest points total ever — needs at least one earlier GP. */
  worstPoints: boolean
  /** Their very first grand prix. */
  debut: boolean
  /** The most lopsided opponent they beat this GP by points, if any. */
  upset: Upset | null
}

export interface Recap {
  grandPrix: GrandPrix
  /** Finishing order, winner first. */
  entries: RecapEntry[]
  biggestGainer: RecapEntry
  biggestLoser: RecapEntry
  /** Whoever pulled the least likely win of the night, if anyone did. */
  biggestUpset: RecapEntry | null
}

/**
 * The story of one grand prix: who moved the most, and which of its results
 * were the best or worst that player has ever managed.
 *
 * Everything is judged against that player's GPs *before* this one, so the
 * recap reads the way it did on the night — a later GP can't retroactively
 * demote a record this one set.
 */
export function buildRecap(history: GrandPrix[], grandPrixId: string): Recap | null {
  const index = history.findIndex((gp) => gp.id === grandPrixId)
  if (index === -1) return null

  const grandPrix = history[index]
  const earlier = history.slice(0, index)

  const entries: RecapEntry[] = grandPrix.entries.map((entry) => {
    const priorEntries = earlier
      .map((gp) => entryFor(gp, entry.playerId))
      .filter((e): e is GpEntry => e !== undefined)

    const priorPeak = priorEntries.reduce(
      (peak, e) => Math.max(peak, e.eloAfter),
      priorEntries.length > 0 ? priorEntries[0].eloBefore : entry.eloBefore,
    )

    return {
      ...entry,
      peakElo: entry.eloAfter > priorPeak,
      bestPoints: priorEntries.length > 0 && priorEntries.every((e) => entry.points > e.points),
      worstPoints: priorEntries.length > 0 && priorEntries.every((e) => entry.points < e.points),
      debut: priorEntries.length === 0,
      upset: biggestUpsetIn(grandPrix, entry.playerId),
    }
  })

  const byDelta = [...entries].sort((a, b) => b.eloDelta - a.eloDelta)
  const upsets = entries.filter((e) => e.upset !== null)
  const biggestUpset =
    upsets.length > 0
      ? upsets.reduce((best, e) => (e.upset!.expected < best.upset!.expected ? e : best))
      : null

  return {
    grandPrix,
    entries,
    biggestGainer: byDelta[0],
    biggestLoser: byDelta[byDelta.length - 1],
    biggestUpset,
  }
}

/** A player needs at least this many GPs before a consistency figure means anything. */
export const CONSISTENCY_MIN_GPS = 3

export interface ConsistencyInfo {
  gpCount: number
  /** Population standard deviation of points across every GP this player has entered. Lower is steadier. */
  stdDev: number
}

/** How steady a player's points totals have been. Null if they've never raced. */
export function pointsConsistency(history: GrandPrix[], playerId: string): ConsistencyInfo | null {
  const gps = gpsFor(history, playerId)
  if (gps.length === 0) return null

  const points = gps.map((gp) => entryFor(gp, playerId)!.points)
  const mean = points.reduce((sum, p) => sum + p, 0) / points.length
  const variance = points.reduce((sum, p) => sum + (p - mean) ** 2, 0) / points.length

  return { gpCount: points.length, stdDev: Math.sqrt(variance) }
}

export interface ConsistencyRanking {
  playerId: string
  playerName: string
  stdDev: number
}

/**
 * Every eligible player (at least `minGps`), steadiest first. The two ends of
 * this list are the "most consistent" / "most volatile" chips on a profile.
 */
export function consistencyRankings(
  history: GrandPrix[],
  minGps: number = CONSISTENCY_MIN_GPS,
): ConsistencyRanking[] {
  return rosterFromHistory(history)
    .map((p) => {
      const info = pointsConsistency(history, p.id)
      return info && info.gpCount >= minGps
        ? { playerId: p.id, playerName: p.name, stdDev: info.stdDev }
        : null
    })
    .filter((r): r is ConsistencyRanking => r !== null)
    .sort((a, b) => a.stdDev - b.stdDev)
}

/** A player who hasn't played in this many days shows as drifted. */
export const ATTENDANCE_DRIFT_DAYS = 14

export interface AttendanceInfo {
  playerId: string
  playerName: string
  lastPlayedAt: string
  daysSinceLastPlayed: number
  gpsThisMonth: number
  drifted: boolean
}

/**
 * Last-seen date and this-month GP count for every player who has ever
 * raced, most recently active first — off `played_at` alone, so it needs no
 * new table. Answers "who are we missing tonight".
 */
export function attendance(history: GrandPrix[], now: Date = new Date()): AttendanceInfo[] {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return rosterFromHistory(history)
    .map((p) => {
      const gps = gpsFor(history, p.id)
      const lastPlayedAt = gps[gps.length - 1].playedAt
      const daysSinceLastPlayed = Math.floor(
        (now.getTime() - new Date(lastPlayedAt).getTime()) / (1000 * 60 * 60 * 24),
      )
      const gpsThisMonth = gps.filter((gp) => gp.playedAt.slice(0, 7) === monthKey).length

      return {
        playerId: p.id,
        playerName: p.name,
        lastPlayedAt,
        daysSinceLastPlayed,
        gpsThisMonth,
        drifted: daysSinceLastPlayed >= ATTENDANCE_DRIFT_DAYS,
      }
    })
    .sort((a, b) => a.daysSinceLastPlayed - b.daysSinceLastPlayed)
}

export interface GpRecord {
  grandPrixId: string
  playedAt: string
  playerId: string
  playerName: string
  value: number
}

export interface SpreadRecord {
  grandPrixId: string
  playedAt: string
  spread: number
}

export interface StreakRecord {
  playerId: string
  playerName: string
  length: number
}

export interface UpsetRecord {
  grandPrixId: string
  playedAt: string
  playerId: string
  playerName: string
  opponentName: string
  /** The upset winner's win probability per pre-GP ratings — lower is a bigger upset. */
  expected: number
}

export interface NightRecord {
  /** Calendar date the GPs were played on, e.g. "2026-08-25" — UTC, not local. */
  date: string
  count: number
}

export interface RecordsBook {
  highestPoints: GpRecord | null
  worstPoints: GpRecord | null
  biggestSwing: GpRecord | null
  longestStreak: StreakRecord | null
  biggestUpset: UpsetRecord | null
  closestGp: SpreadRecord | null
  biggestBlowout: SpreadRecord | null
  biggestNight: NightRecord | null
}

/**
 * All-time superlatives, one scan over the whole history. Every field is a
 * plain reduce — `gp_results` already has everything, so none of this needs a
 * new table.
 *
 * "Biggest night" groups by calendar date alone, not the gap-based session
 * grouping PLAN.md's Sessions feature would add — a good enough stand-in until
 * that exists, and harmless once it does (real sessions would only ever merge
 * counts this already tracks separately).
 */
export function buildRecordsBook(history: GrandPrix[]): RecordsBook {
  let highestPoints: GpRecord | null = null
  let worstPoints: GpRecord | null = null
  let biggestSwing: GpRecord | null = null
  let biggestUpset: UpsetRecord | null = null
  let closestGp: SpreadRecord | null = null
  let biggestBlowout: SpreadRecord | null = null
  const nightCounts = new Map<string, number>()

  for (const gp of history) {
    const date = gp.playedAt.slice(0, 10)
    nightCounts.set(date, (nightCounts.get(date) ?? 0) + 1)

    // Entries are already sorted highest points first (groupIntoGrandPrix).
    const spread = gp.entries[0].points - gp.entries[gp.entries.length - 1].points
    if (!closestGp || spread < closestGp.spread) {
      closestGp = { grandPrixId: gp.id, playedAt: gp.playedAt, spread }
    }
    if (!biggestBlowout || spread > biggestBlowout.spread) {
      biggestBlowout = { grandPrixId: gp.id, playedAt: gp.playedAt, spread }
    }

    for (const entry of gp.entries) {
      if (!highestPoints || entry.points > highestPoints.value) {
        highestPoints = {
          grandPrixId: gp.id,
          playedAt: gp.playedAt,
          playerId: entry.playerId,
          playerName: entry.playerName,
          value: entry.points,
        }
      }
      if (!worstPoints || entry.points < worstPoints.value) {
        worstPoints = {
          grandPrixId: gp.id,
          playedAt: gp.playedAt,
          playerId: entry.playerId,
          playerName: entry.playerName,
          value: entry.points,
        }
      }
      if (!biggestSwing || Math.abs(entry.eloDelta) > Math.abs(biggestSwing.value)) {
        biggestSwing = {
          grandPrixId: gp.id,
          playedAt: gp.playedAt,
          playerId: entry.playerId,
          playerName: entry.playerName,
          value: entry.eloDelta,
        }
      }

      const upset = biggestUpsetIn(gp, entry.playerId)
      if (upset && (!biggestUpset || upset.expected < biggestUpset.expected)) {
        biggestUpset = {
          grandPrixId: gp.id,
          playedAt: gp.playedAt,
          playerId: entry.playerId,
          playerName: entry.playerName,
          opponentName: upset.opponentName,
          expected: upset.expected,
        }
      }
    }
  }

  let longestStreak: StreakRecord | null = null
  for (const p of rosterFromHistory(history)) {
    const { longest } = streaksFor(history, p.id)
    if (!longestStreak || longest > longestStreak.length) {
      longestStreak = { playerId: p.id, playerName: p.name, length: longest }
    }
  }

  let biggestNight: NightRecord | null = null
  for (const [date, count] of nightCounts) {
    if (!biggestNight || count > biggestNight.count) biggestNight = { date, count }
  }

  return {
    highestPoints,
    worstPoints,
    biggestSwing,
    longestStreak,
    biggestUpset,
    closestGp,
    biggestBlowout,
    biggestNight,
  }
}

/** A gap this long since the previous grand prix starts a new session. */
export const SESSION_GAP_HOURS = 5

export interface SessionStanding {
  playerId: string
  playerName: string
  totalPoints: number
  /** Sum of this session's eloDelta across every GP the player was in. */
  netEloDelta: number
  gpCount: number
  rank: number
}

export interface Session {
  /** The first GP's id in this session — stable enough to link to, since a session is recomputed fresh from history every time. */
  id: string
  startedAt: string
  endedAt: string
  gps: GrandPrix[]
  /** Highest total points first. */
  standings: SessionStanding[]
}

/**
 * Groups grand prix into game nights, oldest first: a new session starts
 * whenever the gap since the previous GP exceeds `gapHours`. Pure grouping
 * over `played_at` — nothing new is stored, and nothing here touches rating,
 * since Elo is already exact per-GP regardless of how GPs are grouped for
 * display.
 */
export function sessionsFromHistory(
  history: GrandPrix[],
  gapHours: number = SESSION_GAP_HOURS,
): Session[] {
  const gapMs = gapHours * 60 * 60 * 1000
  const groups: GrandPrix[][] = []

  for (const gp of history) {
    const current = groups[groups.length - 1]
    const previous = current?.[current.length - 1]
    const gap = previous
      ? new Date(gp.playedAt).getTime() - new Date(previous.playedAt).getTime()
      : Infinity

    if (!current || gap > gapMs) groups.push([gp])
    else current.push(gp)
  }

  return groups.map((gps) => {
    const totals = new Map<
      string,
      { name: string; points: number; elo: number; gpCount: number }
    >()

    for (const gp of gps) {
      for (const entry of gp.entries) {
        const row = totals.get(entry.playerId) ?? {
          name: entry.playerName,
          points: 0,
          elo: 0,
          gpCount: 0,
        }
        row.points += entry.points
        row.elo += entry.eloDelta
        row.gpCount += 1
        totals.set(entry.playerId, row)
      }
    }

    const standings = [...totals.entries()]
      .map(([playerId, row]) => ({
        playerId,
        playerName: row.name,
        totalPoints: row.points,
        netEloDelta: Math.round(row.elo),
        gpCount: row.gpCount,
        rank: 0,
      }))
      .sort(
        (a, b) => b.totalPoints - a.totalPoints || a.playerName.localeCompare(b.playerName),
      )

    let lastPoints: number | null = null
    let lastRank = 0
    standings.forEach((standing, index) => {
      if (standing.totalPoints !== lastPoints) {
        lastRank = index + 1
        lastPoints = standing.totalPoints
      }
      standing.rank = lastRank
    })

    return {
      id: gps[0].id,
      startedAt: gps[0].playedAt,
      endedAt: gps[gps.length - 1].playedAt,
      gps,
      standings,
    }
  })
}

/**
 * A time window over the history, for the selector threaded through the
 * Leaderboard, Analytics and profiles. Deliberately does not window
 * *rating* — Elo is path-dependent, so "rating over the last 10 GPs" isn't a
 * filter, it's a recomputation from a reset (see `replayHistory` in
 * `replay.ts`). Windows here only ever restrict which GPs a points-or-record
 * stat is computed over; the rating itself stays whatever it actually is.
 */
export type StatsWindow =
  | { kind: 'all' }
  | { kind: 'lastN'; n: number }
  | { kind: 'days'; days: number }
  /** Stands in for "this season" — there's no season concept in the schema, so this is calendar-year-to-date. */
  | { kind: 'year' }

export const WINDOW_OPTIONS: { label: string; window: StatsWindow }[] = [
  { label: 'All-time', window: { kind: 'all' } },
  { label: 'Last 10 GPs', window: { kind: 'lastN', n: 10 } },
  { label: 'Last 30 days', window: { kind: 'days', days: 30 } },
  { label: 'This year', window: { kind: 'year' } },
]

function windowCutoffMs(window: StatsWindow, now: Date): number | null {
  if (window.kind === 'days') return now.getTime() - window.days * 24 * 60 * 60 * 1000
  if (window.kind === 'year') return Date.UTC(now.getFullYear(), 0, 1)
  return null
}

/** Restricts a whole-roster history to a window — for views that chart or rank everyone at once, like Analytics. */
export function windowHistory(
  history: GrandPrix[],
  window: StatsWindow,
  now: Date = new Date(),
): GrandPrix[] {
  if (window.kind === 'all') return history
  if (window.kind === 'lastN') return history.slice(-window.n)
  const cutoff = windowCutoffMs(window, now)!
  return history.filter((gp) => new Date(gp.playedAt).getTime() >= cutoff)
}

/**
 * Restricts one player's own grand prix to a window. "Last 10 GPs" means
 * *their* last 10, not the field's last 10 — windowing by `windowHistory`
 * first would leave a player who skipped a few nights with an empty or
 * near-empty window even though they've raced plenty recently.
 */
export function windowGpsFor(
  history: GrandPrix[],
  playerId: string,
  window: StatsWindow,
  now: Date = new Date(),
): GrandPrix[] {
  const gps = gpsFor(history, playerId)
  if (window.kind === 'all') return gps
  if (window.kind === 'lastN') return gps.slice(-window.n)
  const cutoff = windowCutoffMs(window, now)!
  return gps.filter((gp) => new Date(gp.playedAt).getTime() >= cutoff)
}

/** Points total that earns the "Clutch" achievement — a near-sweep of every race. */
export const ACHIEVEMENT_POINTS_THRESHOLD = 55
/** GP count that earns the "Regular" achievement. */
export const ACHIEVEMENT_GP_MILESTONE = 10

export interface Achievement {
  id: string
  label: string
  description: string
  /** When it was first earned, or null if it never has been. */
  unlockedAt: string | null
}

/**
 * Derived milestones for one player's profile. Nothing stored — every
 * achievement is a scan over `history`, recomputed the same way `playerBests`
 * is, so retuning a threshold or adding a new one needs no migration.
 */
export function achievementsFor(history: GrandPrix[], playerId: string): Achievement[] {
  const gps = gpsFor(history, playerId)

  let firstWinAt: string | null = null
  let bigScoreAt: string | null = null
  let giantSlayerAt: string | null = null

  // Tracks each player's most recent known rating as we walk the history, so
  // "the highest-rated player" means the whole roster's current #1 at that
  // point in time, not just whoever else was in this particular GP.
  const currentElo = new Map<string, number>()
  for (const gp of history) {
    let topId: string | null = null
    let topElo = -Infinity
    for (const [id, elo] of currentElo) {
      if (elo > topElo) {
        topElo = elo
        topId = id
      }
    }

    const me = entryFor(gp, playerId)
    if (me) {
      if (!firstWinAt && me.rank === 1) firstWinAt = gp.playedAt
      if (!bigScoreAt && me.points >= ACHIEVEMENT_POINTS_THRESHOLD) bigScoreAt = gp.playedAt
      if (!giantSlayerAt && topId && topId !== playerId) {
        const top = entryFor(gp, topId)
        if (top && me.points > top.points) giantSlayerAt = gp.playedAt
      }
    }

    for (const entry of gp.entries) currentElo.set(entry.playerId, entry.eloAfter)
  }

  const milestoneAt =
    gps.length >= ACHIEVEMENT_GP_MILESTONE ? gps[ACHIEVEMENT_GP_MILESTONE - 1].playedAt : null

  let sweepAt: string | null = null
  for (const session of sessionsFromHistory(history)) {
    if (session.gps.length < 2) continue
    const played = session.gps.filter((gp) => entryFor(gp, playerId))
    if (played.length !== session.gps.length) continue
    if (played.every((gp) => entryFor(gp, playerId)!.rank === 1)) {
      sweepAt = session.endedAt
      break
    }
  }

  return [
    {
      id: 'first-win',
      label: 'First win',
      description: 'Finish first in a grand prix.',
      unlockedAt: firstWinAt,
    },
    {
      id: 'regular',
      label: 'Regular',
      description: `Race in ${ACHIEVEMENT_GP_MILESTONE} grand prix.`,
      unlockedAt: milestoneAt,
    },
    {
      id: 'giant-slayer',
      label: 'Giant slayer',
      description: 'Out-score the single highest-rated racer in the whole roster, in a grand prix they were both in.',
      unlockedAt: giantSlayerAt,
    },
    {
      id: 'clutch',
      label: 'Clutch',
      description: `Score ${ACHIEVEMENT_POINTS_THRESHOLD}+ points in a single grand prix.`,
      unlockedAt: bigScoreAt,
    },
    {
      id: 'sweep',
      label: 'Swept the night',
      description: 'Win every grand prix in a session of at least two.',
      unlockedAt: sweepAt,
    },
  ]
}
