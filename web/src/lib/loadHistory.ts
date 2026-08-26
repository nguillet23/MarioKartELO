// The one database read behind every derived-stats feature.
//
// Split out from `history.ts` so that module stays importable without env
// vars: `supabaseClient` throws at module load when they're missing, which
// would otherwise take the pure `stats.ts`/`history.ts` unit tests down with
// it in any environment that has no credentials (CI runs them before the
// build step that holds the secrets).

import { supabase } from './supabaseClient'
import { groupIntoGrandPrix, type GpResultRow, type GrandPrix } from './history'

/** Every grand prix ever played, oldest first. */
export async function loadHistory(): Promise<GrandPrix[]> {
  const { data, error } = await supabase
    .from('gp_results')
    .select(
      'grand_prix_id, player_id, points, elo_before, elo_after, elo_delta, grand_prix(played_at), players(name)',
    )

  if (error) throw new Error(error.message)
  return groupIntoGrandPrix((data ?? []) as unknown as GpResultRow[])
}
