import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { rosterFromHistory, formatGpDate, type GrandPrix } from '../lib/history'
import { loadHistory } from '../lib/loadHistory'
import { headToHead } from '../lib/stats'
import PageHeader from '../components/PageHeader'

const UNSELECTED = ''

function Bar({ left, right }: { left: number; right: number }) {
  const total = left + right
  const leftShare = total === 0 ? 50 : (left / total) * 100

  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-pit-hi">
      <div className="bg-p2" style={{ width: `${leftShare}%` }} />
      <div className="bg-p1" style={{ width: `${100 - leftShare}%` }} />
    </div>
  )
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="panel p-4 text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">{label}</p>
      <p className={`mt-2 font-mono text-2xl ${tone || 'text-chalk'}`}>{value}</p>
    </div>
  )
}

export default function HeadToHead() {
  const [history, setHistory] = useState<GrandPrix[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Kept in the URL so a matchup can be linked straight into the group chat.
  const [searchParams, setSearchParams] = useSearchParams()
  const aId = searchParams.get('a') ?? UNSELECTED
  const bId = searchParams.get('b') ?? UNSELECTED

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

  const roster = useMemo(() => rosterFromHistory(history), [history])
  const record = useMemo(
    () => (aId && bId ? headToHead(history, aId, bId) : null),
    [history, aId, bId],
  )

  const nameOf = (id: string) => roster.find((p) => p.id === id)?.name ?? ''

  function select(side: 'a' | 'b', value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === UNSELECTED) next.delete(side)
    else next.set(side, value)
    setSearchParams(next, { replace: true })
  }

  function swap() {
    const next = new URLSearchParams()
    if (bId) next.set('a', bId)
    if (aId) next.set('b', aId)
    setSearchParams(next, { replace: true })
  }

  const bothPicked = aId !== UNSELECTED && bId !== UNSELECTED
  const samePlayer = bothPicked && aId === bId

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader
        title="Head to head"
        subtitle="Two racers, every grand prix they've both been in."
      />

      {error && (
        <p className="panel border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          The record didn't load: {error}
        </p>
      )}

      {!error && loading && <p className="text-sm text-haze">Loading results…</p>}

      {!error && !loading && roster.length < 2 && (
        <div className="panel p-6 text-center">
          <p className="font-display text-lg font-bold text-chalk">Not enough racing yet</p>
          <p className="mt-1 text-sm text-haze">
            Head-to-head records start once two racers have shared a grand prix.
          </p>
        </div>
      )}

      {!error && !loading && roster.length >= 2 && (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <label className="block">
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
                Racer
              </span>
              <select
                className="field mt-2"
                value={aId}
                onChange={(e) => select('a', e.target.value)}
                aria-label="First racer"
              >
                <option value={UNSELECTED}>Pick a racer</option>
                {roster.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={swap}
              className="h-11 w-11 shrink-0 rounded-lg border border-line text-haze transition-colors hover:border-haze hover:text-chalk"
              aria-label="Swap the two racers"
              title="Swap"
            >
              ⇄
            </button>

            <label className="block">
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
                Against
              </span>
              <select
                className="field mt-2"
                value={bId}
                onChange={(e) => select('b', e.target.value)}
                aria-label="Second racer"
              >
                <option value={UNSELECTED}>Pick a racer</option>
                {roster.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!bothPicked && (
            <p className="mt-6 text-sm text-haze">Pick two racers to see their record.</p>
          )}

          {samePlayer && (
            <p className="mt-6 text-sm text-haze">
              That's the same racer twice. Pick someone for them to race.
            </p>
          )}

          {bothPicked && !samePlayer && !record && (
            <div className="panel mt-6 p-6 text-center">
              <p className="font-display text-lg font-bold text-chalk">Never raced together</p>
              <p className="mt-1 text-sm text-haze">
                {nameOf(aId)} and {nameOf(bId)} haven't been in the same grand prix yet.
              </p>
            </div>
          )}

          {record && (
            <>
              <div className="panel mt-6 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    to={`/player/${aId}`}
                    className="truncate font-display text-lg font-bold text-chalk hover:text-gold"
                  >
                    {nameOf(aId)}
                  </Link>
                  <span className="shrink-0 font-mono text-2xl text-chalk">
                    {record.wins}–{record.losses}
                    {record.ties > 0 ? `–${record.ties}` : ''}
                  </span>
                  <Link
                    to={`/player/${bId}`}
                    className="truncate text-right font-display text-lg font-bold text-chalk hover:text-gold"
                  >
                    {nameOf(bId)}
                  </Link>
                </div>

                <div className="mt-3">
                  <Bar left={record.wins} right={record.losses} />
                </div>

                <p className="mt-3 text-center text-xs text-haze">
                  {record.meetings.length} grand prix together
                  {record.ties > 0 && `, ${record.ties} tied`}
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat
                  label="Net Elo"
                  value={`${record.netElo > 0 ? '+' : ''}${record.netElo}`}
                  tone={
                    record.netElo > 0
                      ? 'text-boost'
                      : record.netElo < 0
                        ? 'text-spin'
                        : 'text-haze'
                  }
                />
                <Stat label="Points for" value={`${record.pointsFor}`} />
                <Stat
                  label="Points against"
                  value={`${record.pointsAgainst}`}
                />
              </div>

              <p className="mt-3 text-xs text-haze">
                Net Elo is the share of every shared grand prix's rating change that came from this
                pair alone: {nameOf(aId)} has{' '}
                {record.netElo >= 0 ? 'taken' : 'given up'} {Math.abs(record.netElo)} point
                {Math.abs(record.netElo) === 1 ? '' : 's'}{' '}
                {record.netElo >= 0 ? 'off' : 'to'} {nameOf(bId)}.
              </p>

              <h2 className="mt-8 font-display text-lg font-bold uppercase tracking-tight text-chalk">
                Every meeting
              </h2>
              <ol className="panel mt-3 divide-y divide-line">
                {[...record.meetings].reverse().map((meeting) => {
                  const won = meeting.points > meeting.opponentPoints
                  const tied = meeting.points === meeting.opponentPoints
                  return (
                    <li
                      key={meeting.grandPrixId}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3"
                    >
                      <span className="w-14 shrink-0 text-xs text-haze">
                        {formatGpDate(meeting.playedAt)}
                      </span>
                      <span className="text-center font-mono text-sm">
                        <span className={won ? 'text-boost' : tied ? 'text-haze' : 'text-chalk'}>
                          {meeting.points}
                        </span>
                        <span className="mx-2 text-haze">–</span>
                        <span className={!won && !tied ? 'text-boost' : 'text-chalk'}>
                          {meeting.opponentPoints}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 font-mono text-xs ${
                          meeting.eloSwing > 0 ? 'text-boost' : 'text-spin'
                        }`}
                      >
                        {meeting.eloSwing > 0 ? '+' : ''}
                        {meeting.eloSwing.toFixed(1)}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </>
      )}
    </div>
  )
}
