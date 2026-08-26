import { describe, expect, it } from 'vitest'
import { computeGpElo, STARTING_ELO } from './elo'
import { groupIntoGrandPrix, type GrandPrix } from './history'
import {
  achievementsFor,
  attendance,
  buildRecap,
  buildRecordsBook,
  consistencyRankings,
  headToHead,
  opponentRecords,
  playerBests,
  playersAtPeak,
  pointsConsistency,
  recentForm,
  rivalOf,
  sessionsFromHistory,
  streaksFor,
  windowGpsFor,
  windowHistory,
} from './stats'

interface GpSpec {
  /** [playerId, points] — everyone starts at STARTING_ELO, as the schema does. */
  field: [string, number][]
}

/**
 * Builds history the same shape `loadHistory` produces, by replaying the real
 * Elo algorithm GP by GP — carrying each player's rating forward and counting
 * their GPs as they go, exactly as `submit_gp` does. That matters: the pairwise
 * stats re-derive each player's K factor from how many GPs they had played at
 * the time, so a fixture that faked those counts would be testing against
 * numbers the app never stored.
 */
function makeHistory(specs: GpSpec[]): GrandPrix[] {
  const ratings = new Map<string, number>()
  const gpCounts = new Map<string, number>()

  const rows = specs.flatMap((spec, index) => {
    const participants = spec.field.map(([playerId, points]) => ({
      playerId,
      points,
      rating: ratings.get(playerId) ?? STARTING_ELO,
      gpCount: gpCounts.get(playerId) ?? 0,
    }))
    const updates = computeGpElo(participants)

    for (const update of updates) {
      ratings.set(update.playerId, update.eloAfter)
      gpCounts.set(update.playerId, (gpCounts.get(update.playerId) ?? 0) + 1)
    }

    return participants.map((p, i) => ({
      grand_prix_id: `gp-${index + 1}`,
      player_id: p.playerId,
      points: p.points,
      elo_before: updates[i].eloBefore,
      elo_after: updates[i].eloAfter,
      elo_delta: updates[i].eloDelta,
      // Ascending, one day apart, so the ordering is unambiguous.
      grand_prix: { played_at: `2026-01-${String(index + 1).padStart(2, '0')}T20:00:00Z` },
      players: { name: p.playerId.toUpperCase() },
    }))
  })

  return groupIntoGrandPrix(rows)
}

/**
 * Same replay as `makeHistory`, but each GP takes an explicit `playedAt`
 * instead of one auto-incrementing day apart — needed for session tests,
 * where whether two GPs are close enough in time to share a session is
 * exactly what's under test.
 */
function makeHistoryAt(specs: { field: [string, number][]; playedAt: string }[]): GrandPrix[] {
  const ratings = new Map<string, number>()
  const gpCounts = new Map<string, number>()

  const rows = specs.flatMap((spec, index) => {
    const participants = spec.field.map(([playerId, points]) => ({
      playerId,
      points,
      rating: ratings.get(playerId) ?? STARTING_ELO,
      gpCount: gpCounts.get(playerId) ?? 0,
    }))
    const updates = computeGpElo(participants)

    for (const update of updates) {
      ratings.set(update.playerId, update.eloAfter)
      gpCounts.set(update.playerId, (gpCounts.get(update.playerId) ?? 0) + 1)
    }

    return participants.map((p, i) => ({
      grand_prix_id: `gp-${index + 1}`,
      player_id: p.playerId,
      points: p.points,
      elo_before: updates[i].eloBefore,
      elo_after: updates[i].eloAfter,
      elo_delta: updates[i].eloDelta,
      grand_prix: { played_at: spec.playedAt },
      players: { name: p.playerId.toUpperCase() },
    }))
  })

  return groupIntoGrandPrix(rows)
}

describe('groupIntoGrandPrix', () => {
  it('orders grand prix oldest first and entries by points, highest first', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['a', 10], ['b', 50]] },
    ])

    expect(history.map((gp) => gp.id)).toEqual(['gp-1', 'gp-2'])
    expect(history[0].entries.map((e) => e.playerId)).toEqual(['a', 'b'])
    expect(history[1].entries.map((e) => e.playerId)).toEqual(['b', 'a'])
  })

  it('gives tied players the same place and skips the next one', () => {
    const history = makeHistory([{ field: [['a', 40], ['b', 40], ['c', 10]] }])
    const ranks = Object.fromEntries(history[0].entries.map((e) => [e.playerId, e.rank]))
    expect(ranks).toEqual({ a: 1, b: 1, c: 3 })
  })

  it('drops rows whose grand prix has no timestamp', () => {
    expect(
      groupIntoGrandPrix([
        {
          grand_prix_id: 'gp-1',
          player_id: 'a',
          points: 40,
          elo_before: 1500,
          elo_after: 1510,
          elo_delta: 10,
          grand_prix: null,
          players: { name: 'A' },
        },
      ] as never),
    ).toEqual([])
  })
})

describe('headToHead', () => {
  it('counts each GP the pair both raced, and only those', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['a', 40], ['c', 20]] },
      { field: [['a', 20], ['b', 40], ['c', 30]] },
    ])

    const record = headToHead(history, 'a', 'b')!
    expect(record.meetings).toHaveLength(2)
    expect(record.wins).toBe(1)
    expect(record.losses).toBe(1)
    expect(record.ties).toBe(0)
  })

  it('is null for a pair who have never shared a grand prix', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['c', 40], ['d', 20]] },
    ])
    expect(headToHead(history, 'a', 'c')).toBeNull()
  })

  it('is null for a player against themselves', () => {
    const history = makeHistory([{ field: [['a', 40], ['b', 20]] }])
    expect(headToHead(history, 'a', 'a')).toBeNull()
  })

  it('mirrors: what one player takes off the other, the other loses', () => {
    const history = makeHistory([
      { field: [['a', 50], ['b', 20], ['c', 30]] },
      { field: [['a', 10], ['b', 40], ['c', 25]] },
    ])

    const ab = headToHead(history, 'a', 'b')!
    const ba = headToHead(history, 'b', 'a')!
    expect(ab.netElo).toBe(-ba.netElo)
    expect(ab.wins).toBe(ba.losses)
    expect(ab.pointsFor).toBe(ba.pointsAgainst)
  })

  it('is the pairwise share, not the difference in total GP deltas', () => {
    // b out-scores c but both are buried by a: b still takes Elo off c.
    const history = makeHistory([{ field: [['a', 60], ['b', 30], ['c', 20]] }])

    const bc = headToHead(history, 'b', 'c')!
    expect(bc.netElo).toBeGreaterThan(0)

    const gp = history[0]
    const deltaB = gp.entries.find((e) => e.playerId === 'b')!.eloDelta
    const deltaC = gp.entries.find((e) => e.playerId === 'c')!.eloDelta
    expect(deltaB).toBeLessThan(0)
    expect(deltaC).toBeLessThan(0)
  })

  it("sums a player's pairwise swings back to their GP delta", () => {
    const history = makeHistory([{ field: [['a', 60], ['b', 30], ['c', 20], ['d', 8]] }])

    const swings = opponentRecords(history, 'a').flatMap((r) =>
      r.meetings.map((m) => m.eloSwing),
    )
    const total = swings.reduce((sum, swing) => sum + swing, 0)
    const stored = history[0].entries.find((e) => e.playerId === 'a')!.eloDelta

    expect(Math.round(total)).toBe(stored)
  })

  it('counts equal points as a tie for both', () => {
    const history = makeHistory([{ field: [['a', 30], ['b', 30]] }])
    const record = headToHead(history, 'a', 'b')!
    expect(record.ties).toBe(1)
    expect(record.wins).toBe(0)
    expect(record.losses).toBe(0)
  })
})

describe('opponentRecords', () => {
  it('lists every opponent, most-played first', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['a', 40], ['b', 20], ['c', 10]] },
    ])

    const records = opponentRecords(history, 'a')
    expect(records.map((r) => r.opponentId)).toEqual(['b', 'c'])
    expect(records[0].meetings).toHaveLength(2)
  })

  it('is empty for a player with no history', () => {
    expect(opponentRecords(makeHistory([{ field: [['a', 40], ['b', 20]] }]), 'nobody')).toEqual([])
  })
})

describe('rivalOf', () => {
  it('picks the opponent with the biggest Elo swing either way', () => {
    const history = makeHistory([
      // a beats b decisively three times, and barely edges c once.
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 31], ['c', 30]] },
    ])

    expect(rivalOf(history, 'a')?.opponentId).toBe('b')
  })

  it('is null for a player who has never raced', () => {
    expect(rivalOf(makeHistory([{ field: [['a', 40], ['b', 20]] }]), 'nobody')).toBeNull()
  })
})

describe('streaksFor', () => {
  it('counts a run of wins ending at the most recent GP', () => {
    const history = makeHistory([
      { field: [['a', 10], ['b', 40]] },
      { field: [['a', 40], ['b', 10]] },
      { field: [['a', 40], ['b', 10]] },
    ])

    expect(streaksFor(history, 'a')).toEqual({ current: 2, longest: 2 })
  })

  it('resets the current streak on a loss but keeps the longest', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 10]] },
      { field: [['a', 40], ['b', 10]] },
      { field: [['a', 40], ['b', 10]] },
      { field: [['a', 10], ['b', 40]] },
    ])

    expect(streaksFor(history, 'a')).toEqual({ current: 0, longest: 3 })
  })

  it('ignores grand prix the player sat out', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 10]] },
      { field: [['b', 40], ['c', 10]] },
      { field: [['a', 40], ['b', 10]] },
    ])

    expect(streaksFor(history, 'a').current).toBe(2)
  })

  it('counts a shared first place as a win for everyone tied at the top', () => {
    const history = makeHistory([{ field: [['a', 40], ['b', 40], ['c', 10]] }])
    expect(streaksFor(history, 'a').current).toBe(1)
    expect(streaksFor(history, 'b').current).toBe(1)
    expect(streaksFor(history, 'c').current).toBe(0)
  })
})

describe('playerBests', () => {
  it('tracks peak rating, best GP, and worst GP', () => {
    const history = makeHistory([
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 20], ['b', 40]] },
    ])

    const bests = playerBests(history, 'a')!
    expect(bests.gpCount).toBe(2)
    expect(bests.bestPoints).toBe(60)
    expect(bests.worstPoints).toBe(20)
    expect(bests.wins).toBe(1)
    expect(bests.peakElo).toBe(history[0].entries.find((e) => e.playerId === 'a')!.eloAfter)
    expect(bests.atPeakNow).toBe(false)
  })

  it('flags a player who is at their all-time high right now', () => {
    const history = makeHistory([{ field: [['a', 60], ['b', 4]] }])
    expect(playerBests(history, 'a')!.atPeakNow).toBe(true)
    expect(playerBests(history, 'b')!.atPeakNow).toBe(false)
  })

  it('treats the rating carried into the first GP as the baseline peak', () => {
    // b has only ever lost ground, so their peak is where they started.
    const history = makeHistory([{ field: [['a', 60], ['b', 4]] }])
    const bests = playerBests(history, 'b')!
    expect(bests.peakElo).toBe(STARTING_ELO)
    expect(bests.peakEloAt).toBeNull()
  })

  it('is null for a player who has never raced', () => {
    expect(playerBests(makeHistory([{ field: [['a', 40], ['b', 20]] }]), 'nobody')).toBeNull()
  })
})

describe('playersAtPeak', () => {
  it('agrees with playerBests for everyone in the history', () => {
    const history = makeHistory([
      { field: [['a', 60], ['b', 20], ['c', 30]] },
      { field: [['a', 10], ['b', 50], ['c', 30]] },
      { field: [['a', 45], ['b', 20], ['c', 25]] },
    ])

    const atPeak = playersAtPeak(history)
    for (const playerId of ['a', 'b', 'c']) {
      expect(atPeak.has(playerId)).toBe(playerBests(history, playerId)!.atPeakNow)
    }
  })
})

describe('buildRecap', () => {
  it('names the biggest gainer and the biggest loser', () => {
    const history = makeHistory([{ field: [['a', 60], ['b', 30], ['c', 4]] }])
    const recap = buildRecap(history, 'gp-1')!

    expect(recap.biggestGainer.playerId).toBe('a')
    expect(recap.biggestLoser.playerId).toBe('c')
    expect(recap.entries.map((e) => e.playerId)).toEqual(['a', 'b', 'c'])
  })

  it('marks everyone in their first grand prix as a debut, with no records', () => {
    const history = makeHistory([{ field: [['a', 60], ['b', 4]] }])
    const recap = buildRecap(history, 'gp-1')!

    for (const entry of recap.entries) {
      expect(entry.debut).toBe(true)
      expect(entry.bestPoints).toBe(false)
      expect(entry.worstPoints).toBe(false)
    }
  })

  it('flags a personal-best points total and a new peak rating', () => {
    const history = makeHistory([
      { field: [['a', 30], ['b', 20]] },
      { field: [['a', 55], ['b', 20]] },
    ])
    const recap = buildRecap(history, 'gp-2')!
    const a = recap.entries.find((e) => e.playerId === 'a')!

    expect(a.bestPoints).toBe(true)
    expect(a.worstPoints).toBe(false)
    expect(a.peakElo).toBe(true)
    expect(a.debut).toBe(false)
  })

  it('flags a personal-worst points total', () => {
    const history = makeHistory([
      { field: [['a', 30], ['b', 20]] },
      { field: [['a', 8], ['b', 40]] },
    ])
    const a = buildRecap(history, 'gp-2')!.entries.find((e) => e.playerId === 'a')!

    expect(a.worstPoints).toBe(true)
    expect(a.bestPoints).toBe(false)
  })

  it('judges records against earlier GPs only, never later ones', () => {
    const history = makeHistory([
      { field: [['a', 30], ['b', 20]] },
      { field: [['a', 45], ['b', 20]] },
      { field: [['a', 60], ['b', 4]] },
    ])

    // GP 2 was a's best at the time, even though GP 3 later beat it.
    expect(buildRecap(history, 'gp-2')!.entries.find((e) => e.playerId === 'a')!.bestPoints).toBe(
      true,
    )
  })

  it('is null for a grand prix id that is not in the history', () => {
    expect(buildRecap(makeHistory([{ field: [['a', 40], ['b', 20]] }]), 'nope')).toBeNull()
  })

  it('flags an upset when a big underdog beats a big favorite', () => {
    const history = makeHistory([
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 60], ['b', 4]] },
      { field: [['b', 60], ['a', 4]] },
    ])
    const recap = buildRecap(history, 'gp-4')!
    const b = recap.entries.find((e) => e.playerId === 'b')!

    expect(b.upset).not.toBeNull()
    expect(b.upset!.opponentId).toBe('a')
    expect(recap.biggestUpset?.playerId).toBe('b')
  })

  it('does not flag a win as an upset when the winner was already favored', () => {
    const recap = buildRecap(makeHistory([{ field: [['a', 60], ['b', 4]] }]), 'gp-1')!
    expect(recap.entries.every((e) => e.upset === null)).toBe(true)
    expect(recap.biggestUpset).toBeNull()
  })
})

describe('recentForm', () => {
  it('sums Elo change over the last N GPs, not the full history', () => {
    const history = makeHistory([
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 4], ['b', 60]] },
    ])
    const lastTwoDeltas = history
      .slice(-2)
      .map((gp) => gp.entries.find((e) => e.playerId === 'a')!.eloDelta)

    expect(recentForm(history, 'a', 2)).toBe(lastTwoDeltas.reduce((sum, d) => sum + d, 0))
  })

  it('sums whatever is available when a player has fewer GPs than the window', () => {
    const history = makeHistory([{ field: [['a', 40], ['b', 20]] }])
    const delta = history[0].entries.find((e) => e.playerId === 'a')!.eloDelta
    expect(recentForm(history, 'a', 5)).toBe(delta)
  })

  it('is zero for a player with no history', () => {
    expect(recentForm(makeHistory([{ field: [['a', 40], ['b', 20]] }]), 'nobody')).toBe(0)
  })
})

describe('pointsConsistency', () => {
  it('is zero for a player who scores the same every GP', () => {
    const history = makeHistory([
      { field: [['a', 30], ['b', 20]] },
      { field: [['a', 30], ['b', 40]] },
      { field: [['a', 30], ['b', 10]] },
    ])
    expect(pointsConsistency(history, 'a')!.stdDev).toBe(0)
  })

  it('is higher for a player whose scores swing wildly than one who stays close to their average', () => {
    const swingy = pointsConsistency(
      makeHistory([
        { field: [['a', 60], ['b', 20]] },
        { field: [['a', 4], ['b', 40]] },
        { field: [['a', 60], ['b', 10]] },
      ]),
      'a',
    )!
    const steady = pointsConsistency(
      makeHistory([
        { field: [['c', 30], ['d', 20]] },
        { field: [['c', 32], ['d', 40]] },
        { field: [['c', 28], ['d', 10]] },
      ]),
      'c',
    )!

    expect(swingy.stdDev).toBeGreaterThan(steady.stdDev)
  })

  it('is null for a player who has never raced', () => {
    expect(pointsConsistency(makeHistory([{ field: [['a', 40], ['b', 20]] }]), 'nobody')).toBeNull()
  })
})

describe('consistencyRankings', () => {
  it('ranks steadiest first', () => {
    const history = makeHistory([
      { field: [['a', 30], ['b', 20], ['c', 10]] },
      { field: [['a', 30], ['b', 50], ['c', 15]] },
      { field: [['a', 30], ['b', 8], ['c', 20]] },
    ])
    const rankings = consistencyRankings(history, 3)
    expect(rankings[0].playerId).toBe('a')
    expect(rankings[rankings.length - 1].playerId).toBe('b')
  })

  it('excludes a player with fewer than minGps GPs', () => {
    const history = makeHistory([
      { field: [['a', 30], ['b', 20]] },
      { field: [['a', 30], ['c', 10]] },
    ])
    expect(consistencyRankings(history, 2).some((r) => r.playerId === 'c')).toBe(false)
  })
})

describe('attendance', () => {
  it('reports days since last played and this-month GP count', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['a', 40], ['b', 20]] },
    ])
    const info = attendance(history, new Date('2026-01-10T00:00:00Z')).find(
      (r) => r.playerId === 'a',
    )!

    expect(info.daysSinceLastPlayed).toBe(7)
    expect(info.gpsThisMonth).toBe(2)
    expect(info.drifted).toBe(false)
  })

  it('flags a player as drifted once they cross the threshold', () => {
    const history = makeHistory([{ field: [['a', 40], ['b', 20]] }])
    const info = attendance(history, new Date('2026-03-01T00:00:00Z')).find(
      (r) => r.playerId === 'a',
    )!
    expect(info.drifted).toBe(true)
  })

  it('sorts most recently active first', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['b', 40], ['c', 20]] },
    ])
    const ids = attendance(history, new Date('2026-01-10T00:00:00Z')).map((r) => r.playerId)
    expect(ids[ids.length - 1]).toBe('a')
  })
})

describe('buildRecordsBook', () => {
  it('finds the highest and worst single-GP points', () => {
    const book = buildRecordsBook(
      makeHistory([
        { field: [['a', 60], ['b', 20]] },
        { field: [['a', 30], ['b', 4]] },
      ]),
    )
    expect(book.highestPoints).toMatchObject({ playerId: 'a', value: 60 })
    expect(book.worstPoints).toMatchObject({ playerId: 'b', value: 4 })
  })

  it('finds the closest GP and the biggest blowout', () => {
    const book = buildRecordsBook(
      makeHistory([
        { field: [['a', 32], ['b', 30]] },
        { field: [['a', 60], ['b', 4]] },
      ]),
    )
    expect(book.closestGp?.spread).toBe(2)
    expect(book.biggestBlowout?.spread).toBe(56)
  })

  it('finds the longest win streak across everyone', () => {
    const book = buildRecordsBook(
      makeHistory([
        { field: [['a', 40], ['b', 10]] },
        { field: [['a', 40], ['b', 10]] },
        { field: [['a', 40], ['b', 10]] },
      ]),
    )
    expect(book.longestStreak).toEqual({ playerId: 'a', playerName: 'A', length: 3 })
  })

  it('finds the biggest upset across the whole history', () => {
    const book = buildRecordsBook(
      makeHistory([
        { field: [['a', 60], ['b', 4]] },
        { field: [['a', 60], ['b', 4]] },
        { field: [['a', 60], ['b', 4]] },
        { field: [['b', 60], ['a', 4]] },
      ]),
    )
    expect(book.biggestUpset?.playerId).toBe('b')
  })

  it('counts the most GPs played on one calendar date', () => {
    // makeHistory spaces GPs a day apart, so each date has exactly one GP.
    const book = buildRecordsBook(
      makeHistory([
        { field: [['a', 40], ['b', 10]] },
        { field: [['a', 40], ['b', 10]] },
      ]),
    )
    expect(book.biggestNight?.count).toBe(1)
  })

  it('is all null for an empty history', () => {
    const book = buildRecordsBook([])
    expect(Object.values(book).every((v) => v === null)).toBe(true)
  })
})

describe('sessionsFromHistory', () => {
  it('groups grand prix into one session when the gap between them is small', () => {
    const history = makeHistoryAt([
      { field: [['a', 40], ['b', 20]], playedAt: '2026-01-01T20:00:00Z' },
      { field: [['a', 20], ['b', 40]], playedAt: '2026-01-01T21:00:00Z' },
    ])
    const sessions = sessionsFromHistory(history)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].gps).toHaveLength(2)
  })

  it('starts a new session once the gap exceeds the threshold', () => {
    const history = makeHistoryAt([
      { field: [['a', 40], ['b', 20]], playedAt: '2026-01-01T20:00:00Z' },
      { field: [['a', 20], ['b', 40]], playedAt: '2026-01-03T20:00:00Z' },
    ])
    const sessions = sessionsFromHistory(history)
    expect(sessions).toHaveLength(2)
  })

  it('ranks standings by total points across the whole session, not any one GP', () => {
    const history = makeHistoryAt([
      { field: [['a', 10], ['b', 50]], playedAt: '2026-01-01T20:00:00Z' },
      { field: [['a', 50], ['b', 10]], playedAt: '2026-01-01T21:00:00Z' },
      { field: [['a', 50], ['b', 4]], playedAt: '2026-01-01T22:00:00Z' },
    ])
    const [session] = sessionsFromHistory(history)
    expect(session.standings[0].playerId).toBe('a')
    expect(session.standings[0].totalPoints).toBe(110)
    expect(session.standings[0].gpCount).toBe(3)
  })

  it('is empty for an empty history', () => {
    expect(sessionsFromHistory([])).toEqual([])
  })
})

describe('windowHistory', () => {
  it('returns everything for an all-time window', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['a', 20], ['b', 40]] },
    ])
    expect(windowHistory(history, { kind: 'all' })).toEqual(history)
  })

  it('keeps only the last N grand prix for a lastN window', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['a', 20], ['b', 40]] },
      { field: [['a', 30], ['b', 30]] },
    ])
    expect(windowHistory(history, { kind: 'lastN', n: 2 })).toEqual(history.slice(-2))
  })

  it('keeps only grand prix within the last N days for a days window', () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] }, // 2026-01-01
      { field: [['a', 40], ['b', 20]] }, // 2026-01-02
      { field: [['a', 40], ['b', 20]] }, // 2026-01-03
    ])
    const now = new Date('2026-01-03T20:00:00Z')
    const windowed = windowHistory(history, { kind: 'days', days: 1 }, now)
    expect(windowed.map((gp) => gp.id)).toEqual(['gp-2', 'gp-3'])
  })
})

describe('windowGpsFor', () => {
  it("restricts to the player's own last N grand prix, not the field's", () => {
    const history = makeHistory([
      { field: [['a', 40], ['b', 20]] },
      { field: [['b', 40], ['c', 20]] }, // a sits this one out
      { field: [['a', 20], ['b', 40]] },
    ])
    const windowed = windowGpsFor(history, 'a', { kind: 'lastN', n: 1 })
    expect(windowed).toHaveLength(1)
    expect(windowed[0].id).toBe('gp-3')
  })
})

describe('achievementsFor', () => {
  it('unlocks first win on the first GP a player finishes first in', () => {
    const history = makeHistory([
      { field: [['a', 10], ['b', 40]] },
      { field: [['a', 40], ['b', 10]] },
    ])
    const achievements = achievementsFor(history, 'a')
    expect(achievements.find((a) => a.id === 'first-win')?.unlockedAt).toBe(
      history[1].playedAt,
    )
  })

  it('unlocks clutch the first time a player scores at or above the threshold', () => {
    const history = makeHistory([{ field: [['a', 55], ['b', 4]] }])
    expect(achievementsFor(history, 'a').find((a) => a.id === 'clutch')?.unlockedAt).toBe(
      history[0].playedAt,
    )
    expect(achievementsFor(history, 'b').find((a) => a.id === 'clutch')?.unlockedAt).toBeNull()
  })

  it('unlocks giant slayer only when beating the roster-wide top-rated player', () => {
    const history = makeHistory([
      // a builds a big lead over b...
      { field: [['a', 60], ['b', 4]] },
      { field: [['a', 60], ['b', 4]] },
      // ...then c, a first-timer, out-scores a while a is still the roster's top rating.
      { field: [['a', 4], ['c', 60]] },
    ])
    expect(achievementsFor(history, 'c').find((a) => a.id === 'giant-slayer')?.unlockedAt).toBe(
      history[2].playedAt,
    )
    expect(achievementsFor(history, 'a').find((a) => a.id === 'giant-slayer')?.unlockedAt).toBeNull()
  })

  it('unlocks regular exactly on the GP milestone, not before', () => {
    const nine = Array.from({ length: 9 }, () => ({ field: [['a', 30], ['b', 30]] as [string, number][] }))
    expect(achievementsFor(makeHistory(nine), 'a').find((a) => a.id === 'regular')?.unlockedAt).toBeNull()

    const ten = [...nine, { field: [['a', 30], ['b', 30]] as [string, number][] }]
    const history = makeHistory(ten)
    expect(achievementsFor(history, 'a').find((a) => a.id === 'regular')?.unlockedAt).toBe(
      history[9].playedAt,
    )
  })

  it('unlocks the sweep achievement when a player wins every GP in a multi-GP session', () => {
    const history = makeHistoryAt([
      { field: [['a', 40], ['b', 20]], playedAt: '2026-01-01T20:00:00Z' },
      { field: [['a', 40], ['b', 20]], playedAt: '2026-01-01T21:00:00Z' },
    ])
    expect(achievementsFor(history, 'a').find((a) => a.id === 'sweep')?.unlockedAt).toBe(
      history[1].playedAt,
    )
    expect(achievementsFor(history, 'b').find((a) => a.id === 'sweep')?.unlockedAt).toBeNull()
  })

  it('never unlocks the sweep achievement off a single-GP session', () => {
    const history = makeHistory([{ field: [['a', 40], ['b', 20]] }])
    expect(achievementsFor(history, 'a').find((a) => a.id === 'sweep')?.unlockedAt).toBeNull()
  })
})
