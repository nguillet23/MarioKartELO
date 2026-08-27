import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { rosterFromHistory, formatGpDate, type GrandPrix } from '../lib/history'
import { loadHistory } from '../lib/loadHistory'
import { headToHead, opponentRecords } from '../lib/stats'
import PageHeader from '../components/PageHeader'
import RacerBadge from '../components/RacerBadge'

const UNSELECTED = ''
type View = 'pairwise' | 'matrix'

/**
 * Every player against every other in one grid, cells shaded by net Elo
 * swing — `opponentRecords` already computes one row's whole set of
 * matchups in a single pass, so building the matrix is just that, once per
 * row player, rather than calling `headToHead` for every cell.
 */
function Matrix({ history, roster }: { history: GrandPrix[]; roster: { id: string; name: string }[] }) {
  const rows = useMemo(
    () =>
      roster.map((row) => {
        const byOpponent = new Map(
          opponentRecords(history, row.id).map((r) => [r.opponentId, r]),
        )
        return { player: row, cells: roster.map((col) => byOpponent.get(col.id) ?? null) }
      }),
    [history, roster],
  )

  const maxAbsNetElo = useMemo(
    () =>
      Math.max(
        1,
        ...rows.flatMap((row) => row.cells.map((c) => Math.abs(c?.netElo ?? 0))),
      ),
    [rows],
  )

  function cellStyle(netElo: number | undefined) {
    if (!netElo) return {}
    const intensity = Math.min(Math.abs(netElo) / maxAbsNetElo, 1)
    const color = netElo > 0 ? '53, 208, 127' : '255, 90, 71' // --color-boost / --color-spin
    return { backgroundColor: `rgba(${color}, ${0.08 + intensity * 0.32})` }
  }

  return (
    <div className="panel mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-center text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-pit p-2" />
            {roster.map((col) => (
              <th
                key={col.id}
                className="min-w-16 truncate p-2 font-display text-[11px] font-bold uppercase tracking-tight text-haze"
                title={col.name}
              >
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.player.id} className="border-t border-line">
              <th
                className="sticky left-0 z-10 whitespace-nowrap bg-pit p-2 text-left font-display text-[11px] font-bold uppercase tracking-tight text-chalk"
                scope="row"
              >
                {row.player.name}
              </th>
              {row.cells.map((cell, i) => {
                const col = roster[i]
                if (col.id === row.player.id) {
                  return <td key={col.id} className="p-2 text-line" aria-hidden="true">—</td>
                }
                return (
                  <td key={col.id} style={cellStyle(cell?.netElo)} className="p-0">
                    <Link
                      to={`/head-to-head?view=pairwise&a=${row.player.id}&b=${col.id}`}
                      className="block px-2 py-2 font-mono text-chalk hover:underline"
                      title={cell ? `${row.player.name} vs ${col.name}: ${cell.wins}-${cell.losses}${cell.ties ? `-${cell.ties}` : ''}` : `${row.player.name} and ${col.name} haven't raced together`}
                    >
                      {cell ? `${cell.netElo > 0 ? '+' : ''}${cell.netElo}` : '·'}
                    </Link>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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

  // Kept in the URL so a matchup — or the matrix view itself — can be linked straight into the group chat.
  const [searchParams, setSearchParams] = useSearchParams()
  const aId = searchParams.get('a') ?? UNSELECTED
  const bId = searchParams.get('b') ?? UNSELECTED
  const view: View = searchParams.get('view') === 'matrix' ? 'matrix' : 'pairwise'

  function setView(next: View) {
    const params = new URLSearchParams(searchParams)
    if (next === 'pairwise') params.delete('view')
    else params.set('view', next)
    setSearchParams(params, { replace: true })
  }

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
    <div className={`mx-auto px-5 py-8 ${view === 'matrix' ? 'max-w-4xl' : 'max-w-2xl'}`}>
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView('pairwise')}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                view === 'pairwise' ? 'bg-gold text-asphalt' : 'border border-line text-haze hover:text-chalk'
              }`}
            >
              Pairwise
            </button>
            <button
              type="button"
              onClick={() => setView('matrix')}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                view === 'matrix' ? 'bg-gold text-asphalt' : 'border border-line text-haze hover:text-chalk'
              }`}
            >
              Matrix
            </button>
          </div>

          {view === 'matrix' && <Matrix history={history} roster={roster} />}
        </>
      )}

      {!error && !loading && roster.length >= 2 && view === 'pairwise' && (
        <>
          <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
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
                <div className="flex items-center justify-between gap-3">
                  <Link
                    to={`/player/${aId}`}
                    className="flex min-w-0 items-center gap-2 truncate font-display text-lg font-bold text-chalk hover:text-gold"
                  >
                    <RacerBadge id={aId} name={nameOf(aId)} />
                    <span className="truncate">{nameOf(aId)}</span>
                  </Link>
                  <span className="shrink-0 font-mono text-2xl text-chalk">
                    {record.wins}–{record.losses}
                    {record.ties > 0 ? `–${record.ties}` : ''}
                  </span>
                  <Link
                    to={`/player/${bId}`}
                    className="flex min-w-0 items-center justify-end gap-2 truncate text-right font-display text-lg font-bold text-chalk hover:text-gold"
                  >
                    <span className="truncate">{nameOf(bId)}</span>
                    <RacerBadge id={bId} name={nameOf(bId)} />
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
