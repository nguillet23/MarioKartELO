import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface LeaderboardRow {
  id: string
  name: string
  elo: number
  gpCount: number
  lastDelta: number | null
}

interface PlayerRaw {
  id: string
  name: string
  elo: number
  gp_count: number
}

interface GpResultRaw {
  player_id: string
  elo_delta: number
  grand_prix: { played_at: string } | null
}

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadLeaderboard() {
    const [playersRes, resultsRes] = await Promise.all([
      supabase
        .from('players')
        .select('id, name, elo, gp_count')
        .gt('gp_count', 0)
        .order('elo', { ascending: false }),
      supabase
        .from('gp_results')
        .select('player_id, elo_delta, grand_prix(played_at)')
        .order('played_at', { referencedTable: 'grand_prix', ascending: false }),
    ])

    if (playersRes.error) {
      setError(playersRes.error.message)
      setLoading(false)
      return
    }
    if (resultsRes.error) {
      setError(resultsRes.error.message)
      setLoading(false)
      return
    }

    const lastDeltaByPlayer = new Map<string, number>()
    for (const r of (resultsRes.data ?? []) as unknown as GpResultRaw[]) {
      if (!lastDeltaByPlayer.has(r.player_id)) {
        lastDeltaByPlayer.set(r.player_id, r.elo_delta)
      }
    }

    setRows(
      ((playersRes.data ?? []) as PlayerRaw[]).map((p) => ({
        id: p.id,
        name: p.name,
        elo: p.elo,
        gpCount: p.gp_count,
        lastDelta: lastDeltaByPlayer.get(p.id) ?? null,
      })),
    )
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetching from Supabase on mount, the standard data-fetch-in-effect pattern
    loadLeaderboard()

    const channel = supabase
      .channel('leaderboard-players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
        loadLeaderboard()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Leaderboard</h1>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          Couldn't load the leaderboard: {error}
        </p>
      )}

      {!error && loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {!error && !loading && rows.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">No results yet — submit a GP to get started.</p>
      )}

      {!error && !loading && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">Name</th>
                <th className="py-2 pr-2 font-medium">Elo</th>
                <th className="py-2 pr-2 font-medium">GPs</th>
                <th className="py-2 pr-2 font-medium">Last Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="border-b border-gray-100">
                  <td className="py-2 pr-2 text-gray-400">{index + 1}</td>
                  <td className="py-2 pr-2 font-medium">{row.name}</td>
                  <td className="py-2 pr-2">{row.elo}</td>
                  <td className="py-2 pr-2">{row.gpCount}</td>
                  <td
                    className={
                      row.lastDelta === null
                        ? 'py-2 pr-2 text-gray-400'
                        : row.lastDelta > 0
                          ? 'py-2 pr-2 text-green-600'
                          : row.lastDelta < 0
                            ? 'py-2 pr-2 text-red-600'
                            : 'py-2 pr-2 text-gray-500'
                    }
                  >
                    {row.lastDelta === null
                      ? '—'
                      : `${row.lastDelta > 0 ? '+' : ''}${row.lastDelta}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
