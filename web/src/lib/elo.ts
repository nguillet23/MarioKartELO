// Pairwise multiplayer Elo — see PLAN.md §5 for the design this implements.

/**
 * K for a settled player — the single knob that sets how far a grand prix can
 * move a rating. At 16, a clean 4-player sweep is worth about +7 and a normal
 * win about +5; halving it halves both.
 */
export const DEFAULT_K = 16
/**
 * K for a brand-new player, tapering down to DEFAULT_K over their first GPs.
 * Kept at 1.5× DEFAULT_K — scale the two together or new players stop settling
 * faster than everyone else, which is the whole point of the taper.
 */
export const PROVISIONAL_K = 24
/** How many GPs a player stays provisional for. */
export const PROVISIONAL_GP_COUNT = 5
/**
 * Where a new player's rating starts.
 *
 * The database is the real source of this default (`players.elo` in
 * `supabase/migrations/0001_init.sql`) — new rows never come from here. Change
 * both together, and shift every existing rating by the difference, or players
 * created after the change enter below the field they're rated against.
 */
export const STARTING_ELO = 100
/**
 * No rating ever goes below this. Enforced here in `computeGpElo` and backed by
 * a check constraint on `players.elo`, so a bad client can't write past it.
 *
 * A floor is not free: a clamped player loses less than the field gained off
 * them, so that GP quietly creates rating out of nothing. That's fine as a rare
 * safety net and corrosive as a routine event — which is what RATING_SCALE is
 * sized to prevent.
 */
export const MIN_ELO = 0
/**
 * The scale's unit: a gap of this many points means 10:1 odds. Standard Elo
 * uses 400 against a 1500 base; this is the same ratio against a 100 base.
 *
 * It has to move with STARTING_ELO. Left at 400 on a 100-point base, ratings
 * would need to spread ~150 points apart before the math stopped pushing them
 * further — simulating a settled 4-player group lands at [517, 336, 184, 0],
 * with the last player pinned on the floor permanently. At 80 the same group
 * settles around [152, 115, 84, 44] and the floor never comes into it.
 */
export const RATING_SCALE = 80

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

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / RATING_SCALE))
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
    const rawDelta = Math.round((playerK / (n - 1)) * sum)

    // The floor is applied to the rating and the delta is re-derived from it,
    // never the other way round: `void_last_gp` undoes a GP by subtracting
    // elo_delta back off, so a delta that didn't match what was actually
    // applied would roll a clamped player back to a rating they never held.
    const eloAfter = Math.max(MIN_ELO, player.rating + rawDelta)

    return {
      playerId: player.playerId,
      eloBefore: player.rating,
      eloAfter,
      eloDelta: eloAfter - player.rating,
    }
  })
}

/**
 * The share of one player's GP rating change that came from a single opponent.
 *
 * `computeGpElo` sums `actualScore - expectedScore` across the whole field and
 * scales the total once; this is the same expression for one opponent only, so
 * summing it over every opponent reproduces that player's delta (before the
 * final rounding). That's what makes "net Elo between just these two" a real
 * number rather than an approximation — see `headToHead` in `stats.ts`.
 *
 * Deliberately kept as a separate function rather than folded back into
 * `computeGpElo`: the rated algorithm rounds once, at the end, and splitting
 * its multiply across the sum could move a knife-edge delta by a point.
 * Returned unrounded — round only after summing across GPs.
 *
 * One exception to that reconstruction: in a GP where a player hit MIN_ELO,
 * these terms add up to what the matchups were worth *before* the floor
 * truncated the loss, so they'll overstate what the player actually paid.
 */
export function pairwiseEloExchange(
  player: { rating: number; points: number; gpCount: number },
  opponent: { rating: number; points: number },
  fieldSize: number,
  options: EloOptions = {},
): number {
  if (fieldSize < 2) throw new Error('pairwiseEloExchange requires a field of at least 2')

  const { k, marginWeight = MARGIN_WEIGHT } = options
  const playerK = k ?? kFactorFor(player.gpCount)

  return (
    (playerK / (fieldSize - 1)) *
    (actualScore(player.points, opponent.points, marginWeight) -
      expectedScore(player.rating, opponent.rating))
  )
}
