// Derived stats over the result history: head-to-head records, streaks,
// rivals, personal bests, and the post-submission recap.
//
// Everything here is a pure function of `GrandPrix[]` (oldest first) so it can
// be unit-tested without a database — see `stats.test.ts`. Nothing here needs
// a new table: `gp_results` already stores each player's points and the exact
// rating they carried into and out of every GP.

import { pairwiseEloExchange } from './elo'
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

export interface RecapEntry extends GpEntry {
  /** This GP put the player at a rating they have never been above. */
  peakElo: boolean
  /** Their highest points total ever — needs at least one earlier GP. */
  bestPoints: boolean
  /** Their lowest points total ever — needs at least one earlier GP. */
  worstPoints: boolean
  /** Their very first grand prix. */
  debut: boolean
}

export interface Recap {
  grandPrix: GrandPrix
  /** Finishing order, winner first. */
  entries: RecapEntry[]
  biggestGainer: RecapEntry
  biggestLoser: RecapEntry
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
    }
  })

  const byDelta = [...entries].sort((a, b) => b.eloDelta - a.eloDelta)

  return {
    grandPrix,
    entries,
    biggestGainer: byDelta[0],
    biggestLoser: byDelta[byDelta.length - 1],
  }
}
