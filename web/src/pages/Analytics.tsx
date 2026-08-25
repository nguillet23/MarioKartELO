import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabaseClient'

const LINE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#4338ca',
  '#ea580c',
  '#0d9488',
  '#9333ea',
]

interface PlayerStatsRow {
  id: string
  name: string
  elo: number
  gp_count: number
  total_points: number
  avg_points: number
}

interface PlayerRaw {
  id: string
  name: string
}

interface GpResultRaw {
  player_id: string
  elo_after: number
  grand_prix: { played_at: string } | null
}

type ChartRow = Record<string, number>
type ChartMode = 'elo' | 'rank'

function buildChartData(results: GpResultRaw[], nameById: Map<string, string>) {
  const seriesByPlayer = new Map<string, { t: string; elo: number }[]>()
  const timestampSet = new Set<string>()

  for (const r of results) {
    const t = r.grand_prix?.played_at
    if (!t) continue
    timestampSet.add(t)
    const list = seriesByPlayer.get(r.player_id) ?? []
    list.push({ t, elo: r.elo_after })
    seriesByPlayer.set(r.player_id, list)
  }

  const timestamps = [...timestampSet].sort()

  const eloRows: ChartRow[] = []
  const rankRows: ChartRow[] = []
  const latestElo = new Map<string, number>()

  timestamps.forEach((t, i) => {
    const eloRow: ChartRow = { seq: i + 1 }
    for (const [playerId, series] of seriesByPlayer) {
      const name = nameById.get(playerId)
      if (!name) continue
      const match = series.find((s) => s.t === t)
      if (match) {
        eloRow[name] = match.elo
        latestElo.set(playerId, match.elo)
      }
    }
    eloRows.push(eloRow)

    const ranked = [...latestElo.entries()].sort((a, b) => b[1] - a[1])
    const rankRow: ChartRow = { seq: i + 1 }
    ranked.forEach(([playerId], idx) => {
      const name = nameById.get(playerId)
      if (name) rankRow[name] = idx + 1
    })
    rankRows.push(rankRow)
  })

  return { eloRows, rankRows }
}

function MiniLeaderboard({
  title,
  rows,
  formatValue,
}: {
  title: string
  rows: { name: string; value: number }[]
  formatValue: (value: number) => string
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      <ol className="mt-2 flex flex-col gap-1 text-sm">
        {rows.map((row, index) => (
          <li key={row.name} className="flex justify-between border-b border-gray-100 py-1">
            <span>
              <span className="mr-2 text-gray-400">{index + 1}</span>
              {row.name}
            </span>
            <span className="font-medium">{formatValue(row.value)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function Analytics() {
  const [stats, setStats] = useState<PlayerStatsRow[]>([])
  const [playerNames, setPlayerNames] = useState<string[]>([])
  const [eloRows, setEloRows] = useState<ChartRow[]>([])
  const [rankRows, setRankRows] = useState<ChartRow[]>([])
  const [mode, setMode] = useState<ChartMode>('elo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    const [statsRes, playersRes, resultsRes] = await Promise.all([
      supabase.from('player_stats').select('id, name, elo, gp_count, total_points, avg_points'),
      supabase.from('players').select('id, name').gt('gp_count', 0),
      supabase
        .from('gp_results')
        .select('player_id, elo_after, grand_prix(played_at)')
        .order('played_at', { referencedTable: 'grand_prix', ascending: true }),
    ])

    const firstError = statsRes.error ?? playersRes.error ?? resultsRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const players = (playersRes.data ?? []) as PlayerRaw[]
    const nameById = new Map(players.map((p) => [p.id, p.name]))
    const results = (resultsRes.data ?? []) as unknown as GpResultRaw[]
    const { eloRows: nextEloRows, rankRows: nextRankRows } = buildChartData(results, nameById)

    setStats((statsRes.data ?? []) as PlayerStatsRow[])
    setPlayerNames(players.map((p) => p.name))
    setEloRows(nextEloRows)
    setRankRows(nextRankRows)
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetching from Supabase on mount, the standard data-fetch-in-effect pattern
    loadData()

    const channel = supabase
      .channel('analytics-players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
        loadData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const chartRows = mode === 'elo' ? eloRows : rankRows
  const maxRank = playerNames.length

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Analytics</h1>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          Couldn't load analytics: {error}
        </p>
      )}

      {!error && loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {!error && !loading && chartRows.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">No results yet — submit a GP to get started.</p>
      )}

      {!error && !loading && chartRows.length > 0 && (
        <>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => setMode('elo')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                mode === 'elo' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              Elo over time
            </button>
            <button
              type="button"
              onClick={() => setMode('rank')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                mode === 'rank' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              Rank over time
            </button>
          </div>

          <div className="mt-4 h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="seq" tickLine={false} label={{ value: 'GP #', position: 'insideBottom', offset: -4 }} />
                <YAxis
                  allowDecimals={false}
                  reversed={mode === 'rank'}
                  domain={mode === 'rank' ? [1, maxRank] : ['auto', 'auto']}
                />
                <Tooltip />
                <Legend />
                {playerNames.map((name, index) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={LINE_COLORS[index % LINE_COLORS.length]}
                    connectNulls
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <MiniLeaderboard
              title="Elo"
              rows={[...stats]
                .sort((a, b) => b.elo - a.elo)
                .map((s) => ({ name: s.name, value: s.elo }))}
              formatValue={(v) => `${v}`}
            />
            <MiniLeaderboard
              title="Points"
              rows={[...stats]
                .sort((a, b) => b.total_points - a.total_points)
                .map((s) => ({ name: s.name, value: s.total_points }))}
              formatValue={(v) => `${v}`}
            />
            <MiniLeaderboard
              title="Avg Points / GP"
              rows={[...stats]
                .sort((a, b) => b.avg_points - a.avg_points)
                .map((s) => ({ name: s.name, value: s.avg_points }))}
              formatValue={(v) => v.toFixed(1)}
            />
          </div>
        </>
      )}
    </div>
  )
}
