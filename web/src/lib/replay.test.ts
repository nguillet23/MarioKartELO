import { describe, expect, it } from 'vitest'
import { computeGpElo, STARTING_ELO } from './elo'
import { groupIntoGrandPrix, type GrandPrix } from './history'
import { replayHistory } from './replay'

interface GpSpec {
  field: [string, number][]
}

/** Same replay-and-build pattern as stats.test.ts's makeHistory. */
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
      grand_prix: { played_at: `2026-01-${String(index + 1).padStart(2, '0')}T20:00:00Z` },
      players: { name: p.playerId.toUpperCase() },
    }))
  })

  return groupIntoGrandPrix(rows)
}

describe('replayHistory', () => {
  it('reproduces the stored ratings exactly when replayed with the same rules', () => {
    const history = makeHistory([
      { field: [['a', 60], ['b', 30], ['c', 20], ['d', 4]] },
      { field: [['a', 20], ['b', 50], ['c', 30], ['d', 10]] },
      { field: [['a', 40], ['b', 40], ['c', 10], ['d', 5]] },
    ])

    const { history: replayed, finalRatings } = replayHistory(history)

    for (const gp of history) {
      const replayedGp = replayed.find((g) => g.id === gp.id)!
      for (const entry of gp.entries) {
        const replayedEntry = replayedGp.entries.find((e) => e.playerId === entry.playerId)!
        expect(replayedEntry.eloAfter).toBe(entry.eloAfter)
        expect(replayedEntry.eloBefore).toBe(entry.eloBefore)
      }
    }

    const last = history[history.length - 1]
    for (const entry of last.entries) {
      expect(finalRatings.get(entry.playerId)).toBe(entry.eloAfter)
    }
  })

  it('leaves points and rank untouched, only recomputing rating', () => {
    const history = makeHistory([{ field: [['a', 60], ['b', 30], ['c', 20], ['d', 4]] }])
    const { history: replayed } = replayHistory(history)

    expect(replayed[0].entries.map((e) => ({ playerId: e.playerId, points: e.points, rank: e.rank }))).toEqual(
      history[0].entries.map((e) => ({ playerId: e.playerId, points: e.points, rank: e.rank })),
    )
  })

  it('changes downstream ratings when a grand prix is excluded, standing in for voiding it', () => {
    const history = makeHistory([
      { field: [['a', 60], ['b', 4], ['c', 30], ['d', 20]] },
      { field: [['a', 60], ['b', 4], ['c', 30], ['d', 20]] },
      { field: [['a', 20], ['b', 40], ['c', 10], ['d', 5]] },
    ])

    const withoutMiddle = [history[0], history[2]]
    const { finalRatings } = replayHistory(withoutMiddle)
    const actualFinal = history[2].entries.find((e) => e.playerId === 'a')!.eloAfter

    expect(finalRatings.get('a')).not.toBe(actualFinal)
  })

  it('a higher K produces a bigger swing than a lower one, standing in for retuning constants', () => {
    const history = makeHistory([{ field: [['a', 60], ['b', 4], ['c', 30], ['d', 20]] }])

    const lowK = replayHistory(history, { k: 8 })
    const highK = replayHistory(history, { k: 32 })

    expect(highK.finalRatings.get('a')!).toBeGreaterThan(lowK.finalRatings.get('a')!)
  })

  it('is a no-op on an empty history', () => {
    const { history: replayed, finalRatings } = replayHistory([])
    expect(replayed).toEqual([])
    expect(finalRatings.size).toBe(0)
  })
})
