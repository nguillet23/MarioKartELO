// Pairwise multiplayer Elo — see PLAN.md §5 for the design this implements.

/** K for a settled player. */
export const DEFAULT_K = 32
/** K for a brand-new player, tapering down to DEFAULT_K over their first GPs. */
export const PROVISIONAL_K = 48
/** How many GPs a player stays provisional for. */
export const PROVISIONAL_GP_COUNT = 5
export const STARTING_ELO = 1500

/** A GP's point range: 4 = last in every race, 60 = 1st in every race. */
export const MIN_GP_POINTS = 4
export const MAX_GP_POINTS = 60
export const POINTS_SPREAD = MAX_GP_POINTS - MIN_GP_POINTS

/**
 * How much of a win's credit is margin-dependent (0 = flat win/loss, ignore
 * margin entirely; 1 = a 1-point win is worth almost nothing). At 0.5 a bare
 * win scores 0.75 against that opponent and a 60-4 sweep scores the full 1.0.
 *
 * Deliberately linear rather than squared: in a real GP the top two players
 * are usually within ~10 points of each other, and squaring the margin
 * (10/56)² would flatten nearly every real result back down to a tie.
 */
export const MARGIN_WEIGHT = 0.5

export interface GpParticipant {
  playerId: string
  /** Rating going into this GP. */
  rating: number
  /** Total points scored across the GP's 4 races. */
  points: number
  /** GPs played before this one — drives the provisional K taper. */
  gpCount: number
}

export interface EloUpdate {
  playerId: string
  eloBefore: number
  eloAfter: number
  eloDelta: number
}

export interface EloOptions {
  /** Force one K for every player, bypassing the provisional taper. */
  k?: number
  /** Override MARGIN_WEIGHT. */
  marginWeight?: number
}

/**
 * New players' ratings should move faster so they find their level quickly.
 * Tapers linearly from PROVISIONAL_K at 0 GPs to DEFAULT_K at
 * PROVISIONAL_GP_COUNT, rather than stepping down all at once.
 */
export function kFactorFor(gpCount: number): number {
  if (gpCount >= PROVISIONAL_GP_COUNT) return DEFAULT_K
  const progress = Math.max(gpCount, 0) / PROVISIONAL_GP_COUNT
  return PROVISIONAL_K - (PROVISIONAL_K - DEFAULT_K) * progress
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

/**
 * The graded result of one pairwise matchup, in [0, 1]. A tie is 0.5; a win
 * is 0.5 + credit, where credit grows with how decisively the GP was won.
 * Antisymmetric by construction — actualScore(a, b) + actualScore(b, a) === 1
 * — which is what keeps the whole GP zero-sum.
 */
export function actualScore(
  pointsA: number,
  pointsB: number,
  marginWeight: number = MARGIN_WEIGHT,
): number {
  if (pointsA === pointsB) return 0.5
  const margin = Math.min(Math.abs(pointsA - pointsB) / POINTS_SPREAD, 1)
  const credit = 0.5 * (1 - marginWeight + marginWeight * margin)
  return pointsA > pointsB ? 0.5 + credit : 0.5 - credit
}

export function computeGpElo(
  participants: GpParticipant[],
  options: EloOptions = {},
): EloUpdate[] {
  if (participants.length < 2) {
    throw new Error('computeGpElo requires at least 2 participants')
  }
  if (new Set(participants.map((p) => p.playerId)).size !== participants.length) {
    throw new Error('computeGpElo requires unique playerIds')
  }

  const { k, marginWeight = MARGIN_WEIGHT } = options
  const n = participants.length

  return participants.map((player) => {
    let sum = 0
    for (const opponent of participants) {
      if (opponent.playerId === player.playerId) continue
      sum +=
        actualScore(player.points, opponent.points, marginWeight) -
        expectedScore(player.rating, opponent.rating)
    }

    // Each player uses their own K, so a provisional player can move further
    // in a GP than the settled players they raced. That makes a GP no longer
    // exactly zero-sum when the field mixes new and settled players — an
    // accepted tradeoff for letting new ratings settle quickly.
    const playerK = k ?? kFactorFor(player.gpCount)

    // Rounded to a whole number so ratings always display/store as integers
    // (eloAfter is derived from the rounded delta, not rounded separately,
    // so eloAfter - eloBefore === eloDelta stays exact).
    const eloDelta = Math.round((playerK / (n - 1)) * sum)

    return {
      playerId: player.playerId,
      eloBefore: player.rating,
      eloAfter: player.rating + eloDelta,
      eloDelta,
    }
  })
}
