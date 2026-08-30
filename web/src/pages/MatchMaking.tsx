import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { GrandPrix } from '../lib/history'
import { loadHistory } from '../lib/loadHistory'
import {
  gpsTonightFor,
  MAX_RACE_SIZE,
  MIN_RACE_SIZE,
  suggestNextRace,
  type RaceSuggestion,
} from '../lib/matchmaking'
import PageHeader from '../components/PageHeader'
import RacerBadge from '../components/RacerBadge'

interface PlayerRow {
  id: string
  name: string
}

const toggleButtonClass = (active: boolean) =>
  [
    'rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
    active ? 'bg-gold text-asphalt' : 'border border-line text-haze hover:text-chalk',
  ].join(' ')

export default function MatchMaking() {
  const [roster, setRoster] = useState<PlayerRow[]>([])
  const [rosterLoading, setRosterLoading] = useState(true)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [history, setHistory] = useState<GrandPrix[]>([])

  // Who's actually here tonight. Session-only — never persisted, never
  // synced across devices (PLAN.md: one "clipboard holder" for the night).
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())

  // How many should race next — not everyone wants a full 12 (e.g. only 8
  // controllers tonight). Defaults to the floor rather than the cap, same
  // as SubmitGP's own default field count; clamped for real inside
  // suggestNextRace, so a blank or out-of-range value here can't break it.
  const [raceSizeInput, setRaceSizeInput] = useState(String(MIN_RACE_SIZE))

  const [suggestion, setSuggestion] = useState<RaceSuggestion | null>(null)
  // Manual override, seeded from `suggestion` each time it's (re)generated —
  // the algorithm proposes, this is what actually gets edited by hand.
  const [racingIds, setRacingIds] = useState<Set<string>>(new Set())

  // Who actually won the race currently shown in `racingIds` — the table
  // often plays several races before anyone submits one to Submit GP, so
  // history alone can't tell the next suggestion who just won. Cleared
  // after each "Suggest again" (it's fed in as that click's manualWinners,
  // then reset so the next race's picker starts blank).
  const [manualWinnerIds, setManualWinnerIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function loadRoster() {
      const { data, error: fetchError } = await supabase
        .from('players')
        .select('id, name')
        .order('name')
      if (fetchError) setRosterError(fetchError.message)
      else setRoster((data ?? []) as PlayerRow[])
      setRosterLoading(false)
    }
    // oxlint-disable-next-line react/set-state-in-effect -- fetching from Supabase on mount, the standard data-fetch-in-effect pattern
    loadRoster()
    loadHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [])

  const nameById = useMemo(() => new Map(roster.map((p) => [p.id, p.name])), [roster])
  const gpsTonight = useMemo(
    () => gpsTonightFor(history, [...activeIds]),
    [history, activeIds],
  )

  function toggleActive(id: string) {
    setActiveIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // Whoever's actually present just changed, so any suggestion already on
    // screen no longer reflects it — clear it rather than let it go stale.
    setSuggestion(null)
    setManualWinnerIds(new Set())
  }

  function runSuggestion() {
    const parsedSize = Number(raceSizeInput)
    const raceSize = Number.isFinite(parsedSize) ? parsedSize : MIN_RACE_SIZE
    const result = suggestNextRace(history, [...activeIds], raceSize, {
      manualWinners: manualWinnerIds.size > 0 ? manualWinnerIds : undefined,
    })
    setSuggestion(result)
    setRacingIds(new Set(result?.racing ?? []))
    setManualWinnerIds(new Set())
  }

  function moveToSitOut(id: string) {
    setRacingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function moveToRacing(id: string) {
    setRacingIds((prev) => new Set(prev).add(id))
  }

  function toggleManualWinner(id: string) {
    setManualWinnerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activeList = roster.filter((p) => activeIds.has(p.id))
  const sittingOutIds = activeList.map((p) => p.id).filter((id) => !racingIds.has(id))

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <PageHeader
        title="Match Making"
        subtitle="Mark who's here tonight, then get a fair suggestion for who races next and who sits out."
      />

      {rosterError && (
        <p className="panel mb-4 border-spin/40 bg-spin/10 p-4 text-sm text-spin">
          The roster didn't load: {rosterError}
        </p>
      )}

      <section>
        <h2 className="font-display text-lg font-bold uppercase tracking-tight text-chalk">
          Who's here
        </h2>
        <p className="mt-1 text-sm text-haze">
          Tap a name to mark them present. Nothing here is saved — it resets when you leave the
          page, same as a physical whiteboard.
        </p>

        {rosterLoading ? (
          <p className="mt-4 text-sm text-haze">Loading roster…</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {roster.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleActive(p.id)}
                className={toggleButtonClass(activeIds.has(p.id))}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        <p className="mt-3 text-xs text-haze">
          {activeIds.size} present
          {activeIds.size > 0 && activeIds.size < MIN_RACE_SIZE
            ? ` — needs at least ${MIN_RACE_SIZE} to suggest a race`
            : ''}
        </p>
      </section>

      <section className="mt-8">
        <label className="block max-w-40" htmlFor="race-size">
          <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-haze">
            Racing at once
          </span>
          <input
            id="race-size"
            type="number"
            inputMode="numeric"
            min={MIN_RACE_SIZE}
            max={MAX_RACE_SIZE}
            value={raceSizeInput}
            onChange={(e) => {
              setRaceSizeInput(e.target.value)
              // Same reasoning as toggleActive: an on-screen suggestion no
              // longer reflects a changed input, so clear it rather than
              // leave a stale one showing.
              setSuggestion(null)
              setManualWinnerIds(new Set())
            }}
            className="field mt-2"
          />
        </label>
        <p className="mt-1.5 text-xs text-haze">
          How many should race next ({MIN_RACE_SIZE}–{MAX_RACE_SIZE}) — a tie for the win can push
          this higher, but it'll never sit out someone who just won.
        </p>

        <button
          type="button"
          onClick={runSuggestion}
          disabled={activeIds.size < MIN_RACE_SIZE}
          className="mt-4 rounded-lg bg-gold px-4 py-3.5 font-display text-base font-bold uppercase tracking-wide text-asphalt transition-opacity disabled:opacity-40"
        >
          {suggestion ? 'Suggest again' : 'Suggest next race'}
        </button>

        {suggestion && (
          <div className="mt-6 flex flex-col gap-6">
            <div>
              <h3 className="font-display text-sm font-bold uppercase tracking-tight text-chalk">
                Racing next
              </h3>
              <p className="mt-1 text-xs text-haze">
                Tap a name to move them to sitting out instead — this is a suggestion, not a rule.
                Once they've actually raced, mark who won so the next suggestion keeps them in —
                that overrides what's on record until the GP is submitted.
              </p>
              <ol className="panel mt-3 divide-y divide-line">
                {[...racingIds].map((id) => (
                  <li key={id} className="flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => moveToSitOut(id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <RacerBadge id={id} name={nameById.get(id) ?? '?'} size="sm" />
                      <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-chalk">
                        {nameById.get(id) ?? 'Unknown'}
                      </span>
                      {suggestion.stayedOn.includes(id) && (
                        <span className="shrink-0 rounded-full bg-boost/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-boost">
                          Won last
                        </span>
                      )}
                      {gpsTonight.get(id) === 0 && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-haze">
                          Hasn't played
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleManualWinner(id)}
                      aria-pressed={manualWinnerIds.has(id)}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                        manualWinnerIds.has(id)
                          ? 'bg-gold text-asphalt'
                          : 'border border-line text-haze hover:text-chalk'
                      }`}
                    >
                      {manualWinnerIds.has(id) ? 'Won ✓' : 'Mark won'}
                    </button>
                  </li>
                ))}
                {racingIds.size === 0 && (
                  <li className="px-4 py-3 text-sm text-haze">Nobody — move someone in below.</li>
                )}
              </ol>
            </div>

            <div>
              <h3 className="font-display text-sm font-bold uppercase tracking-tight text-chalk">
                Sitting out
              </h3>
              <ol className="panel mt-3 divide-y divide-line">
                {sittingOutIds.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => moveToRacing(id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-pit-hi"
                    >
                      <RacerBadge id={id} name={nameById.get(id) ?? '?'} size="sm" />
                      <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-chalk">
                        {nameById.get(id) ?? 'Unknown'}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-haze">
                        {gpsTonight.get(id) ?? 0} GP{gpsTonight.get(id) === 1 ? '' : 's'} tonight
                      </span>
                    </button>
                  </li>
                ))}
                {sittingOutIds.length === 0 && (
                  <li className="px-4 py-3 text-sm text-haze">Nobody — everyone present is racing.</li>
                )}
              </ol>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
