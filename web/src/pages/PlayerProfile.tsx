import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatGpDate, rosterFromHistory, type GrandPrix } from '../lib/history'
import { loadHistory } from '../lib/loadHistory'
import {
  achievementsFor,
  consistencyRankings,
  entryFor,
  opponentRecords,
  playerBests,
  pointsConsistency,
  rivalOf,
  streaksFor,
  windowGpsFor,
  windowHistory,
  WINDOW_OPTIONS,
  type StatsWindow,
} from '../lib/stats'
import PageHeader from '../components/PageHeader'
import Ordinal from '../components/Ordinal'
import RacerBadge from '../components/RacerBadge'
import { ArrowUpIcon, RepeatIcon, SparkleIcon } from '../components/BadgeIcons'
import { StarIcon, TrendIcon, VersusIcon } from '../components/NavIcons'

/** One icon per achievement id — see `achievementsFor` in lib/stats.ts for what each one means. */
const ACHIEVEMENT_ICONS: Record<string, (props: { className?: string }) => ReactElement> = {
  'first-win': SparkleIcon,
  regular: RepeatIcon,
  'giant-slayer': VersusIcon,
  clutch: ArrowUpIcon,
  sweep: StarIcon,
}

function AchievementChip({
  id,
  label,
  description,
  unlockedAt,
}: {
  id: string
  label: string
  description: string
  unlockedAt: string | null
}) {
  const earned = unlockedAt !== null
  const Icon = ACHIEVEMENT_ICONS[id] ?? TrendIcon
  return (
    <span
      className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${
        earned ? 'border-gold/40 bg-gold/10 text-gold' : 'border-line bg-pit-hi text-haze/60'
      }`}
      title={earned ? `${description} — ${formatGpDate(unlockedAt)}` : description}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  )
}

const AXIS_COLOR = '#90a0c9'
const GRID_COLOR = '#28406e'
const GOLD = '#ffc42b'

function Stat({
  label,
  value,
  hint,
  tone = 'text-chalk',
}: {
  label: string
  value: string
  hint?: string
  tone?: string
}) {
  return (
    <div className="panel p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">{label}</p>
      <p className={`mt-2 font-mono text-2xl leading-none ${tone}`}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-haze">{hint}</p>}
    </div>
  )
}

function Delta({ value }: { value: number }) {
  const tone = value > 0 ? 'text-boost' : value < 0 ? 'text-spin' : 'text-haze'
  return (
    <span className={`font-mono ${tone}`}>
      {value > 0 ? '+' : ''}
      {value}
    </span>
  )
}

export default function PlayerProfile() {
  const { playerId = '' } = useParams()
  const [history, setHistory] = useState<GrandPrix[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statsWindow, setStatsWindow] = useState<StatsWindow>(WINDOW_OPTIONS[0].window)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetching from Supabase on mount, the standard data-fetch-in-effect pattern
    loadHistory()
      .then((next) => {
        setHistory(next)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const name = useMemo(
    () => rosterFromHistory(history).find((p) => p.id === playerId)?.name ?? '',
    [history, playerId],
  )
  const bests = useMemo(() => playerBests(history, playerId), [history, playerId])
  const streaks = useMemo(() => streaksFor(history, playerId), [history, playerId])
  const rival = useMemo(() => rivalOf(history, playerId), [history, playerId])
  const opponents = useMemo(() => opponentRecords(history, playerId), [history, playerId])
  const consistency = useMemo(() => pointsConsistency(history, playerId), [history, playerId])
  const consistencyTag = useMemo(() => {
    const rankings = consistencyRankings(history)
    if (rankings.length < 2) return null
    if (rankings[0].playerId === playerId) return 'Most consistent'
    if (rankings[rankings.length - 1].playerId === playerId) return 'Most volatile'
    return null
  }, [history, playerId])

  const achievements = useMemo(() => achievementsFor(history, playerId), [history, playerId])

  const windowedGps = useMemo(
    () => windowGpsFor(history, playerId, statsWindow),
    [history, playerId, statsWindow],
  )
  const windowedSummary = useMemo(() => {
    if (windowedGps.length === 0) return null
    const points = windowedGps.map((gp) => entryFor(gp, playerId)!.points)
    const eloChange = windowedGps.reduce((sum, gp) => sum + entryFor(gp, playerId)!.eloDelta, 0)
    return {
      gpCount: windowedGps.length,
      totalPoints: points.reduce((sum, p) => sum + p, 0),
      avgPoints: points.reduce((sum, p) => sum + p, 0) / points.length,
      eloChange,
    }
  }, [windowedGps, playerId])

  // The whole-history rating line, carrying the rating flat (delta 0) across
  // any GP the player sat out, so the chart never skips or gaps — it starts
  // once they've raced their first GP and stays continuous from there.
  const chartRows = useMemo(() => {
    let currentElo: number | null = null
    const series: { gp: GrandPrix; elo: number; played: boolean }[] = []
    for (const gp of history) {
      const entry = entryFor(gp, playerId)
      if (entry) currentElo = entry.eloAfter
      if (currentElo === null) continue
      series.push({ gp, elo: currentElo, played: entry !== undefined })
    }

    let windowed = series
    if (statsWindow.kind === 'lastN') {
      const playedIdx = series.reduce<number[]>((acc, row, index) => {
        if (row.played) acc.push(index)
        return acc
      }, [])
      const start =
        playedIdx.length >= statsWindow.n ? playedIdx[playedIdx.length - statsWindow.n] : 0
      windowed = series.slice(start)
    } else if (statsWindow.kind !== 'all') {
      const inWindow = new Set(windowHistory(history, statsWindow).map((gp) => gp.id))
      windowed = series.filter((row) => inWindow.has(row.gp.id))
    }

    return windowed.map((row, index) => ({
      seq: index + 1,
      elo: row.elo,
      playedAt: row.gp.playedAt,
    }))
  }, [history, playerId, statsWindow])

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-8">
        <p className="panel border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          This profile didn't load: {error}
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-8">
        <p className="text-sm text-haze">Loading profile…</p>
      </div>
    )
  }

  if (!bests) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-8">
        <div className="panel p-6 text-center">
          <p className="font-display text-lg font-bold text-chalk">No racer here</p>
          <p className="mt-1 text-sm text-haze">
            Nobody by that id has finished a grand prix.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-gold px-4 py-2.5 text-sm font-bold text-asphalt"
          >
            Back to the standings
          </Link>
        </div>
      </div>
    )
  }

  const recentGps = [...windowedGps].reverse().slice(0, 10)

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader
        title={name}
        subtitle={`${bests.gpCount} grand prix, ${bests.wins} won.`}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Rating"
          value={`${bests.currentElo}`}
          hint={bests.atPeakNow ? 'All-time high' : `Peak ${bests.peakElo}`}
          tone={bests.atPeakNow ? 'text-gold' : 'text-chalk'}
        />
        <Stat
          label="Streak"
          value={streaks.current > 0 ? `${streaks.current}W` : '—'}
          hint={streaks.longest > 0 ? `Longest ${streaks.longest}` : 'No wins yet'}
          tone={streaks.current > 0 ? 'text-boost' : 'text-haze'}
        />
        <Stat
          label="Best GP"
          value={`${bests.bestPoints}`}
          hint={bests.bestPointsAt ? formatGpDate(bests.bestPointsAt) : undefined}
        />
        <Stat label="Worst GP" value={`${bests.worstPoints}`} />
        {consistency && (
          <Stat
            label="Consistency"
            value={consistency.stdDev.toFixed(1)}
            hint={consistencyTag ?? 'Points std. dev.'}
            tone={consistencyTag ? 'text-gold' : 'text-chalk'}
          />
        )}
      </div>

      {rival && (
        <section className="panel mt-4 p-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">Rival</p>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <Link
              to={`/player/${rival.opponentId}`}
              className="flex items-center gap-2 font-display text-xl font-bold text-chalk hover:text-gold"
            >
              <RacerBadge id={rival.opponentId} name={rival.opponentName} />
              {rival.opponentName}
            </Link>
            <span className="font-mono text-sm text-chalk">
              {rival.wins}–{rival.losses}
              {rival.ties > 0 ? `–${rival.ties}` : ''} · <Delta value={rival.netElo} />
            </span>
          </div>
          <p className="mt-2 text-xs text-haze">
            The racer {name} has swung the most rating against, over{' '}
            {rival.meetings.length} shared grand prix.{' '}
            <Link
              to={`/head-to-head?a=${playerId}&b=${rival.opponentId}`}
              className="text-chalk underline decoration-line underline-offset-4 hover:text-gold"
            >
              See the full record
            </Link>
          </p>
        </section>
      )}

      <h2 className="mt-8 font-display text-lg font-bold uppercase tracking-tight text-chalk">
        Achievements
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {achievements.map((a) => (
          <AchievementChip
            key={a.id}
            id={a.id}
            label={a.label}
            description={a.description}
            unlockedAt={a.unlockedAt}
          />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-tight text-chalk">
          Rating history
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setStatsWindow(opt.window)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                JSON.stringify(opt.window) === JSON.stringify(statsWindow)
                  ? 'bg-gold text-asphalt'
                  : 'border border-line text-haze hover:text-chalk'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {windowedSummary && statsWindow.kind !== 'all' && (
        <p className="mt-2 text-xs text-haze">
          In this window: {windowedSummary.gpCount} {windowedSummary.gpCount === 1 ? 'GP' : 'GPs'} ·{' '}
          {windowedSummary.totalPoints} pts total ({windowedSummary.avgPoints.toFixed(1)} avg) ·{' '}
          <Delta value={windowedSummary.eloChange} /> rating
        </p>
      )}

      {!windowedSummary && (
        <p className="mt-2 text-xs text-haze">No grand prix in this window.</p>
      )}

      <div className="panel mt-3 h-56 w-full p-4 pl-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis dataKey="seq" tickLine={false} stroke={AXIS_COLOR} fontSize={12} />
            <YAxis
              allowDecimals={false}
              stroke={AXIS_COLOR}
              fontSize={12}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{
                background: '#0f1d3a',
                border: `1px solid ${GRID_COLOR}`,
                borderRadius: '0.5rem',
                fontSize: 13,
              }}
              labelFormatter={(seq) => `Grand prix ${seq}`}
              labelStyle={{ color: AXIS_COLOR }}
              formatter={(value) => [`${value}`, 'Rating']}
            />
            <Line type="monotone" dataKey="elo" stroke={GOLD} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2 className="mt-8 font-display text-lg font-bold uppercase tracking-tight text-chalk">
        Against everyone
      </h2>
      <ol className="panel mt-3 divide-y divide-line">
        {opponents.map((record) => (
          <li key={record.opponentId} className="flex items-center justify-between gap-3 px-4 py-3">
            <Link
              to={`/head-to-head?a=${playerId}&b=${record.opponentId}`}
              className="flex min-w-0 items-center gap-2 truncate font-display text-sm font-bold text-chalk hover:text-gold"
            >
              <RacerBadge id={record.opponentId} name={record.opponentName} />
              <span className="truncate">{record.opponentName}</span>
            </Link>
            <span className="flex shrink-0 items-baseline gap-3 font-mono text-sm">
              <span className="text-chalk">
                {record.wins}–{record.losses}
                {record.ties > 0 ? `–${record.ties}` : ''}
              </span>
              <Delta value={record.netElo} />
            </span>
          </li>
        ))}
      </ol>

      <h2 className="mt-8 font-display text-lg font-bold uppercase tracking-tight text-chalk">
        Recent grand prix
      </h2>
      <ol className="panel mt-3 divide-y divide-line">
        {recentGps.map((gp) => {
          const entry = entryFor(gp, playerId)!
          return (
            <li
              key={gp.id}
              className="grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 px-4 py-3"
            >
              <Ordinal rank={entry.rank} className="text-xl" />
              <span className="text-xs text-haze">
                {formatGpDate(gp.playedAt)} · {gp.entries.length} racers
              </span>
              <span className="flex items-baseline gap-3 font-mono text-sm">
                <span className="text-chalk">{entry.points} pts</span>
                <Delta value={entry.eloDelta} />
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
