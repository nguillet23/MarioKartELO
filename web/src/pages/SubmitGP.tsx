import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { computeGpElo, type GpParticipant } from '../lib/elo'

const MIN_PLAYERS = 2
const MAX_PLAYERS = 12
const DEFAULT_PLAYERS = 4
const UNSELECTED = ''

interface PlayerRow {
  id: string
  name: string
  elo: number
}

interface Entry {
  key: string
  playerId: string
  points: string
}

let keyCounter = 0
function makeEmptyEntry(): Entry {
  return { key: `entry-${keyCounter++}`, playerId: UNSELECTED, points: '' }
}

function makeDefaultEntries(): Entry[] {
  return Array.from({ length: DEFAULT_PLAYERS }, makeEmptyEntry)
}

export default function SubmitGP() {
  const [roster, setRoster] = useState<PlayerRow[]>([])
  const [rosterLoading, setRosterLoading] = useState(true)
  const [rosterError, setRosterError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [entries, setEntries] = useState<Entry[]>(makeDefaultEntries)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function loadRoster() {
    const { data, error: fetchError } = await supabase
      .from('players')
      .select('id, name, elo')
      .order('name')
    if (fetchError) {
      setRosterError(fetchError.message)
    } else {
      setRoster(data ?? [])
    }
    setRosterLoading(false)
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetching from Supabase on mount, the standard data-fetch-in-effect pattern
    loadRoster()
  }, [])

  const usedPlayerIds = useMemo(
    () => new Set(entries.map((e) => e.playerId).filter((id) => id !== UNSELECTED)),
    [entries],
  )

  function updateEntry(key: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  }

  function addEntry() {
    setEntries((prev) => (prev.length >= MAX_PLAYERS ? prev : [...prev, makeEmptyEntry()]))
  }

  function removeEntry(key: string) {
    setEntries((prev) => (prev.length <= MIN_PLAYERS ? prev : prev.filter((e) => e.key !== key)))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!password) {
      setError('Password is required.')
      return
    }

    const parsed: { playerId: string; points: number }[] = []
    for (const entry of entries) {
      if (entry.playerId === UNSELECTED) {
        setError('Select a character for every row.')
        return
      }
      const points = Number(entry.points)
      if (!Number.isInteger(points) || points < 4 || points > 60) {
        setError('Each player needs a whole-number score between 4 and 60.')
        return
      }
      parsed.push({ playerId: entry.playerId, points })
    }

    const ids = parsed.map((p) => p.playerId)
    if (new Set(ids).size !== ids.length) {
      setError('The same character is selected more than once.')
      return
    }

    setSubmitting(true)
    try {
      const pointsByPlayerId: Record<string, number> = {}
      const participants: GpParticipant[] = parsed.map(({ playerId, points }) => {
        const player = roster.find((p) => p.id === playerId)
        if (!player) throw new Error('Selected character not found — try refreshing the page.')
        pointsByPlayerId[playerId] = points
        return { playerId, rating: player.elo, points }
      })

      const updates = computeGpElo(participants)
      const results = updates.map((u) => ({
        player_id: u.playerId,
        points: pointsByPlayerId[u.playerId],
        elo_before: u.eloBefore,
        elo_after: u.eloAfter,
        elo_delta: u.eloDelta,
      }))

      const { error: submitError } = await supabase.rpc('submit_gp', {
        password,
        results,
      })
      if (submitError) throw new Error(submitError.message)

      setSuccess(true)
      setEntries(makeDefaultEntries())
      setPassword('')
      await loadRoster()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Submit GP</h1>
      <p className="text-gray-500">Enter each character's total points for this Grand Prix.</p>

      {rosterError && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          Couldn't load the character roster: {rosterError}
        </p>
      )}

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-3">
          {entries.map((entry, index) => {
            const availableRoster = roster.filter(
              (p) => !usedPlayerIds.has(p.id) || p.id === entry.playerId,
            )
            return (
              <div
                key={entry.key}
                className="flex items-center gap-2 rounded-md border border-gray-200 p-3"
              >
                <span className="w-6 text-sm text-gray-400">{index + 1}</span>

                <select
                  className="flex-1 rounded-md border border-gray-300 px-2 py-2 text-base"
                  value={entry.playerId}
                  onChange={(e) => updateEntry(entry.key, { playerId: e.target.value })}
                  disabled={rosterLoading}
                >
                  <option value={UNSELECTED} disabled>
                    Select character…
                  </option>
                  {availableRoster.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  min={4}
                  max={60}
                  value={entry.points}
                  onChange={(e) => updateEntry(entry.key, { points: e.target.value })}
                  placeholder="Points"
                  className="w-24 rounded-md border border-gray-300 px-2 py-2 text-base"
                />

                <button
                  type="button"
                  onClick={() => removeEntry(entry.key)}
                  disabled={entries.length <= MIN_PLAYERS}
                  className="text-sm text-gray-400 hover:text-red-600 disabled:opacity-30"
                  aria-label="Remove player"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={addEntry}
          disabled={entries.length >= MAX_PLAYERS}
          className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-30"
        >
          + Add player
        </button>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="site-password">
            Site password
          </label>
          <input
            id="site-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-base"
          />
        </div>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {success && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">GP submitted!</p>
        )}

        <button
          type="submit"
          disabled={submitting || rosterLoading}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit GP'}
        </button>
      </form>
    </div>
  )
}
