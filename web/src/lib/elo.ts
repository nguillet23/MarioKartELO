// Pairwise multiplayer Elo — see PLAN.md §5 for the design this implements.
// Margin-of-victory scaling is deliberately not applied yet (open decision, PLAN.md §9).

export const DEFAULT_K = 32
export const STARTING_ELO = 1500

export interface GpParticipant {
  playerId: string
  rating: number
  points: number
}

export interface EloUpdate {
  playerId: string
  eloBefore: number
  eloAfter: number
  eloDelta: number
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

function actualScore(pointsA: number, pointsB: number): number {
  if (pointsA > pointsB) return 1
  if (pointsA < pointsB) return 0
  return 0.5
}

export function computeGpElo(
  participants: GpParticipant[],
  k: number = DEFAULT_K,
): EloUpdate[] {
  if (participants.length < 2) {
    throw new Error('computeGpElo requires at least 2 participants')
  }

  const n = participants.length

  return participants.map((player) => {
    let sum = 0
    for (const opponent of participants) {
      if (opponent.playerId === player.playerId) continue
      sum +=
        actualScore(player.points, opponent.points) -
        expectedScore(player.rating, opponent.rating)
    }

    const eloDelta = (k / (n - 1)) * sum

    return {
      playerId: player.playerId,
      eloBefore: player.rating,
      eloAfter: player.rating + eloDelta,
      eloDelta,
    }
  })
}
