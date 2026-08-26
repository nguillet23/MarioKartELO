import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Ordinal from '../components/Ordinal'
import { formatGpDate, type GrandPrix } from '../lib/history'
import { loadHistory } from '../lib/loadHistory'
import { buildRecordsBook, sessionsFromHistory, type Session } from '../lib/stats'
import PageHeader from '../components/PageHeader'

type View = 'all-time' | 'sessions'

/** "0.20 win probability" reads as "5:1 against" — the group chat's language. */
function oddsAgainst(expected: number): string {
  return `${((1 - expected) / expected).toFixed(1)}:1`
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

function sessionDateLabel(session: Session): string {
  const start = session.startedAt.slice(0, 10)
  const end = session.endedAt.slice(0, 10)
  return start === end ? formatGpDate(session.startedAt) : `${formatGpDate(session.startedAt)} – ${formatGpDate(session.endedAt)}`
}

function SessionCard({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false)
  const winner = session.standings[0]

  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-chalk">{sessionDateLabel(session)}</p>
          <p className="mt-0.5 text-xs text-haze">
            {session.gps.length} {session.gps.length === 1 ? 'GP' : 'GPs'}
            {winner && (
              <>
                {' · '}
                <Link
                  to={`/player/${winner.playerId}`}
                  className="text-chalk hover:text-gold"
                  onClick={(e) => e.stopPropagation()}
                >
                  {winner.playerName}
                </Link>{' '}
                took the night
              </>
            )}
          </p>
        </div>
        <span className="shrink-0 text-haze">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-line">
          <ol className="divide-y divide-line">
            {session.standings.map((s) => (
              <li key={s.playerId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Ordinal rank={s.rank} className="w-8 shrink-0 text-base" />
                <Link
                  to={`/player/${s.playerId}`}
                  className="min-w-0 flex-1 truncate font-display text-sm font-bold text-chalk hover:text-gold"
                >
                  {s.playerName}
                </Link>
                <span className="flex shrink-0 items-baseline gap-3 font-mono text-sm">
                  <span className="text-chalk">{s.totalPoints} pts</span>
                  <Delta value={s.netEloDelta} />
                </span>
              </li>
            ))}
          </ol>

          <ol className="divide-y divide-line bg-pit-hi/40">
            {session.gps.map((gp) => (
              <li key={gp.id} className="px-4 py-2 text-xs text-haze">
                {formatGpDate(gp.playedAt)} ·{' '}
                {[...gp.entries]
                  .sort((a, b) => a.rank - b.rank)
                  .map((e) => `${e.playerName} ${e.points}`)
                  .join(' · ')}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
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
  const [view, setView] = useState<View>('all-time')

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
  const sessions = useMemo(() => [...sessionsFromHistory(history)].reverse(), [history])

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader
        title="Records"
        subtitle={
          view === 'all-time'
            ? 'Every all-time superlative, scanned from the history.'
            : 'Every game night, grouped by a gap in when GPs were played.'
        }
      />

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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView('all-time')}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              view === 'all-time' ? 'bg-gold text-asphalt' : 'border border-line text-haze hover:text-chalk'
            }`}
          >
            All-time
          </button>
          <button
            type="button"
            onClick={() => setView('sessions')}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              view === 'sessions' ? 'bg-gold text-asphalt' : 'border border-line text-haze hover:text-chalk'
            }`}
          >
            Sessions
          </button>
        </div>
      )}

      {!error && !loading && history.length > 0 && view === 'sessions' && (
        <div className="mt-4 flex flex-col gap-3">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}

      {!error && !loading && history.length > 0 && view === 'all-time' && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
