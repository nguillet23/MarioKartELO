// Match-making tab support — see PLAN.md's "Match making tab" section for
// the design this implements: fair sit-out rotation for whoever's present
// tonight, not opponent pairing (a Mario Kart GP races the whole active
// group at once, unlike Scoreholio's 1v1/2v2 rounds).
//
// Nothing here touches the database. "Who's active tonight" is session-only
// UI state the page itself owns; this module only turns that plus the real
// GP history into a suggestion. No cross-device sync, no persistence.

import type { GrandPrix } from './history'
import { SESSION_GAP_HOURS, sessionsFromHistory } from './stats'

/** Mirrors SubmitGP.tsx's own MIN_PLAYERS/MAX_PLAYERS — a race this tab
 * suggests has to be submittable as a real GP. */
export const MIN_RACE_SIZE = 4
export const MAX_RACE_SIZE = 12

export interface RaceSuggestion {
  /** Suggested to race next, winners-stay-on players first. */
  racing: string[]
  /** Suggested to sit out this GP. */
  sittingOut: string[]
  /** Subset of `racing` who are there via the win-stays-on house rule, not the fairness queue. */
  stayedOn: string[]
}

/**
 * Tonight's still-ongoing session, or null if there isn't one — either
 * nobody's played yet, or the last GP on record is old enough that a new
 * session would start before this one (same gap `sessionsFromHistory` uses
 * to group nights apart). Shared by `gpsTonightFor` and `lastRaceWinners` so
 * both agree on what "tonight" means.
 */
function ongoingSession(history: GrandPrix[], now: Date) {
  const sessions = sessionsFromHistory(history)
  const tonight = sessions[sessions.length - 1]
  if (!tonight) return null

  const gapMs = SESSION_GAP_HOURS * 60 * 60 * 1000
  const stillOngoing = now.getTime() - new Date(tonight.endedAt).getTime() <= gapMs
  return stillOngoing ? tonight : null
}

/**
 * How many GPs each active player has played in tonight's session — the
 * fairness signal sit-out rotation weights by by (fewer tonight, better odds
 * of racing next). Zero for anyone who hasn't played tonight yet, including
 * everyone if there's no ongoing session at all.
 */
export function gpsTonightFor(
  history: GrandPrix[],
  activePlayerIds: string[],
  now: Date = new Date(),
): Map<string, number> {
  const counts = new Map(activePlayerIds.map((id) => [id, 0]))
  const tonight = ongoingSession(history, now)
  if (!tonight) return counts

  for (const gp of tonight.gps) {
    for (const entry of gp.entries) {
      if (counts.has(entry.playerId)) {
        counts.set(entry.playerId, (counts.get(entry.playerId) ?? 0) + 1)
      }
    }
  }
  return counts
}

/**
 * Winner(s) of the most recent grand prix, if it's part of tonight's
 * still-ongoing session — the house rule that lets them keep their spot for
 * the next race rather than rotating out by GP count. Empty if there's no
 * GP yet tonight, or the last GP on record belongs to an earlier session.
 * A shared 1st place (rank === 1) counts as staying on for everyone tied at
 * the top, same as `streaksFor` treats a shared win.
 */
export function lastRaceWinners(history: GrandPrix[], now: Date = new Date()): Set<string> {
  const tonight = ongoingSession(history, now)
  if (!tonight) return new Set()

  const lastGp = tonight.gps[tonight.gps.length - 1]
  return new Set(lastGp.entries.filter((e) => e.rank === 1).map((e) => e.playerId))
}

/**
 * Weighted-random order: a lower `gpsTonight` count makes a player more
 * likely to sort earlier, but it's a nudge, not a rule — ties and near-ties
 * can land either way, so the same active pool won't always produce the
 * identical suggestion (PLAN.md: "lean random, not deterministic").
 * Exponential-weighted keys are the standard trick for weighted sampling
 * without replacement via a single sort.
 */
function weightedShuffle(ids: string[], gpsTonight: Map<string, number>): string[] {
  return ids
    .map((id) => {
      const weight = 1 / ((gpsTonight.get(id) ?? 0) + 1)
      return { id, key: Math.log(Math.random()) / weight }
    })
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.id)
}

/**
 * Suggests who races next and who sits out, from whoever's currently active.
 * Purely a proposal — the match-making page lets someone swap players in or
 * out by hand before anyone actually races (PLAN.md: manual override).
 *
 * Returns null when there aren't enough active players to suggest a race at
 * all — the same 4-player floor a real GP needs (`MIN_RACE_SIZE`).
 */
export function suggestNextRace(
  history: GrandPrix[],
  activePlayerIds: string[],
  now: Date = new Date(),
): RaceSuggestion | null {
  if (activePlayerIds.length < MIN_RACE_SIZE) return null

  if (activePlayerIds.length <= MAX_RACE_SIZE) {
    return { racing: [...activePlayerIds], sittingOut: [], stayedOn: [] }
  }

  const winners = lastRaceWinners(history, now)
  const stayedOn = activePlayerIds.filter((id) => winners.has(id))
  const rest = activePlayerIds.filter((id) => !winners.has(id))

  const gpsTonight = gpsTonightFor(history, activePlayerIds, now)
  const slotsLeft = Math.max(MAX_RACE_SIZE - stayedOn.length, 0)
  const shuffled = weightedShuffle(rest, gpsTonight)

  return {
    racing: [...stayedOn, ...shuffled.slice(0, slotsLeft)],
    sittingOut: shuffled.slice(slotsLeft),
    stayedOn,
  }
}
