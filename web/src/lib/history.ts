// The shape of the full result history, reused by every derived-stats feature
// (head-to-head, streaks, personal bests, profiles, recaps).
//
// `gp_results` already holds everything those need — points and the exact
// rating each player carried into and out of every grand prix — so none of
// them need a schema change, just one read and the pure functions in
// `stats.ts`.
//
// Deliberately imports nothing: the read itself lives in `loadHistory.ts`,
// because `supabaseClient` throws at module load when its env vars are unset.
// Importing it here would make every pure function below unusable without
// database credentials — which is what broke the unit tests in CI, where the
// test step runs before the build step that has the secrets.

export interface GpEntry {
  playerId: string
  playerName: string
  points: number
  eloBefore: number
  eloAfter: number
  eloDelta: number
  /** Finishing position within this GP. Equal scores share a place (1, 2, 2, 4). */
  rank: number
}

export interface GrandPrix {
  id: string
  playedAt: string
  /** Highest points first. */
  entries: GpEntry[]
}

/** One `gp_results` row with its two to-one embeds, as PostgREST returns it. */
export interface GpResultRow {
  grand_prix_id: string
  player_id: string
  points: number
  elo_before: number
  elo_after: number
  elo_delta: number
  grand_prix: { played_at: string } | null
  players: { name: string } | null
}

/**
 * Groups flat `gp_results` rows into grand prix, oldest first.
 *
 * Sorted here rather than in the query for the same reason the Leaderboard
 * does it: PostgREST's `order` on a to-one embed (`grand_prix`) sorts within
 * the embed, not across rows, so asking the server for this is a no-op.
 */
export function groupIntoGrandPrix(rows: GpResultRow[]): GrandPrix[] {
  const byGp = new Map<string, GrandPrix>()

  for (const row of rows) {
    const playedAt = row.grand_prix?.played_at
    if (!playedAt) continue

    const gp = byGp.get(row.grand_prix_id) ?? { id: row.grand_prix_id, playedAt, entries: [] }
    gp.entries.push({
      playerId: row.player_id,
      playerName: row.players?.name ?? 'Unknown',
      points: row.points,
      eloBefore: Number(row.elo_before),
      eloAfter: Number(row.elo_after),
      eloDelta: Number(row.elo_delta),
      rank: 0,
    })
    byGp.set(row.grand_prix_id, gp)
  }

  const history = [...byGp.values()].sort(
    (a, b) => a.playedAt.localeCompare(b.playedAt) || a.id.localeCompare(b.id),
  )

  for (const gp of history) {
    gp.entries.sort((a, b) => b.points - a.points || a.playerName.localeCompare(b.playerName))

    let lastPoints: number | null = null
    let lastRank = 0
    gp.entries.forEach((entry, index) => {
      if (entry.points !== lastPoints) {
        lastRank = index + 1
        lastPoints = entry.points
      }
      entry.rank = lastRank
    })
  }

  return history
}

/** Everyone who has raced at least once, by display name. */
export function rosterFromHistory(history: GrandPrix[]): { id: string; name: string }[] {
  const names = new Map<string, string>()
  for (const gp of history) {
    for (const entry of gp.entries) names.set(entry.playerId, entry.playerName)
  }
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Short date for a GP, e.g. "Aug 25". Year included once it isn't this one. */
export function formatGpDate(playedAt: string): string {
  const date = new Date(playedAt)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
