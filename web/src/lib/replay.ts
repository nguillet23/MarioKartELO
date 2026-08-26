// A pure, from-scratch replay of every grand prix under a chosen rule set —
// PLAN.md's "Replay / recompute". Read-only: this never touches the
// database or the real ratings, it only shows what the numbers would have
// been.
//
// Reuses `computeGpElo` exactly as `submit_gp` does, just fed points already
// on record instead of a fresh submission, and starting every rating over
// from STARTING_ELO — so retuning DEFAULT_K or MARGIN_WEIGHT, or dropping a
// GP out of the replayed history, shows its effect on the whole history at
// once, without writing anything back.

import { computeGpElo, STARTING_ELO, type EloOptions } from './elo'
import type { GpEntry, GrandPrix } from './history'

export interface ReplayResult {
  /** Every player's rating after a from-scratch replay, by player id. */
  finalRatings: Map<string, number>
  /** The same shape as the real history, with every rating recomputed. */
  history: GrandPrix[]
}

/**
 * Rebuilds every rating from a sequence of grand prix, oldest first, using
 * `options` in place of the live constants. Only points and finishing order
 * are taken from `history` — every eloBefore/eloAfter/eloDelta is recomputed
 * from scratch. Leaving a GP out of `history` before calling this stands in
 * for voiding it; passing a `k` or `marginWeight` override stands in for
 * retuning the whole history against new constants.
 */
export function replayHistory(history: GrandPrix[], options: EloOptions = {}): ReplayResult {
  const rating = new Map<string, number>()
  const gpCount = new Map<string, number>()

  const replayed: GrandPrix[] = history.map((gp) => {
    const participants = gp.entries.map((entry) => ({
      playerId: entry.playerId,
      rating: rating.get(entry.playerId) ?? STARTING_ELO,
      points: entry.points,
      gpCount: gpCount.get(entry.playerId) ?? 0,
    }))

    const updates = computeGpElo(participants, options)
    const byId = new Map(updates.map((u) => [u.playerId, u]))

    for (const update of updates) {
      rating.set(update.playerId, update.eloAfter)
      gpCount.set(update.playerId, (gpCount.get(update.playerId) ?? 0) + 1)
    }

    const entries: GpEntry[] = gp.entries.map((entry) => {
      const update = byId.get(entry.playerId)!
      return {
        ...entry,
        eloBefore: update.eloBefore,
        eloAfter: update.eloAfter,
        eloDelta: update.eloDelta,
      }
    })

    return { ...gp, entries }
  })

  return { finalRatings: rating, history: replayed }
}
