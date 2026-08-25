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
import PageHeader from '../components/PageHeader'

// Mirrors the palette in index.css — Recharts sets `stroke` as an SVG
// presentation attribute, which doesn't resolve CSS custom properties.
const LINE_COLORS = [
  '#e8402a',
  '#3a86f0',
  '#ffc42b',
  '#35c15f',
  '#c084fc',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
  '#818cf8',
  '#fb923c',
  '#2dd4bf',
  '#f472b6',
]

const AXIS_COLOR = '#948cb4'
const GRID_COLOR = '#322c4a'

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

/** Rows are keyed by player *id*, never name — see the Line dataKey note below. */
type ChartRow = Record<string, number>
type ChartMode = 'elo' | 'rank'

function buildChartData(results: GpResultRaw[], knownPlayerIds: Set<string>) {
  const seriesByPlayer = new Map<string, { t: string; elo: number }[]>()
  const timestampSet = new Set<string>()

  for (const r of results) {
    const t = r.grand_prix?.played_at
    if (!t || !knownPlayerIds.has(r.player_id)) continue
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
      const match = series.find((s) => s.t === t)
      if (match) {
        eloRow[playerId] = match.elo
        latestElo.set(playerId, match.elo)
      }
    }
    eloRows.push(eloRow)

    // Rank everyone who has raced so far, not just this GP's field, so a
    // player's line holds its position through GPs they sat out.
    const ranked = [...latestElo.entries()].sort((a, b) => b[1] - a[1])
    const rankRow: ChartRow = { seq: i + 1 }
    ranked.forEach(([playerId], idx) => {
      rankRow[playerId] = idx + 1
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
  rows: { id: string; name: string; value: number }[]
  formatValue: (value: number) => string
}) {
  return (
    <section className="panel p-4">
      <h2 className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">{title}</h2>
      <ol className="mt-3 flex flex-col">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0"
          >
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span
                className={`font-mono text-xs ${index === 0 ? 'text-gold' : 'text-haze'}`}
              >
                {index + 1}
              </span>
              <span className="truncate font-display text-sm font-bold text-chalk">
                {row.name}
              </span>
            </span>
            <span className="shrink-0 font-mono text-sm text-chalk">{formatValue(row.value)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function Analytics() {
  const [stats, setStats] = useState<PlayerStatsRow[]>([])
  const [players, setPlayers] = useState<PlayerRaw[]>([])
  const [eloRows, setEloRows] = useState<ChartRow[]>([])
  const [rankRows, setRankRows] = useState<ChartRow[]>([])
  const [mode, setMode] = useState<ChartMode>('elo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    const [statsRes, playersRes, resultsRes] = await Promise.all([
      supabase.from('player_stats').select('id, name, elo, gp_count, total_points, avg_points'),
      supabase.from('players').select('id, name').gt('gp_count', 0).order('name'),
      supabase.from('gp_results').select('player_id, elo_after, grand_prix(played_at)'),
    ])

    const firstError = statsRes.error ?? playersRes.error ?? resultsRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const nextPlayers = (playersRes.data ?? []) as PlayerRaw[]
    const results = (resultsRes.data ?? []) as unknown as GpResultRaw[]
    const { eloRows: nextEloRows, rankRows: nextRankRows } = buildChartData(
      results,
      new Set(nextPlayers.map((p) => p.id)),
    )

    setStats((statsRes.data ?? []) as PlayerStatsRow[])
    setPlayers(nextPlayers)
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
  const maxRank = players.length

  const modeButtonClass = (active: boolean) =>
    `rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
      active ? 'bg-gold text-asphalt' : 'border border-line text-haze hover:text-chalk'
    }`

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <PageHeader
        title="Form guide"
        subtitle="How every rating has moved, grand prix by grand prix."
      />

      {error && (
        <p className="panel border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          The form guide didn't load: {error}
        </p>
      )}

      {!error && loading && <p className="text-sm text-haze">Loading results…</p>}

      {!error && !loading && chartRows.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="font-display text-lg font-bold text-chalk">Nothing to chart yet</p>
          <p className="mt-1 text-sm text-haze">
            Ratings start moving after the first grand prix is submitted.
          </p>
        </div>
      )}

      {!error && !loading && chartRows.length > 0 && (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('elo')}
              className={modeButtonClass(mode === 'elo')}
            >
              Rating
            </button>
            <button
              type="button"
              onClick={() => setMode('rank')}
              className={modeButtonClass(mode === 'rank')}
            >
              Position
            </button>
          </div>

          <div className="panel mt-4 h-80 w-full p-4 pl-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
                <XAxis
                  dataKey="seq"
                  tickLine={false}
                  stroke={AXIS_COLOR}
                  fontSize={12}
                  label={{
                    value: 'GRAND PRIX',
                    position: 'insideBottom',
                    offset: -8,
                    fill: AXIS_COLOR,
                    fontSize: 10,
                    letterSpacing: 2,
                  }}
                />
                <YAxis
                  allowDecimals={false}
                  stroke={AXIS_COLOR}
                  fontSize={12}
                  tickLine={false}
                  reversed={mode === 'rank'}
                  domain={mode === 'rank' ? [1, maxRank] : ['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1c1930',
                    border: `1px solid ${GRID_COLOR}`,
                    borderRadius: '0.5rem',
                    fontSize: 13,
                  }}
                  labelFormatter={(seq) => `Grand prix ${seq}`}
                  labelStyle={{ color: AXIS_COLOR }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {players.map((player, index) => (
                  // dataKey is the player id, not the name: Recharts reads a
                  // string dataKey as an object path, so a name containing a
                  // dot ("Bowser Jr.") would resolve to nothing and the line
                  // would silently vanish. `name` is what the legend shows.
                  <Line
                    key={player.id}
                    type="monotone"
                    dataKey={player.id}
                    name={player.name}
                    stroke={LINE_COLORS[index % LINE_COLORS.length]}
                    strokeWidth={2}
                    connectNulls
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MiniLeaderboard
              title="Rating"
              rows={[...stats]
                .sort((a, b) => b.elo - a.elo)
                .map((s) => ({ id: s.id, name: s.name, value: s.elo }))}
              formatValue={(v) => `${v}`}
            />
            <MiniLeaderboard
              title="Total points"
              rows={[...stats]
                .sort((a, b) => b.total_points - a.total_points)
                .map((s) => ({ id: s.id, name: s.name, value: s.total_points }))}
              formatValue={(v) => `${v}`}
            />
            <MiniLeaderboard
              title="Points per GP"
              rows={[...stats]
                .sort((a, b) => b.avg_points - a.avg_points)
                .map((s) => ({ id: s.id, name: s.name, value: s.avg_points }))}
              formatValue={(v) => Number(v).toFixed(1)}
            />
          </div>
        </>
      )}
    </div>
  )
}
