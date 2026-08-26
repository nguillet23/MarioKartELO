import { describe, expect, it } from 'vitest'
import { computeGpElo, STARTING_ELO } from './elo'
import { groupIntoGrandPrix, type GrandPrix } from './history'
import {
  buildRecap,
  headToHead,
  opponentRecords,
  playerBests,
  playersAtPeak,
  rivalOf,
  streaksFor,
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
})
