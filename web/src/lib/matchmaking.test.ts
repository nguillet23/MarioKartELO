import { describe, expect, it } from 'vitest'
import type { GrandPrix, GpEntry } from './history'
import {
  gpsTonightFor,
  lastRaceWinners,
  MAX_RACE_SIZE,
  MIN_RACE_SIZE,
  suggestNextRace,
} from './matchmaking'

/** A minimal GrandPrix fixture — matchmaking.ts only reads playerId and
 * rank off entries, and playedAt off the GP itself, so the Elo fields are
 * meaningless placeholders here. */
function gp(id: string, playedAt: string, ranked: [string, number][]): GrandPrix {
  const entries: GpEntry[] = ranked.map(([playerId, rank]) => ({
    playerId,
    playerName: playerId.toUpperCase(),
    points: 0,
    eloBefore: 100,
    eloAfter: 100,
    eloDelta: 0,
    rank,
  }))
  return { id, playedAt, entries }
}

const NOW = new Date('2026-01-01T22:00:00Z')

describe('gpsTonightFor', () => {
  it('is zero for everyone when there is no history at all', () => {
    const counts = gpsTonightFor([], ['a', 'b', 'c', 'd'], NOW)
    expect([...counts.values()]).toEqual([0, 0, 0, 0])
  })

  it('is zero for everyone when the last session is too old to still be ongoing', () => {
    const history = [gp('gp-1', '2025-12-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]])]
    const counts = gpsTonightFor(history, ['a', 'b', 'c', 'd'], NOW)
    expect([...counts.values()]).toEqual([0, 0, 0, 0])
  })

  it("counts each active player's GPs within tonight's ongoing session only", () => {
    const history = [
      // An earlier session, well outside the gap — shouldn't count.
      gp('gp-old', '2025-12-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]]),
      // Tonight's session.
      gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]]),
      gp('gp-2', '2026-01-01T21:00:00Z', [['b', 1], ['c', 2], ['d', 3], ['e', 4]]),
    ]
    const counts = gpsTonightFor(history, ['a', 'b', 'c', 'd', 'e'], NOW)
    expect(counts.get('a')).toBe(1)
    expect(counts.get('b')).toBe(2)
    expect(counts.get('e')).toBe(1)
  })

  it('ignores players who are not in the active pool', () => {
    const history = [gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]])]
    const counts = gpsTonightFor(history, ['a'], NOW)
    expect(counts.size).toBe(1)
    expect(counts.get('a')).toBe(1)
  })
})

describe('lastRaceWinners', () => {
  it('is empty with no history', () => {
    expect(lastRaceWinners([], NOW).size).toBe(0)
  })

  it('is empty when the last GP on record belongs to an earlier session', () => {
    const history = [gp('gp-1', '2025-12-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]])]
    expect(lastRaceWinners(history, NOW).size).toBe(0)
  })

  it("returns the winner of tonight's most recent GP", () => {
    const history = [
      gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]]),
      gp('gp-2', '2026-01-01T21:00:00Z', [['b', 1], ['c', 2], ['d', 3], ['a', 4]]),
    ]
    expect(lastRaceWinners(history, NOW)).toEqual(new Set(['b']))
  })

  it('includes everyone tied for first', () => {
    const history = [gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 1], ['c', 3], ['d', 3]])]
    expect(lastRaceWinners(history, NOW)).toEqual(new Set(['a', 'b']))
  })
})

describe('suggestNextRace', () => {
  it('suggests nothing below the 4-player floor', () => {
    expect(suggestNextRace([], ['a', 'b', 'c'], MAX_RACE_SIZE, { now: NOW })).toBeNull()
  })

  it('sends the whole active pool to race, nobody sitting out, at or under the requested size', () => {
    const active = ['a', 'b', 'c', 'd', 'e']
    const suggestion = suggestNextRace([], active, MAX_RACE_SIZE, { now: NOW })!
    expect(suggestion.racing).toEqual(active)
    expect(suggestion.sittingOut).toEqual([])
    expect(suggestion.stayedOn).toEqual([])
  })

  it('always keeps last GP\'s winner racing, over the cap', () => {
    const history = [gp('gp-1', '2026-01-01T20:00:00Z', [['w', 1], ['b', 2], ['c', 3], ['d', 4]])]
    const active = ['w', ...Array.from({ length: 14 }, (_, i) => `p${i}`)]
    const suggestion = suggestNextRace(history, active, MAX_RACE_SIZE, { now: NOW })!
    expect(suggestion.stayedOn).toEqual(['w'])
    expect(suggestion.racing).toContain('w')
  })

  it('partitions the active pool exactly, caps racing at MAX_RACE_SIZE, over the cap', () => {
    const active = Array.from({ length: 15 }, (_, i) => `p${i}`)
    const suggestion = suggestNextRace([], active, MAX_RACE_SIZE, { now: NOW })!

    expect(suggestion.racing.length).toBe(MAX_RACE_SIZE)
    expect(suggestion.racing.length + suggestion.sittingOut.length).toBe(active.length)
    expect(new Set([...suggestion.racing, ...suggestion.sittingOut])).toEqual(new Set(active))
    // No overlap between the two lists.
    expect(suggestion.racing.some((id) => suggestion.sittingOut.includes(id))).toBe(false)
  })

  it('honors a requested race size smaller than the cap', () => {
    const active = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const suggestion = suggestNextRace([], active, 6, { now: NOW })!
    expect(suggestion.racing.length).toBe(6)
    expect(suggestion.sittingOut.length).toBe(4)
  })

  it('clamps a requested size below MIN_RACE_SIZE up to the floor', () => {
    const active = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const suggestion = suggestNextRace([], active, 1, { now: NOW })!
    expect(suggestion.racing.length).toBe(MIN_RACE_SIZE)
  })

  it('clamps a requested size above MAX_RACE_SIZE down to the cap', () => {
    const active = Array.from({ length: 15 }, (_, i) => `p${i}`)
    const suggestion = suggestNextRace([], active, 99, { now: NOW })!
    expect(suggestion.racing.length).toBe(MAX_RACE_SIZE)
  })

  it('never asks a requested size to exceed how many are actually present', () => {
    const active = ['a', 'b', 'c', 'd', 'e']
    const suggestion = suggestNextRace([], active, MAX_RACE_SIZE, { now: NOW })!
    expect(suggestion.racing.length).toBe(active.length)
    expect(suggestion.sittingOut).toEqual([])
  })

  it('lets a tie for the win push racing above the requested size, never sitting a winner out', () => {
    const history = [
      gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 1], ['c', 1], ['d', 1], ['e', 5], ['f', 6]]),
    ]
    const active = ['a', 'b', 'c', 'd', 'e', 'f']
    // Requesting a race of 4 with 4 people tied for the win: all 4 winners
    // still race, even though that alone already meets the request, and e/f
    // are the ones left to fight over any remaining slots.
    const suggestion = suggestNextRace(history, active, 4, { now: NOW })!
    expect(suggestion.stayedOn.sort()).toEqual(['a', 'b', 'c', 'd'])
    for (const winner of ['a', 'b', 'c', 'd']) expect(suggestion.racing).toContain(winner)
  })

  it('lets manualWinners override whatever history says', () => {
    // History says 'a' won, but the table has already raced ahead of what's
    // been submitted to Submit GP and 'z' actually just won — manualWinners
    // is how the match-making page tells it that.
    const history = [gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]])]
    const active = ['a', 'b', 'c', 'd', 'z']
    const suggestion = suggestNextRace(history, active, MIN_RACE_SIZE, {
      now: NOW,
      manualWinners: ['z'],
    })!
    expect(suggestion.stayedOn).toEqual(['z'])
  })

  it('falls back to history when manualWinners is undefined', () => {
    const history = [gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]])]
    const active = ['a', 'b', 'c', 'd']
    const suggestion = suggestNextRace(history, active, MIN_RACE_SIZE, { now: NOW })!
    expect(suggestion.stayedOn).toEqual(['a'])
  })

  it('treats an explicitly empty manualWinners as "nobody stays on", not a fallback to history', () => {
    const history = [gp('gp-1', '2026-01-01T20:00:00Z', [['a', 1], ['b', 2], ['c', 3], ['d', 4]])]
    const active = ['a', 'b', 'c', 'd']
    const suggestion = suggestNextRace(history, active, MIN_RACE_SIZE, {
      now: NOW,
      manualWinners: [],
    })!
    expect(suggestion.stayedOn).toEqual([])
  })

  it('weights toward players with fewer GPs tonight, without making it a strict sort', () => {
    // 9 players who haven't played tonight vs. 10 who've all played 5 GPs
    // together — over many trials the low-GP group should be picked far
    // more often, but this is a weighted random draw, not a deterministic
    // ranking, so the assertion leaves plenty of room rather than expecting
    // either group to win every single trial. A separate 'winner' player
    // (in neither group) takes the win-stays-on slot so it doesn't bias the
    // low/high comparison.
    const lowIds = Array.from({ length: 9 }, (_, i) => `low${i}`)
    const highIds = Array.from({ length: 10 }, (_, i) => `high${i}`)
    const history = [
      gp('gp-winner', '2026-01-01T19:00:00Z', [['winner', 1], ['filler1', 2], ['filler2', 3], ['filler3', 4]]),
      ...Array.from({ length: 5 }, (_, round) =>
        gp(
          `gp-${round}`,
          `2026-01-01T${String(20 + round).padStart(2, '0')}:00:00Z`,
          highIds.map((id, idx): [string, number] => [id, idx + 1]),
        ),
      ),
    ]
    const active = ['winner', ...lowIds, ...highIds]

    let lowSelected = 0
    let highSelected = 0
    const trials = 200
    for (let i = 0; i < trials; i++) {
      const suggestion = suggestNextRace(history, active, MAX_RACE_SIZE, {
        now: new Date('2026-01-01T23:00:00Z'),
      })!
      lowSelected += lowIds.filter((id) => suggestion.racing.includes(id)).length
      highSelected += highIds.filter((id) => suggestion.racing.includes(id)).length
    }

    const lowRate = lowSelected / (trials * lowIds.length)
    const highRate = highSelected / (trials * highIds.length)
    expect(lowRate).toBeGreaterThan(highRate)
    expect(lowRate).toBeGreaterThan(0.85)
  })
})
