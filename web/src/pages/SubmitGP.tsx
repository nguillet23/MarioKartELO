import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  computeGpElo,
  DEFAULT_K,
  MARGIN_WEIGHT,
  MAX_GP_POINTS,
  MIN_GP_POINTS,
  type GpParticipant,
} from '../lib/elo'
import { formatGpDate, type GrandPrix } from '../lib/history'
import { loadHistory } from '../lib/loadHistory'
import { replayHistory, type ReplayResult } from '../lib/replay'
import { buildRecap, type Recap } from '../lib/stats'
import PageHeader from '../components/PageHeader'
import RecapCard from '../components/RecapCard'
import RacerBadge from '../components/RacerBadge'

const MIN_PLAYERS = 4
const MAX_PLAYERS = 12
const DEFAULT_PLAYERS = 4
const UNSELECTED = ''

interface PlayerRow {
  id: string
  name: string
  elo: number
  gp_count: number
}

interface Entry {
  key: string
  playerId: string
  points: string
}

interface LastGpEntry {
  name: string
  points: number
  eloDelta: number
}

let keyCounter = 0
function makeEmptyEntry(): Entry {
  return { key: `entry-${keyCounter++}`, playerId: UNSELECTED, points: '' }
}

function makeDefaultEntries(): Entry[] {
  return Array.from({ length: DEFAULT_PLAYERS }, makeEmptyEntry)
}

/** `datetime-local` inputs take a plain local-time string with no timezone — this is "now" in that format, used as the field's upper bound. */
function nowForDatetimeLocal(): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SubmitGP() {
  const [roster, setRoster] = useState<PlayerRow[]>([])
  const [rosterLoading, setRosterLoading] = useState(true)
  const [rosterError, setRosterError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [entries, setEntries] = useState<Entry[]>(makeDefaultEntries)
  /** Blank means "just happened" — submit_gp defaults to now() when this is omitted. Only set to backdate a forgotten night. */
  const [playedAt, setPlayedAt] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [recap, setRecap] = useState<Recap | null>(null)
  const [lastGp, setLastGp] = useState<LastGpEntry[] | null>(null)
  const [confirmingVoid, setConfirmingVoid] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)
  const [voidSuccess, setVoidSuccess] = useState(false)

  const [fullHistory, setFullHistory] = useState<GrandPrix[]>([])
  const [replayOpen, setReplayOpen] = useState(false)
  const [replayK, setReplayK] = useState(String(DEFAULT_K))
  const [replayMarginWeight, setReplayMarginWeight] = useState(String(MARGIN_WEIGHT))
  const [excludedGpIds, setExcludedGpIds] = useState<Set<string>>(new Set())
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null)

  async function loadRoster() {
    const { data, error: fetchError } = await supabase
      .from('players')
      .select('id, name, elo, gp_count')
      .order('name')
    if (fetchError) {
      setRosterError(fetchError.message)
    } else {
      setRoster((data ?? []) as PlayerRow[])
      setRosterError(null)
    }
    setRosterLoading(false)
  }

  async function loadLastGp() {
    const { data, error: fetchError } = await supabase
      .from('grand_prix')
      .select('id, gp_results(points, elo_delta, players(name))')
      .order('played_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError || !data) {
      setLastGp(null)
      return
    }

    const raw = data as unknown as {
      gp_results: { points: number; elo_delta: number; players: { name: string } | null }[]
    }
    setLastGp(
      (raw.gp_results ?? [])
        .map((r) => ({
          name: r.players?.name ?? 'Unknown',
          points: r.points,
          eloDelta: r.elo_delta,
        }))
        .sort((a, b) => b.points - a.points),
    )
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetching from Supabase on mount, the standard data-fetch-in-effect pattern
    loadRoster()
    loadLastGp()
    // The replay tool is read-only and rarely opened, but needs the whole
    // history to build its GP checklist — loaded once up front rather than
    // only when the section is expanded, so opening it is instant.
    loadHistory()
      .then(setFullHistory)
      .catch(() => setFullHistory([]))
  }, [])

  function toggleExcludedGp(gpId: string) {
    setExcludedGpIds((prev) => {
      const next = new Set(prev)
      if (next.has(gpId)) next.delete(gpId)
      else next.add(gpId)
      return next
    })
  }

  function runReplay() {
    const filtered = fullHistory.filter((gp) => !excludedGpIds.has(gp.id))
    const k = Number(replayK)
    const marginWeight = Number(replayMarginWeight)
    setReplayResult(
      replayHistory(filtered, {
        ...(Number.isFinite(k) && k > 0 ? { k } : {}),
        ...(Number.isFinite(marginWeight) ? { marginWeight } : {}),
      }),
    )
  }

  const usedPlayerIds = useMemo(
    () => new Set(entries.map((e) => e.playerId).filter((id) => id !== UNSELECTED)),
    [entries],
  )

  // A preview, not the real computation: it runs off the roster loaded when
  // the page opened, not a fresh read, so it can drift from what actually
  // gets saved if someone else submits a GP in the meantime. handleSubmit
  // re-reads ratings right before the real computation for that reason.
  const preview = useMemo(() => {
    if (entries.some((e) => e.playerId === UNSELECTED)) return null

    const ids = entries.map((e) => e.playerId)
    if (new Set(ids).size !== ids.length) return null

    const participants: GpParticipant[] = []
    for (const entry of entries) {
      const points = Number(entry.points)
      if (!Number.isInteger(points) || points < MIN_GP_POINTS || points > MAX_GP_POINTS) return null
      const player = roster.find((p) => p.id === entry.playerId)
      if (!player) return null
      participants.push({ playerId: entry.playerId, rating: player.elo, points, gpCount: player.gp_count })
    }

    try {
      return new Map(computeGpElo(participants).map((u) => [u.playerId, u.eloDelta]))
    } catch {
      return null
    }
  }, [entries, roster])

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
      setError('Enter the site password to submit.')
      return
    }

    const parsed: { playerId: string; points: number }[] = []
    for (const entry of entries) {
      if (entry.playerId === UNSELECTED) {
        setError('Pick a character in every slot.')
        return
      }
      const points = Number(entry.points)
      if (!Number.isInteger(points) || points < MIN_GP_POINTS || points > MAX_GP_POINTS) {
        setError(
          `Every slot needs a whole-number score between ${MIN_GP_POINTS} and ${MAX_GP_POINTS}.`,
        )
        return
      }
      parsed.push({ playerId: entry.playerId, points })
    }

    const ids = parsed.map((p) => p.playerId)
    if (new Set(ids).size !== ids.length) {
      setError('One character is in two slots. Each racer can only appear once.')
      return
    }

    let playedAtIso: string | null = null
    if (playedAt) {
      const parsedDate = new Date(playedAt)
      if (Number.isNaN(parsedDate.getTime())) {
        setError("That date doesn't parse. Pick it from the calendar instead of typing it.")
        return
      }
      if (parsedDate.getTime() > Date.now()) {
        setError('Played-at time is in the future.')
        return
      }
      playedAtIso = parsedDate.toISOString()
    }

    setSubmitting(true)
    try {
      // Re-read ratings right before computing. They were loaded when the page
      // opened, and someone else may have submitted a GP since — submit_gp
      // rejects stale ratings outright, so narrow that window as far as possible.
      const { data: freshData, error: freshError } = await supabase
        .from('players')
        .select('id, name, elo, gp_count')
        .in('id', ids)
      if (freshError) throw new Error(freshError.message)

      const freshById = new Map((freshData ?? []).map((p) => [p.id, p as PlayerRow]))

      const pointsByPlayerId: Record<string, number> = {}
      const participants: GpParticipant[] = parsed.map(({ playerId, points }) => {
        const player = freshById.get(playerId)
        if (!player) throw new Error('A selected character is no longer in the roster. Refresh the page.')
        pointsByPlayerId[playerId] = points
        return { playerId, rating: player.elo, points, gpCount: player.gp_count }
      })

      const updates = computeGpElo(participants)
      const results = updates.map((u) => ({
        player_id: u.playerId,
        points: pointsByPlayerId[u.playerId],
        elo_before: u.eloBefore,
        elo_after: u.eloAfter,
        elo_delta: u.eloDelta,
      }))

      const { data: newGpId, error: submitError } = await supabase.rpc('submit_gp', {
        password,
        results,
        played_at: playedAtIso,
      })
      if (submitError) throw new Error(submitError.message)

      setSuccess(true)
      // The recap needs the whole history, not just this GP: "personal best"
      // and "new peak" only mean something next to what came before.
      try {
        setRecap(buildRecap(await loadHistory(), newGpId as string))
      } catch {
        // A recap is a nice-to-have. The grand prix is already saved, and
        // saying it failed because the summary didn't load would be a lie.
        setRecap(null)
      }
      setEntries(makeDefaultEntries())
      setPassword('')
      setPlayedAt('')
      setConfirmingVoid(false)
      setVoidSuccess(false)
      await Promise.all([loadRoster(), loadLastGp()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The grand prix did not save.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVoid() {
    setVoidError(null)
    setVoidSuccess(false)

    if (!password) {
      setVoidError('Enter the site password above to void this grand prix.')
      return
    }

    setVoiding(true)
    try {
      const { error: rpcError } = await supabase.rpc('void_last_gp', { password })
      if (rpcError) throw new Error(rpcError.message)

      setVoidSuccess(true)
      setConfirmingVoid(false)
      setSuccess(false)
      setRecap(null)
      await Promise.all([loadRoster(), loadLastGp()])
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'The grand prix was not voided.')
    } finally {
      setVoiding(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader
        title="Submit GP"
        subtitle="Each racer's total points across the four races. Ratings update the moment you submit."
      />

      {rosterError && (
        <p className="panel mb-4 border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          The character roster didn't load: {rosterError}
        </p>
      )}

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <ol className="flex flex-col gap-2">
          {entries.map((entry, index) => {
            const availableRoster = roster.filter(
              (p) => !usedPlayerIds.has(p.id) || p.id === entry.playerId,
            )
            return (
              <li
                key={entry.key}
                className="panel flex items-center gap-3 p-3"
              >
                {entry.playerId === UNSELECTED ? (
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-sm text-haze"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                ) : (
                  <RacerBadge
                    id={entry.playerId}
                    name={roster.find((p) => p.id === entry.playerId)?.name ?? '?'}
                    size="md"
                  />
                )}

                <select
                  className="field flex-1"
                  value={entry.playerId}
                  onChange={(e) => updateEntry(entry.key, { playerId: e.target.value })}
                  disabled={rosterLoading}
                  aria-label={`Character in slot ${index + 1}`}
                >
                  <option value={UNSELECTED} disabled>
                    {rosterLoading ? 'Loading roster…' : 'Pick a character'}
                  </option>
                  {availableRoster.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_GP_POINTS}
                  max={MAX_GP_POINTS}
                  value={entry.points}
                  onChange={(e) => updateEntry(entry.key, { points: e.target.value })}
                  placeholder="Pts"
                  aria-label={`Points in slot ${index + 1}`}
                  className="field w-20 shrink-0 text-center font-mono"
                />

                <span
                  className={`w-12 shrink-0 text-center font-mono text-xs ${
                    entry.playerId === UNSELECTED
                      ? 'text-haze'
                      : (preview?.get(entry.playerId) ?? 0) > 0
                        ? 'text-boost'
                        : (preview?.get(entry.playerId) ?? 0) < 0
                          ? 'text-spin'
                          : 'text-haze'
                  }`}
                  aria-label={
                    preview?.has(entry.playerId)
                      ? `Projected rating change: ${preview.get(entry.playerId)}`
                      : undefined
                  }
                >
                  {entry.playerId !== UNSELECTED && preview?.has(entry.playerId)
                    ? `${(preview.get(entry.playerId) ?? 0) > 0 ? '+' : ''}${preview.get(entry.playerId)}`
                    : '—'}
                </span>

                <button
                  type="button"
                  onClick={() => removeEntry(entry.key)}
                  disabled={entries.length <= MIN_PLAYERS}
                  className="h-11 w-9 shrink-0 rounded-lg text-haze transition-colors hover:text-spin disabled:opacity-25"
                  aria-label={`Remove slot ${index + 1}`}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ol>

        <button
          type="button"
          onClick={addEntry}
          disabled={entries.length >= MAX_PLAYERS}
          className="self-start rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-haze transition-colors hover:border-haze hover:text-chalk disabled:opacity-25"
        >
          Add a racer
        </button>

        <div className="mt-2">
          <label
            className="block text-[10px] font-medium uppercase tracking-[0.2em] text-haze"
            htmlFor="played-at"
          >
            Played at (leave blank for now)
          </label>
          <input
            id="played-at"
            type="datetime-local"
            value={playedAt}
            max={nowForDatetimeLocal()}
            onChange={(e) => setPlayedAt(e.target.value)}
            className="field mt-2"
          />
          <p className="mt-1.5 text-xs text-haze">
            Only for a night you forgot to log — it can't be set earlier than the last grand prix
            already on record.
          </p>
        </div>

        <div className="mt-2">
          <label
            className="block text-[10px] font-medium uppercase tracking-[0.2em] text-haze"
            htmlFor="site-password"
          >
            Site password
          </label>
          <input
            id="site-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field mt-2"
          />
        </div>

        {error && (
          <p className="panel border-spin/40 bg-spin/10 p-3 text-sm text-spin">{error}</p>
        )}
        {success && (
          <p className="panel border-boost/40 bg-boost/10 p-3 text-sm text-boost">
            Grand prix saved. The standings are already updated.
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || rosterLoading}
          className="rounded-lg bg-gold px-4 py-3.5 font-display text-base font-bold uppercase tracking-wide text-asphalt transition-opacity disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Submit grand prix'}
        </button>
      </form>

      {recap && (
        <div className="mt-8">
          <RecapCard recap={recap} />
        </div>
      )}

      <section className="mt-12">
        <h2 className="font-display text-lg font-bold uppercase tracking-tight text-chalk">
          Last grand prix
        </h2>
        <p className="mt-1 text-sm text-haze">
          Entered it wrong? Void it and submit it again. Only the most recent grand prix can be
          voided — earlier ones are already baked into every rating since.
        </p>

        {lastGp === null ? (
          <p className="mt-4 text-sm text-haze">Nothing on record yet.</p>
        ) : (
          <>
            <ol className="panel mt-4 divide-y divide-line">
              {lastGp.map((r) => (
                <li key={r.name} className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-display text-sm font-bold text-chalk">{r.name}</span>
                  <span className="flex items-baseline gap-3 font-mono text-sm">
                    <span className="text-chalk">{r.points} pts</span>
                    <span
                      className={
                        r.eloDelta > 0
                          ? 'text-boost'
                          : r.eloDelta < 0
                            ? 'text-spin'
                            : 'text-haze'
                      }
                    >
                      {r.eloDelta > 0 ? '+' : ''}
                      {r.eloDelta}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            {voidError && (
              <p className="panel mt-3 border-spin/40 bg-spin/10 p-3 text-sm text-spin">
                {voidError}
              </p>
            )}
            {voidSuccess && (
              <p className="panel mt-3 border-boost/40 bg-boost/10 p-3 text-sm text-boost">
                Grand prix voided. Every rating it changed has been rolled back.
              </p>
            )}

            {confirmingVoid ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="w-full text-sm text-chalk">
                  Void this grand prix and roll back the ratings it set?
                </p>
                <button
                  type="button"
                  onClick={handleVoid}
                  disabled={voiding}
                  className="rounded-lg bg-spin px-4 py-2.5 text-sm font-bold text-asphalt disabled:opacity-40"
                >
                  {voiding ? 'Voiding…' : 'Void it'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingVoid(false)}
                  className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-haze hover:text-chalk"
                >
                  Keep it
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setVoidError(null)
                  setVoidSuccess(false)
                  setConfirmingVoid(true)
                }}
                className="mt-3 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-haze transition-colors hover:border-spin hover:text-spin"
              >
                Void this grand prix
              </button>
            )}
          </>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-display text-lg font-bold uppercase tracking-tight text-chalk">
          Replay ratings
        </h2>
        <p className="mt-1 text-sm text-haze">
          A what-if tool: rebuild every rating from scratch with different constants, or with some
          grand prix left out. Read-only — nothing here is saved, and it never touches the real
          ratings.
        </p>

        {!replayOpen ? (
          <button
            type="button"
            onClick={() => setReplayOpen(true)}
            className="mt-3 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-haze transition-colors hover:border-gold hover:text-gold"
          >
            Open the replay tool
          </button>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
                  K factor
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={replayK}
                  onChange={(e) => setReplayK(e.target.value)}
                  className="field mt-2"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
                  Margin weight
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.05"
                  min={0}
                  max={1}
                  value={replayMarginWeight}
                  onChange={(e) => setReplayMarginWeight(e.target.value)}
                  className="field mt-2"
                />
              </label>
            </div>

            {fullHistory.length > 0 && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
                  Exclude grand prix (stands in for voiding them)
                </p>
                <ol className="panel mt-2 max-h-56 divide-y divide-line overflow-y-auto">
                  {[...fullHistory].reverse().map((gp) => (
                    <li key={gp.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={excludedGpIds.has(gp.id)}
                          onChange={() => toggleExcludedGp(gp.id)}
                        />
                        <span className="text-haze">{formatGpDate(gp.playedAt)}</span>
                        <span className="min-w-0 flex-1 truncate text-chalk">
                          {gp.entries[0].playerName} won with {gp.entries[0].points}
                        </span>
                      </label>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <button
              type="button"
              onClick={runReplay}
              disabled={fullHistory.length === 0}
              className="self-start rounded-lg bg-gold px-4 py-2.5 text-sm font-bold text-asphalt disabled:opacity-40"
            >
              Run replay
            </button>

            {replayResult && (
              <ol className="panel divide-y divide-line">
                {roster
                  .map((p) => ({
                    id: p.id,
                    name: p.name,
                    actual: p.elo,
                    replayed: replayResult.finalRatings.get(p.id) ?? null,
                  }))
                  .filter((r) => r.replayed !== null)
                  .sort((a, b) => (b.replayed ?? 0) - (a.replayed ?? 0))
                  .map((r) => {
                    const diff = r.replayed! - r.actual
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <span className="min-w-0 truncate font-display text-sm font-bold text-chalk">
                          {r.name}
                        </span>
                        <span className="flex shrink-0 items-baseline gap-3 font-mono text-sm">
                          <span className="text-haze">{r.actual} →</span>
                          <span className="text-chalk">{r.replayed}</span>
                          <span className={diff > 0 ? 'text-boost' : diff < 0 ? 'text-spin' : 'text-haze'}>
                            ({diff > 0 ? '+' : ''}
                            {diff})
                          </span>
                        </span>
                      </li>
                    )
                  })}
              </ol>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
