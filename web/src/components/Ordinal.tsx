function suffixFor(rank: number): string {
  const lastTwo = rank % 100
  if (lastTwo >= 11 && lastTwo <= 13) return 'th'
  switch (rank % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

/**
 * A race-position marker, the way Mario Kart shows it on screen. The leader
 * is gold; everyone else is chalk.
 */
export default function Ordinal({ rank, className = '' }: { rank: number; className?: string }) {
  return (
    <span
      className={`ordinal ${rank === 1 ? 'text-gold' : 'text-chalk'} ${className}`}
      aria-label={`${rank}${suffixFor(rank)} place`}
    >
      {rank}
      <span className="ordinal-suffix" aria-hidden="true">
        {suffixFor(rank)}
      </span>
    </span>
  )
}
