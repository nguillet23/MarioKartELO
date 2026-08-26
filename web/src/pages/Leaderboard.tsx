import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { loadHistory } from '../lib/history'
import { playersAtPeak } from '../lib/stats'
import PageHeader from '../components/PageHeader'
import Ordinal from '../components/Ordinal'

interface LeaderboardRow {
  id: string
  name: string
  elo: number
  gpCount: number
  lastDelta: number | null
  rank: number
  /** Sitting at their highest rating ever, right now. */
  atPeak: boolean
}

interface PlayerRaw {
  id: string
  name: string
  elo: number
  gp_count: number
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="font-mono text-xs text-haze">—</span>

  const tone = delta > 0 ? 'text-boost' : delta < 0 ? 'text-spin' : 'text-haze'
  return (
    <span className={`font-mono text-xs ${tone}`}>
      {delta > 0 ? '+' : ''}
      {delta}
    </span>
  )
}

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadLeaderboard() {
    const playersRes = await supabase
      .from('players')
      .select('id, name, elo, gp_count')
      .gt('gp_count', 0)
      .order('elo', { ascending: false })

    if (playersRes.error) {
      setError(playersRes.error.message)
      setLoading(false)
      return
    }

    let history
    try {
      history = await loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
      return
    }

    // History comes back oldest first, so the last entry for a player is their
    // most recent grand prix.
    const lastDeltaByPlayer = new Map<string, number>()
    for (const gp of history) {
      for (const entry of gp.entries) lastDeltaByPlayer.set(entry.playerId, entry.eloDelta)
    }
    const atPeak = playersAtPeak(history)

    const players = (playersRes.data ?? []) as PlayerRaw[]
    let lastElo: number | null = null
    let lastRank = 0

    setRows(
      players.map((p, index) => {
        // Competition ranking: equal ratings share a place, and the next
        // player takes the place their position implies (1, 2, 2, 4).
        if (p.elo !== lastElo) {
          lastRank = index + 1
          lastElo = p.elo
        }
        return {
          id: p.id,
          name: p.name,
          elo: p.elo,
          gpCount: p.gp_count,
          lastDelta: lastDeltaByPlayer.get(p.id) ?? null,
          rank: lastRank,
          atPeak: atPeak.has(p.id),
        }
      }),
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
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader title="Standings" subtitle="Every racer who has finished a grand prix." />

      {error && (
        <p className="panel border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          The standings didn't load: {error}
        </p>
      )}

      {!error && loading && <p className="text-sm text-haze">Loading standings…</p>}

      {!error && !loading && rows.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="font-display text-lg font-bold text-chalk">No races on record</p>
          <p className="mt-1 text-sm text-haze">
            Standings start as soon as the first grand prix is in.
          </p>
          <Link
            to="/submit"
            className="mt-4 inline-block rounded-lg bg-gold px-4 py-2.5 text-sm font-bold text-asphalt"
          >
            Submit a grand prix
          </Link>
        </div>
      )}

      {!error && !loading && rows.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between px-4 text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
            <span>Racer</span>
            <span>Rating / last GP</span>
          </div>

          <ol className="panel divide-y divide-line overflow-hidden">
            {rows.map((row, index) => (
              <li
                key={row.id}
                className={`row-in grid grid-cols-[2.75rem_1fr_auto] items-center gap-3 px-4 py-3.5 ${
                  row.rank === 1 ? 'bg-gold/5' : ''
                }`}
                style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
              >
                <Ordinal rank={row.rank} className="text-2xl" />

                <div className="min-w-0">
                  <Link
                    to={`/player/${row.id}`}
                    className="block truncate font-display text-base font-bold text-chalk transition-colors hover:text-gold"
                  >
                    {row.name}
                  </Link>
                  <p className="flex items-center gap-2 text-xs text-haze">
                    <span>
                      {row.gpCount} {row.gpCount === 1 ? 'GP' : 'GPs'}
                    </span>
                    {row.atPeak && (
                      <span
                        className="rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold"
                        title="At their highest rating ever"
                      >
                        Peak
                      </span>
                    )}
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-mono text-lg leading-tight text-chalk">{row.elo}</p>
                  <DeltaChip delta={row.lastDelta} />
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
