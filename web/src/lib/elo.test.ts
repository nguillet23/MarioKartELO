import { describe, expect, it } from 'vitest'
import {
  actualScore,
  computeGpElo,
  DEFAULT_K,
  kFactorFor,
  PROVISIONAL_GP_COUNT,
  PROVISIONAL_K,
  type GpParticipant,
} from './elo'

/** A settled player, so tests aren't accidentally exercising the K taper. */
function settled(playerId: string, rating: number, points: number): GpParticipant {
  return { playerId, rating, points, gpCount: PROVISIONAL_GP_COUNT }
}

describe('computeGpElo', () => {
  it('throws with fewer than 2 participants', () => {
    expect(() => computeGpElo([settled('a', 1500, 40)])).toThrow()
  })

  it('throws when the same player appears twice', () => {
    expect(() => computeGpElo([settled('a', 1500, 40), settled('a', 1500, 20)])).toThrow()
  })

  it("is zero-sum within rounding error: every GP's total rating change stays near 0", () => {
    // The underlying pairwise math is exactly zero-sum, but each participant's
    // delta is independently rounded to a whole number (so ratings always
    // display/store as integers), which can leave a residual of at most
    // ~0.5 per participant once those independent roundings are summed.
    const participants = [
      settled('a', 1500, 60),
      settled('b', 1400, 30),
      settled('c', 1600, 45),
      settled('d', 1300, 4),
    ]
    const updates = computeGpElo(participants)
    const total = updates.reduce((sum, u) => sum + u.eloDelta, 0)
    expect(Math.abs(total)).toBeLessThanOrEqual(participants.length / 2)
  })

  it('is symmetric for a 2-player GP: winner gains exactly what the loser loses', () => {
    const [winner, loser] = computeGpElo([settled('a', 1500, 60), settled('b', 1500, 30)])
    expect(winner.eloDelta).toBeCloseTo(-loser.eloDelta, 10)
    expect(winner.eloDelta).toBeGreaterThan(0)
    expect(loser.eloDelta).toBeLessThan(0)
  })

  it('gives equally-rated tied players zero delta', () => {
    const [a, b] = computeGpElo([settled('a', 1500, 30), settled('b', 1500, 30)])
    expect(a.eloDelta).toBeCloseTo(0, 10)
    expect(b.eloDelta).toBeCloseTo(0, 10)
  })

  it('rewards beating a higher-rated player more than beating a lower-rated one', () => {
    const beatsLowerRated = computeGpElo([settled('a', 1500, 60), settled('b', 1400, 30)])
    const beatsHigherRated = computeGpElo([settled('a', 1500, 60), settled('b', 1600, 30)])

    const gainVsLower = beatsLowerRated.find((u) => u.playerId === 'a')!.eloDelta
    const gainVsHigher = beatsHigherRated.find((u) => u.playerId === 'a')!.eloDelta

    expect(gainVsHigher).toBeGreaterThan(gainVsLower)
  })

  it('ranks deltas in the same order as points when ratings are equal', () => {
    const updates = computeGpElo([
      settled('a', 1500, 60),
      settled('b', 1500, 40),
      settled('c', 1500, 20),
      settled('d', 1500, 4),
    ])
    const byPlayer = Object.fromEntries(updates.map((u) => [u.playerId, u.eloDelta]))
    expect(byPlayer.a).toBeGreaterThan(byPlayer.b)
    expect(byPlayer.b).toBeGreaterThan(byPlayer.c)
    expect(byPlayer.c).toBeGreaterThan(byPlayer.d)
  })

  it('scales with a custom K factor', () => {
    const participants = [settled('a', 1500, 60), settled('b', 1500, 30)]
    const normal = computeGpElo(participants, { k: DEFAULT_K })
    const doubled = computeGpElo(participants, { k: DEFAULT_K * 2 })

    const normalDelta = normal.find((u) => u.playerId === 'a')!.eloDelta
    const doubledDelta = doubled.find((u) => u.playerId === 'a')!.eloDelta
    // Within 1, not exact: both deltas are independently rounded to whole
    // numbers, so doubling K can land either side of a .5 boundary.
    expect(Math.abs(doubledDelta - normalDelta * 2)).toBeLessThanOrEqual(1)
  })

  it('scales pairwise comparisons correctly for a 12-player field', () => {
    const participants = Array.from({ length: 12 }, (_, i) =>
      settled(`p${i}`, 1500, 60 - i * 5),
    )
    const updates = computeGpElo(participants)
    expect(updates).toHaveLength(12)
    const total = updates.reduce((sum, u) => sum + u.eloDelta, 0)
    expect(Math.abs(total)).toBeLessThanOrEqual(participants.length / 2)
    // Highest scorer should have the largest gain, lowest scorer the largest loss.
    expect(updates[0].eloDelta).toBeGreaterThan(updates[11].eloDelta)
  })

  it('preserves eloBefore/eloAfter/eloDelta consistency', () => {
    const updates = computeGpElo([settled('a', 1500, 60), settled('b', 1450, 20)])
    for (const u of updates) {
      expect(u.eloAfter).toBeCloseTo(u.eloBefore + u.eloDelta, 10)
    }
  })

  it('always rounds eloDelta and eloAfter to whole numbers', () => {
    const updates = computeGpElo([
      settled('a', 1517, 37),
      settled('b', 1483, 41),
      settled('c', 1502, 22),
    ])
    for (const u of updates) {
      expect(Number.isInteger(u.eloDelta)).toBe(true)
      expect(Number.isInteger(u.eloAfter)).toBe(true)
    }
  })
})

describe('margin of victory', () => {
  it('scores a blowout higher than a narrow win', () => {
    const blowout = computeGpElo([settled('a', 1500, 60), settled('b', 1500, 4)])
    const nailBiter = computeGpElo([settled('a', 1500, 32), settled('b', 1500, 30)])

    const blowoutGain = blowout.find((u) => u.playerId === 'a')!.eloDelta
    const nailBiterGain = nailBiter.find((u) => u.playerId === 'a')!.eloDelta

    expect(blowoutGain).toBeGreaterThan(nailBiterGain)
  })

  it('still counts a narrow win as a win', () => {
    const [winner, loser] = computeGpElo([settled('a', 1500, 31), settled('b', 1500, 30)])
    expect(winner.eloDelta).toBeGreaterThan(0)
    expect(loser.eloDelta).toBeLessThan(0)
  })

  it('stays antisymmetric so the pairwise math remains zero-sum', () => {
    for (const [a, b] of [
      [60, 4],
      [32, 30],
      [45, 45],
      [4, 60],
    ]) {
      expect(actualScore(a, b) + actualScore(b, a)).toBeCloseTo(1, 10)
    }
  })

  it('caps at a full win for the widest possible margin', () => {
    expect(actualScore(60, 4)).toBeCloseTo(1, 10)
    expect(actualScore(4, 60)).toBeCloseTo(0, 10)
  })

  it('collapses to a flat win/loss when marginWeight is 0', () => {
    expect(actualScore(60, 4, 0)).toBeCloseTo(1, 10)
    expect(actualScore(31, 30, 0)).toBeCloseTo(1, 10)
  })
})

describe('kFactorFor', () => {
  it('starts at PROVISIONAL_K for a brand-new player', () => {
    expect(kFactorFor(0)).toBeCloseTo(PROVISIONAL_K, 10)
  })

  it('settles at DEFAULT_K once a player is past their provisional GPs', () => {
    expect(kFactorFor(PROVISIONAL_GP_COUNT)).toBeCloseTo(DEFAULT_K, 10)
    expect(kFactorFor(PROVISIONAL_GP_COUNT + 50)).toBeCloseTo(DEFAULT_K, 10)
  })

  it('tapers down monotonically in between', () => {
    for (let gpCount = 0; gpCount < PROVISIONAL_GP_COUNT; gpCount++) {
      expect(kFactorFor(gpCount)).toBeGreaterThan(kFactorFor(gpCount + 1))
    }
  })

  it('moves a provisional player further than a settled one in the same GP', () => {
    const [rookie] = computeGpElo([
      { playerId: 'rookie', rating: 1500, points: 60, gpCount: 0 },
      { playerId: 'regular', rating: 1500, points: 30, gpCount: 20 },
    ])
    const [veteran] = computeGpElo([
      { playerId: 'veteran', rating: 1500, points: 60, gpCount: 20 },
      { playerId: 'regular', rating: 1500, points: 30, gpCount: 20 },
    ])
    expect(rookie.eloDelta).toBeGreaterThan(veteran.eloDelta)
  })
})
