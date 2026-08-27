// The 12-racer color set, in the same order as --color-p1..p12 in index.css.
// Recharts sets `stroke` as an SVG presentation attribute (doesn't resolve
// CSS custom properties), so any chart needs these as plain hex, same as the
// mirrored constants in resultCard.ts.
export const RACER_COLORS = [
  '#e8402a',
  '#3a86f0',
  '#ffc42b',
  '#35c15f',
  '#c084fc',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
  '#818cf8',
  '#fb923c',
  '#2dd4bf',
  '#f472b6',
]

/**
 * A stable color per racer id, so the same person reads as the same color
 * everywhere they show up — leaderboard, matchmaking, the submit form —
 * rather than a color tied to whatever slot or sort order they happen to
 * land in on a given page.
 */
export function colorForRacer(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return RACER_COLORS[hash % RACER_COLORS.length]
}
