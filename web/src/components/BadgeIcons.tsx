/**
 * Small icons for achievement/recap badges — same stroke-based family as
 * NavIcons, kept in a separate file since these mark a moment in someone's
 * history rather than a section of the site.
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

/** A brand-new racer's first-ever grand prix. */
export function SparkleIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M10 2.5 L11.4 8.6 L17.5 10 L11.4 11.4 L10 17.5 L8.6 11.4 L2.5 10 L8.6 8.6 Z" />
    </svg>
  )
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M10 16.5 V3.5" />
      <path d="M4.5 9 L10 3.5 L15.5 9" />
    </svg>
  )
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M10 3.5 V16.5" />
      <path d="M4.5 11 L10 16.5 L15.5 11" />
    </svg>
  )
}

/** Racing the same nights again and again — a lap counter, not a calendar. */
export function RepeatIcon({ className }: IconProps) {
  return (
    <svg className={className} {...shared}>
      <path d="M4 10a6 6 0 0 1 10.2-4.3" />
      <path d="M14.2 3v3.2h-3.2" />
      <path d="M16 10a6 6 0 0 1-10.2 4.3" />
      <path d="M5.8 17v-3.2H9" />
    </svg>
  )
}
