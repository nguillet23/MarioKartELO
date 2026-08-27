import { useEffect, useMemo, useState } from 'react'
import { expectedScore } from '../lib/elo'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'
import RacerBadge from '../components/RacerBadge'

type Team = 'a' | 'b'

interface PlayerRow {
  id: string
  name: string
  elo: number
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

/**
 * A snake draft over current ratings: strongest player first, then each next
 * player joins whichever team is currently behind on total rating. Simple,
 * deterministic, and close to optimal for the small field sizes a game night
 * actually has.
 */
function greedySplit(players: PlayerRow[]): Map<string, Team> {
  const sorted = [...players].sort((a, b) => b.elo - a.elo)
  const totals = { a: 0, b: 0 }
  const assignment = new Map<string, Team>()

  for (const p of sorted) {
    const team: Team = totals.a <= totals.b ? 'a' : 'b'
    assignment.set(p.id, team)
    totals[team] += p.elo
  }

  return assignment
}

function TeamPanel({
  label,
  players,
  onSwap,
}: {
  label: string
  players: PlayerRow[]
  onSwap: (id: string) => void
}) {
  const totalElo = players.reduce((sum, p) => sum + p.elo, 0)
  const avgElo = players.length > 0 ? totalElo / players.length : 0

  return (
    <div className="panel flex-1 p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">{label}</p>
      <p className="mt-1 font-mono text-xl text-chalk">
        {avgElo.toFixed(0)} <span className="text-sm text-haze">avg</span>
      </p>
      <ol className="mt-3 flex flex-col gap-1.5">
        {players.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSwap(p.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm transition-colors hover:border-gold"
              title="Move to the other team"
            >
              <span className="flex min-w-0 items-center gap-2">
                <RacerBadge id={p.id} name={p.name} />
                <span className="min-w-0 truncate font-display font-bold text-chalk">{p.name}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-haze">{p.elo}</span>
            </button>
          </li>
        ))}
        {players.length === 0 && <li className="px-1 py-2 text-xs text-haze">Nobody yet.</li>}
      </ol>
    </div>
  )
}

export default function Matchmaking() {
  const [roster, setRoster] = useState<PlayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [manualOverrides, setManualOverrides] = useState<Map<string, Team>>(new Map())

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetching from Supabase on mount, the standard data-fetch-in-effect pattern
    supabase
      .from('players')
      .select('id, name, elo')
      .order('name')
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(fetchError.message)
        } else {
          setRoster((data ?? []) as PlayerRow[])
          setError(null)
        }
        setLoading(false)
      })
  }, [])

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // Who's playing changed, so any hand-picked swap no longer means what it did.
    setManualOverrides(new Map())
  }

  const selected = useMemo(
    () => roster.filter((p) => selectedIds.has(p.id)),
    [roster, selectedIds],
  )

  const autoAssignment = useMemo(() => greedySplit(selected), [selected])
  const assignment = useMemo(() => {
    const merged = new Map(autoAssignment)
    for (const [id, team] of manualOverrides) {
      if (merged.has(id)) merged.set(id, team)
    }
    return merged
  }, [autoAssignment, manualOverrides])

  function swapTeam(id: string) {
    const current = assignment.get(id)
    if (!current) return
    setManualOverrides((prev) => new Map(prev).set(id, current === 'a' ? 'b' : 'a'))
  }

  const teamA = selected.filter((p) => assignment.get(p.id) === 'a')
  const teamB = selected.filter((p) => assignment.get(p.id) === 'b')
  const avgA = teamA.length > 0 ? teamA.reduce((s, p) => s + p.elo, 0) / teamA.length : 0
  const avgB = teamB.length > 0 ? teamB.reduce((s, p) => s + p.elo, 0) / teamB.length : 0
  const winProbA = teamA.length > 0 && teamB.length > 0 ? expectedScore(avgA, avgB) : 0.5

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader
        title="Matchmaking"
        subtitle="Who's here tonight, split into two teams as close as the ratings allow."
      />

      {error && (
        <p className="panel border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          The roster didn't load: {error}
        </p>
      )}

      {!error && loading && <p className="text-sm text-haze">Loading roster…</p>}

      {!error && !loading && roster.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="font-display text-lg font-bold text-chalk">No racers yet</p>
          <p className="mt-1 text-sm text-haze">Add characters before setting up a matchup.</p>
        </div>
      )}

      {!error && !loading && roster.length > 0 && (
        <>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
            Who's racing tonight
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {roster.map((p) => {
              const active = selectedIds.has(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleSelected(p.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-gold bg-gold/10 text-gold'
                      : 'border-line text-haze hover:text-chalk'
                  }`}
                >
                  <RacerBadge id={p.id} name={p.name} />
                  {p.name}
                </button>
              )
            })}
          </div>

          {selected.length < 2 ? (
            <p className="mt-6 text-sm text-haze">Pick at least two racers to suggest a split.</p>
          ) : (
            <>
              <div className="mt-6 flex flex-col gap-4 sm:flex-row">
                <TeamPanel label="Team A" players={teamA} onSwap={swapTeam} />
                <TeamPanel label="Team B" players={teamB} onSwap={swapTeam} />
              </div>

              <div className="panel mt-4 p-4">
                <div className="flex items-baseline justify-between gap-3 font-mono text-sm">
                  <span className="text-chalk">{(winProbA * 100).toFixed(0)}%</span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
                    Win odds
                  </span>
                  <span className="text-chalk">{((1 - winProbA) * 100).toFixed(0)}%</span>
                </div>
                <div className="mt-2">
                  <Bar left={winProbA} right={1 - winProbA} />
                </div>
                <p className="mt-3 text-xs text-haze">
                  Based on each team's average rating, the way a single 1v1 would be. Click a racer
                  to move them to the other team.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
