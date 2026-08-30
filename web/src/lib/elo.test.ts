import { describe, expect, it } from 'vitest'
import {
  actualScore,
  computeGpElo,
  DEFAULT_K,
  kFactorFor,
  MIN_ELO,
  PLACEMENT_BONUS_UNIT,
  placementBonuses,
  PROVISIONAL_GP_COUNT,
  PROVISIONAL_K,
  type GpParticipant,
} from './elo'

/** A settled player, so tests aren't accidentally exercising the K taper. */
function settled(playerId: string, rating: number, points: number): GpParticipant {
  return { playerId, rating, points, gpCount: PROVISIONAL_GP_COUNT }
}

describe('computeGpElo', () => {
  it('throws with fewer than 4 participants', () => {
    expect(() =>
      computeGpElo([settled('a', 100, 40), settled('b', 100, 30), settled('c', 100, 20)]),
    ).toThrow()
  })

  it('throws when the same player appears twice', () => {
    expect(() =>
      computeGpElo([
        settled('a', 100, 40),
        settled('a', 100, 20),
        settled('b', 100, 10),
        settled('c', 100, 5),
      ]),
    ).toThrow()
  })

  it("is zero-sum within rounding error: every GP's total rating change stays near 0", () => {
    // The underlying pairwise math is exactly zero-sum, but each participant's
    // delta is independently rounded to a whole number (so ratings always
    // display/store as integers), which can leave a residual of at most
    // ~0.5 per participant once those independent roundings are summed.
    const participants = [
      settled('a', 100, 60),
      settled('b', 80, 30),
      settled('c', 120, 45),
      settled('d', 60, 4),
    ]
    const updates = computeGpElo(participants)
    const total = updates.reduce((sum, u) => sum + u.eloDelta, 0)
    expect(Math.abs(total)).toBeLessThanOrEqual(participants.length / 2)
  })

  it('gives every player zero delta in a total tie', () => {
    const [a, b, c, d] = computeGpElo([
      settled('a', 100, 30),
      settled('b', 100, 30),
      settled('c', 100, 30),
      settled('d', 100, 30),
    ])
    for (const u of [a, b, c, d]) expect(u.eloDelta).toBeCloseTo(0, 10)
  })

  it('gives the same credit for the same result regardless of either rating', () => {
    // A player's own rating stopped setting what's "expected" of them: beating
    // a lower-rated opponent by 30 nets the same as beating a higher-rated one
    // by 30 — the exchange only looks at points, never at either rating. c and
    // d are held fixed across both fields so only b's rating differs.
    const beatsLowerRated = computeGpElo([
      settled('a', 100, 60),
      settled('b', 80, 30),
      settled('c', 100, 20),
      settled('d', 100, 4),
    ])
    const beatsHigherRated = computeGpElo([
      settled('a', 100, 60),
      settled('b', 120, 30),
      settled('c', 100, 20),
      settled('d', 100, 4),
    ])

    const gainVsLower = beatsLowerRated.find((u) => u.playerId === 'a')!.eloDelta
    const gainVsHigher = beatsHigherRated.find((u) => u.playerId === 'a')!.eloDelta

    expect(gainVsHigher).toBe(gainVsLower)
  })

  it('ranks deltas in the same order as points when ratings are equal', () => {
    const updates = computeGpElo([
      settled('a', 100, 60),
      settled('b', 100, 40),
      settled('c', 100, 20),
      settled('d', 100, 4),
    ])
    const byPlayer = Object.fromEntries(updates.map((u) => [u.playerId, u.eloDelta]))
    expect(byPlayer.a).toBeGreaterThan(byPlayer.b)
    expect(byPlayer.b).toBeGreaterThan(byPlayer.c)
    expect(byPlayer.c).toBeGreaterThan(byPlayer.d)
  })

  it('scales the margin-based portion with a custom K factor', () => {
    const participants = [
      settled('a', 100, 60),
      settled('b', 100, 30),
      settled('c', 100, 20),
      settled('d', 100, 4),
    ]
    const normal = computeGpElo(participants, { k: DEFAULT_K })
    const doubled = computeGpElo(participants, { k: DEFAULT_K * 2 })

    const normalDelta = normal.find((u) => u.playerId === 'a')!.eloDelta
    const doubledDelta = doubled.find((u) => u.playerId === 'a')!.eloDelta
    // The flat placement bonus doesn't scale with K — only the margin-based
    // portion doubles, so doubling K roughly doubles the total minus the one
    // bonus that didn't get doubled. Within 1, not exact: both deltas are
    // independently rounded to whole numbers.
    expect(
      Math.abs(doubledDelta - (2 * normalDelta - PLACEMENT_BONUS_UNIT)),
    ).toBeLessThanOrEqual(1)
  })

  it('scales pairwise comparisons correctly for a 12-player field', () => {
    const participants = Array.from({ length: 12 }, (_, i) =>
      settled(`p${i}`, 100, 60 - i * 5),
    )
    const updates = computeGpElo(participants)
    expect(updates).toHaveLength(12)
    const total = updates.reduce((sum, u) => sum + u.eloDelta, 0)
    expect(Math.abs(total)).toBeLessThanOrEqual(participants.length / 2)
    // Highest scorer should have the largest gain, lowest scorer the largest loss.
    expect(updates[0].eloDelta).toBeGreaterThan(updates[11].eloDelta)
  })

  it('preserves eloBefore/eloAfter/eloDelta consistency', () => {
    const updates = computeGpElo([
      settled('a', 100, 60),
      settled('b', 90, 20),
      settled('c', 100, 15),
      settled('d', 100, 4),
    ])
    for (const u of updates) {
      expect(u.eloAfter).toBeCloseTo(u.eloBefore + u.eloDelta, 10)
    }
  })

  it('always rounds eloDelta and eloAfter to whole numbers', () => {
    const updates = computeGpElo([
      settled('a', 105, 37),
      settled('b', 95, 41),
      settled('c', 101, 22),
      settled('d', 98, 8),
    ])
    for (const u of updates) {
      expect(Number.isInteger(u.eloDelta)).toBe(true)
      expect(Number.isInteger(u.eloAfter)).toBe(true)
    }
  })
})

describe('margin of victory', () => {
  it('scores a blowout higher than a narrow win', () => {
    // a and c/d are held fixed across both fields, so only the margin of a's
    // win over b differs between the two scenarios.
    const blowout = computeGpElo([
      settled('a', 100, 60),
      settled('b', 100, 4),
      settled('c', 100, 30),
      settled('d', 100, 20),
    ])
    const nailBiter = computeGpElo([
      settled('a', 100, 60),
      settled('b', 100, 56),
      settled('c', 100, 30),
      settled('d', 100, 20),
    ])

    const blowoutGain = blowout.find((u) => u.playerId === 'a')!.eloDelta
    const nailBiterGain = nailBiter.find((u) => u.playerId === 'a')!.eloDelta

    expect(blowoutGain).toBeGreaterThan(nailBiterGain)
  })

  it('still counts a narrow win as a win', () => {
    // c sits between a and b so b isn't a clean rank-2 (a rank-2 finish's
    // placement bonus alone is enough to flip a narrow loss into a net
    // gain — see the "close 2nd" tests below). Demoted to rank 3, b's
    // bonus goes slightly negative instead, so the narrow loss to a stays
    // a loss.
    const [winner, loser] = computeGpElo([
      settled('a', 100, 32),
      settled('b', 100, 30),
      settled('c', 100, 31),
      settled('d', 100, 4),
    ])
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

describe('placementBonuses', () => {
  it('sums to exactly 0 across a field of distinct finishes', () => {
    const bonuses = placementBonuses([
      { playerId: 'a', points: 60 },
      { playerId: 'b', points: 40 },
      { playerId: 'c', points: 20 },
      { playerId: 'd', points: 4 },
    ])
    const total = [...bonuses.values()].reduce((sum, b) => sum + b, 0)
    expect(total).toBeCloseTo(0, 10)
    expect(bonuses.get('a')).toBe(PLACEMENT_BONUS_UNIT)
    expect(bonuses.get('d')).toBe(-PLACEMENT_BONUS_UNIT)
  })

  it('splits tied ranks evenly and still sums to 0', () => {
    // b and c tie for 2nd/3rd — each gets the average of those two spots.
    const bonuses = placementBonuses([
      { playerId: 'a', points: 60 },
      { playerId: 'b', points: 30 },
      { playerId: 'c', points: 30 },
      { playerId: 'd', points: 4 },
    ])
    expect(bonuses.get('b')).toBe(bonuses.get('c'))
    const total = [...bonuses.values()].reduce((sum, b) => sum + b, 0)
    expect(total).toBeCloseTo(0, 10)
  })

  it('gives every player 0 in a total tie', () => {
    const bonuses = placementBonuses([
      { playerId: 'a', points: 30 },
      { playerId: 'b', points: 30 },
    ])
    expect(bonuses.get('a')).toBeCloseTo(0, 10)
    expect(bonuses.get('b')).toBeCloseTo(0, 10)
  })

  it('caps at PLACEMENT_BONUS_UNIT regardless of field size', () => {
    const bonuses = placementBonuses(
      Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i}`, points: 60 - i * 5 })),
    )
    expect(bonuses.get('p0')).toBe(PLACEMENT_BONUS_UNIT)
    expect(bonuses.get('p11')).toBe(-PLACEMENT_BONUS_UNIT)
  })
})

describe('placement bonus in computeGpElo', () => {
  it('can turn a close 2nd behind a distant leader from a net loss into a net gain', () => {
    // Without a placement bonus, a distant leader plus a tightly-bunched pack
    // can leave the runner-up with a net loss even though they finished 2nd:
    // one big loss to the leader can outweigh two small wins over 3rd/4th.
    const updates = computeGpElo([
      settled('leader', 100, 55),
      settled('runnerUp', 100, 31),
      settled('third', 100, 29),
      settled('fourth', 100, 28),
    ])
    const runnerUp = updates.find((u) => u.playerId === 'runnerUp')!
    expect(runnerUp.eloDelta).toBeGreaterThanOrEqual(0)
  })

  it("still lets a big loss to the leader outweigh the placement bonus", () => {
    // Only 1st and last place get a bonus large enough to matter
    // (±PLACEMENT_BONUS_UNIT); getting nosed out of 2nd by "rival" leaves
    // "player" in 3rd with a small *negative* bonus, not a cushion — so a
    // blowout loss to a distant leader still nets a loss even though
    // player clearly beat 4th.
    const updates = computeGpElo([
      settled('leader', 100, 60),
      settled('rival', 100, 9),
      settled('player', 100, 8),
      settled('fourth', 100, 4),
    ])
    const player = updates.find((u) => u.playerId === 'player')!
    expect(player.eloDelta).toBeLessThan(0)
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
      { playerId: 'rookie', rating: 100, points: 60, gpCount: 0 },
      { playerId: 'regular', rating: 100, points: 30, gpCount: 20 },
      { playerId: 'c', rating: 100, points: 20, gpCount: 20 },
      { playerId: 'd', rating: 100, points: 4, gpCount: 20 },
    ])
    const [veteran] = computeGpElo([
      { playerId: 'veteran', rating: 100, points: 60, gpCount: 20 },
      { playerId: 'regular', rating: 100, points: 30, gpCount: 20 },
      { playerId: 'c', rating: 100, points: 20, gpCount: 20 },
      { playerId: 'd', rating: 100, points: 4, gpCount: 20 },
    ])
    expect(rookie.eloDelta).toBeGreaterThan(veteran.eloDelta)
  })
})

describe('the rating floor', () => {
  /**
   * A whole field near the floor. That's the case the clamp exists for: a lone
   * low-rated player in a normal field is already expected to lose, so their
   * raw delta is near zero and there is nothing to truncate. Level the field
   * and last place takes a full-sized loss with nowhere left to fall.
   */
  const lowField = (rating: number) => [
    settled('a', rating, 60),
    settled('b', rating, 45),
    settled('c', rating, 30),
    settled('d', rating, 4),
  ]

  const lastPlace = (rating: number) =>
    computeGpElo(lowField(rating)).find((u) => u.playerId === 'd')!

  it('truncates a loss that would cross the floor', () => {
    // Unclamped this is -9 (margin plus last place's placement penalty) —
    // see the rating of 10 below, which has room for it.
    const clamped = lastPlace(5)
    expect(clamped.eloAfter).toBe(MIN_ELO)
    expect(clamped.eloDelta).toBe(-5)
    expect(lastPlace(10).eloDelta).toBe(-9)
  })

  it('never returns a rating below the floor', () => {
    for (const rating of [0, 1, 2, 3, 5, 8, 12, 100]) {
      expect(lastPlace(rating).eloAfter).toBeGreaterThanOrEqual(MIN_ELO)
    }
  })

  it('reports the delta it actually applied, so voiding rolls back exactly', () => {
    // void_last_gp undoes a GP with `elo = elo - elo_delta`. If the delta were
    // the unclamped one, that would restore a rating the player never had.
    for (const rating of [0, 1, 2, 3, 5, 8, 12, 100]) {
      const update = lastPlace(rating)
      expect(update.eloBefore).toBe(rating)
      expect(update.eloBefore + update.eloDelta).toBe(update.eloAfter)
    }
  })

  it('takes a player already at the floor no further down', () => {
    const update = lastPlace(MIN_ELO)
    expect(update.eloAfter).toBe(MIN_ELO)
    expect(update.eloDelta).toBe(0)
  })

  it('lets a player at the floor climb back out by winning', () => {
    const [winner] = computeGpElo([
      { playerId: 'floored', rating: MIN_ELO, points: 60, gpCount: 20 },
      { playerId: 'rival', rating: 100, points: 30, gpCount: 20 },
      { playerId: 'c', rating: 100, points: 20, gpCount: 20 },
      { playerId: 'd', rating: 100, points: 4, gpCount: 20 },
    ])
    expect(winner.eloDelta).toBeGreaterThan(0)
    expect(winner.eloAfter).toBeGreaterThan(MIN_ELO)
  })

  it('leaves a result nowhere near the floor untouched', () => {
    for (const update of computeGpElo(lowField(100))) {
      expect(update.eloAfter).toBe(update.eloBefore + update.eloDelta)
      expect(update.eloAfter).toBeGreaterThan(MIN_ELO)
    }
  })
})
