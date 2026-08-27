/**
 * One original line-icon per tab. Each is a small nod to what the page
 * actually shows — a podium for standings, a star for records (Mario Kart's
 * own invincibility item, and the shape of a personal best), a checkered
 * flag for logging a finished race — not any character or copyrighted art.
 */

type IconProps = { className?: string }

const shared = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function PodiumIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <rect x="2.5" y="10" width="4" height="7" />
      <rect x="8" y="5.5" width="4" height="11.5" />
      <rect x="13.5" y="12" width="4" height="5" />
    </svg>
  )
}

export function TrendIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <polyline points="2,15 6.5,10 10,12.5 17,4" />
      <circle cx="17" cy="4" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function VersusIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M8 4 L3 10 L8 16" />
      <path d="M12 4 L17 10 L12 16" />
    </svg>
  )
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M10 2.5 L12.2 7.6 L17.5 8.1 L13.6 11.7 L14.8 17 L10 14.2 L5.2 17 L6.4 11.7 L2.5 8.1 L7.8 7.6 Z" />
    </svg>
  )
}

export function BalanceIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M10 2 V5" />
      <path d="M5 11.5 L10 5 L15 11.5" />
      <circle cx="5" cy="14" r="2.3" />
      <circle cx="15" cy="14" r="2.3" />
    </svg>
  )
}

export function FlagIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M4 17.5 V2.5" />
      <path d="M4 3 L16 3 L16 5.5 L12 5.5 L12 8 L16 8 L16 10.5 L4 10.5 Z" />
      <rect x="4" y="3" width="4" height="3.75" fill="currentColor" stroke="none" />
      <rect x="12" y="6.75" width="4" height="3.75" fill="currentColor" stroke="none" />
    </svg>
  )
}
