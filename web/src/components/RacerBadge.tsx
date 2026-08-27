import { colorForRacer } from '../lib/palette'

/**
 * A racer's color-coded initial, the stand-in for a driver portrait: no
 * character art, but the same colored-badge-per-driver idea Mario Kart's own
 * select screen uses.
 */
export default function RacerBadge({
  id,
  name,
  size = 'sm',
}: {
  id: string
  name: string
  size?: 'sm' | 'md'
}) {
  const color = colorForRacer(id)
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  const dims = size === 'md' ? 'h-11 w-11 text-base' : 'h-7 w-7 text-xs'

  return (
    <span
      className={`inline-flex ${dims} shrink-0 items-center justify-center rounded-lg font-display font-black`}
      style={{
        backgroundColor: `${color}22`,
        borderColor: `${color}66`,
        color,
        borderWidth: 1.5,
        borderStyle: 'solid',
      }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}
