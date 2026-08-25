import { describe, expect, it } from 'vitest'
import { computeGpElo, DEFAULT_K } from './elo'

describe('computeGpElo', () => {
  it('throws with fewer than 2 participants', () => {
    expect(() => computeGpElo([{ playerId: 'a', rating: 1500, points: 40 }])).toThrow()
  })

  it('is zero-sum: every GP\'s total rating change nets to ~0', () => {
    const updates = computeGpElo([
      { playerId: 'a', rating: 1500, points: 60 },
      { playerId: 'b', rating: 1400, points: 30 },
      { playerId: 'c', rating: 1600, points: 45 },
      { playerId: 'd', rating: 1300, points: 4 },
    ])
    const total = updates.reduce((sum, u) => sum + u.eloDelta, 0)
    expect(total).toBeCloseTo(0, 10)
  })

  it('is symmetric for a 2-player GP: winner gains exactly what the loser loses', () => {
    const [winner, loser] = computeGpElo([
      { playerId: 'a', rating: 1500, points: 60 },
      { playerId: 'b', rating: 1500, points: 30 },
    ])
    expect(winner.eloDelta).toBeCloseTo(-loser.eloDelta, 10)
    expect(winner.eloDelta).toBeGreaterThan(0)
    expect(loser.eloDelta).toBeLessThan(0)
  })

  it('gives equally-rated tied players zero delta', () => {
    const [a, b] = computeGpElo([
      { playerId: 'a', rating: 1500, points: 30 },
      { playerId: 'b', rating: 1500, points: 30 },
    ])
    expect(a.eloDelta).toBeCloseTo(0, 10)
    expect(b.eloDelta).toBeCloseTo(0, 10)
  })

  it('rewards beating a higher-rated player more than beating a lower-rated one', () => {
    const beatsLowerRated = computeGpElo([
      { playerId: 'a', rating: 1500, points: 60 },
      { playerId: 'b', rating: 1400, points: 30 },
    ])
    const beatsHigherRated = computeGpElo([
      { playerId: 'a', rating: 1500, points: 60 },
      { playerId: 'b', rating: 1600, points: 30 },
    ])

    const gainVsLower = beatsLowerRated.find((u) => u.playerId === 'a')!.eloDelta
    const gainVsHigher = beatsHigherRated.find((u) => u.playerId === 'a')!.eloDelta

    expect(gainVsHigher).toBeGreaterThan(gainVsLower)
  })

  it('ranks deltas in the same order as points when ratings are equal', () => {
    const updates = computeGpElo([
      { playerId: 'a', rating: 1500, points: 60 },
      { playerId: 'b', rating: 1500, points: 40 },
      { playerId: 'c', rating: 1500, points: 20 },
      { playerId: 'd', rating: 1500, points: 4 },
    ])
    const byPlayer = Object.fromEntries(updates.map((u) => [u.playerId, u.eloDelta]))
    expect(byPlayer.a).toBeGreaterThan(byPlayer.b)
    expect(byPlayer.b).toBeGreaterThan(byPlayer.c)
    expect(byPlayer.c).toBeGreaterThan(byPlayer.d)
  })

  it('scales with a custom K factor', () => {
    const participants: Parameters<typeof computeGpElo>[0] = [
      { playerId: 'a', rating: 1500, points: 60 },
      { playerId: 'b', rating: 1500, points: 30 },
    ]
    const normal = computeGpElo(participants, DEFAULT_K)
    const doubled = computeGpElo(participants, DEFAULT_K * 2)

    const normalDelta = normal.find((u) => u.playerId === 'a')!.eloDelta
    const doubledDelta = doubled.find((u) => u.playerId === 'a')!.eloDelta
    expect(doubledDelta).toBeCloseTo(normalDelta * 2, 10)
  })

  it('scales pairwise comparisons correctly for a 12-player field', () => {
    const participants = Array.from({ length: 12 }, (_, i) => ({
      playerId: `p${i}`,
      rating: 1500,
      points: 60 - i * 5,
    }))
    const updates = computeGpElo(participants)
    expect(updates).toHaveLength(12)
    const total = updates.reduce((sum, u) => sum + u.eloDelta, 0)
    expect(total).toBeCloseTo(0, 8)
    // Highest scorer should have the largest gain, lowest scorer the largest loss.
    expect(updates[0].eloDelta).toBeGreaterThan(updates[11].eloDelta)
  })

  it('preserves eloBefore/eloAfter/eloDelta consistency', () => {
    const updates = computeGpElo([
      { playerId: 'a', rating: 1500, points: 60 },
      { playerId: 'b', rating: 1450, points: 20 },
    ])
    for (const u of updates) {
      expect(u.eloAfter).toBeCloseTo(u.eloBefore + u.eloDelta, 10)
    }
  })
})
