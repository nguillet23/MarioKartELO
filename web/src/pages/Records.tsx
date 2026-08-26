import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatGpDate, type GrandPrix } from '../lib/history'
import { loadHistory } from '../lib/loadHistory'
import { buildRecordsBook } from '../lib/stats'
import PageHeader from '../components/PageHeader'

/** "0.20 win probability" reads as "5:1 against" — the group chat's language. */
function oddsAgainst(expected: number): string {
  return `${((1 - expected) / expected).toFixed(1)}:1`
}

function RecordCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: React.ReactNode
}) {
  return (
    <div className="panel p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">{label}</p>
      <p className="mt-2 font-mono text-2xl leading-none text-chalk">{value}</p>
      {detail && <p className="mt-1.5 text-xs text-haze">{detail}</p>}
    </div>
  )
}

function PlayerLink({ id, name }: { id: string; name: string }) {
  return (
    <Link to={`/player/${id}`} className="text-chalk hover:text-gold">
      {name}
    </Link>
  )
}

export default function Records() {
  const [history, setHistory] = useState<GrandPrix[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const book = useMemo(() => buildRecordsBook(history), [history])

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader title="Records" subtitle="Every all-time superlative, scanned from the history." />

      {error && (
        <p className="panel border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          The records book didn't load: {error}
        </p>
      )}

      {!error && loading && <p className="text-sm text-haze">Loading records…</p>}

      {!error && !loading && history.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="font-display text-lg font-bold text-chalk">No races on record</p>
          <p className="mt-1 text-sm text-haze">Records start as soon as the first grand prix is in.</p>
        </div>
      )}

      {!error && !loading && history.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {book.highestPoints && (
            <RecordCard
              label="Highest single GP"
              value={`${book.highestPoints.value} pts`}
              detail={
                <>
                  <PlayerLink id={book.highestPoints.playerId} name={book.highestPoints.playerName} />
                  {' · '}
                  {formatGpDate(book.highestPoints.playedAt)}
                </>
              }
            />
          )}

          {book.worstPoints && (
            <RecordCard
              label="Worst single GP"
              value={`${book.worstPoints.value} pts`}
              detail={
                <>
                  <PlayerLink id={book.worstPoints.playerId} name={book.worstPoints.playerName} />
                  {' · '}
                  {formatGpDate(book.worstPoints.playedAt)}
                </>
              }
            />
          )}

          {book.biggestSwing && (
            <RecordCard
              label="Biggest Elo swing"
              value={`${book.biggestSwing.value > 0 ? '+' : ''}${book.biggestSwing.value}`}
              detail={
                <>
                  <PlayerLink id={book.biggestSwing.playerId} name={book.biggestSwing.playerName} />
                  {' · '}
                  {formatGpDate(book.biggestSwing.playedAt)}
                </>
              }
            />
          )}

          {book.longestStreak && book.longestStreak.length > 0 && (
            <RecordCard
              label="Longest win streak"
              value={`${book.longestStreak.length} ${book.longestStreak.length === 1 ? 'GP' : 'GPs'}`}
              detail={<PlayerLink id={book.longestStreak.playerId} name={book.longestStreak.playerName} />}
            />
          )}

          {book.biggestUpset && (
            <RecordCard
              label="Biggest upset"
              value={oddsAgainst(book.biggestUpset.expected)}
              detail={
                <>
                  <PlayerLink id={book.biggestUpset.playerId} name={book.biggestUpset.playerName} /> over{' '}
                  {book.biggestUpset.opponentName} · {formatGpDate(book.biggestUpset.playedAt)}
                </>
              }
            />
          )}

          {book.closestGp && (
            <RecordCard
              label="Closest GP"
              value={`${book.closestGp.spread} pt spread`}
              detail={formatGpDate(book.closestGp.playedAt)}
            />
          )}

          {book.biggestBlowout && (
            <RecordCard
              label="Worst blowout"
              value={`${book.biggestBlowout.spread} pt spread`}
              detail={formatGpDate(book.biggestBlowout.playedAt)}
            />
          )}

          {book.biggestNight && (
            <RecordCard
              label="Most GPs in one night"
              value={`${book.biggestNight.count}`}
              detail={formatGpDate(`${book.biggestNight.date}T00:00:00Z`)}
            />
          )}
        </div>
      )}
    </div>
  )
}
