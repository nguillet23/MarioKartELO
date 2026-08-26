import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Ordinal from './Ordinal'
import { drawResultCard, shareResultCard } from '../lib/resultCard'
import { formatGpDate } from '../lib/history'
import type { Recap, RecapEntry } from '../lib/stats'

/**
 * The session recap: what a plain "saved" confirmation turns into once the
 * grand prix is in. Shows the standings with each racer's rating change, the
 * night's records, and a one-tap share of the whole thing as an image.
 */

function Delta({ value }: { value: number }) {
  const tone = value > 0 ? 'text-boost' : value < 0 ? 'text-spin' : 'text-haze'
  return (
    <span className={`font-mono ${tone}`}>
      {value > 0 ? '+' : ''}
      {value}
    </span>
  )
}

function Badge({ label, tone }: { label: string; tone: 'gold' | 'boost' | 'spin' | 'haze' }) {
  const tones = {
    gold: 'border-gold/40 bg-gold/10 text-gold',
    boost: 'border-boost/40 bg-boost/10 text-boost',
    spin: 'border-spin/40 bg-spin/10 text-spin',
    haze: 'border-line bg-pit-hi text-haze',
  }
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tones[tone]}`}
    >
      {label}
    </span>
  )
}

function badgesFor(entry: RecapEntry) {
  // A debut is every kind of record at once, so it stands in for all of them.
  if (entry.debut) return [{ label: 'Debut', tone: 'haze' as const }]

  const badges: { label: string; tone: 'gold' | 'boost' | 'spin' }[] = []
  if (entry.peakElo) badges.push({ label: 'Peak Elo', tone: 'gold' })
  if (entry.bestPoints) badges.push({ label: 'Best GP', tone: 'boost' })
  if (entry.worstPoints) badges.push({ label: 'Worst GP', tone: 'spin' })
  return badges
}

export default function RecapCard({ recap }: { recap: Recap }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState<string | null>(null)

  async function handleShare() {
    const canvas = canvasRef.current
    if (!canvas) return

    setSharing(true)
    setShareNote(null)
    try {
      await drawResultCard(canvas, recap)
      const outcome = await shareResultCard(
        canvas,
        `grand-prix-${recap.grandPrix.playedAt.slice(0, 10)}.png`,
      )
      if (outcome === 'downloaded') setShareNote('Saved the result card to your downloads.')
      if (outcome === 'shared') setShareNote('Sent.')
    } catch (err) {
      setShareNote(err instanceof Error ? err.message : 'The result card could not be made.')
    } finally {
      setSharing(false)
    }
  }

  const { biggestGainer, biggestLoser } = recap
  const swung = biggestGainer.eloDelta > 0 || biggestLoser.eloDelta < 0

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-bold uppercase tracking-tight text-chalk">
          Race recap
        </h2>
        <span className="text-xs text-haze">{formatGpDate(recap.grandPrix.playedAt)}</span>
      </div>

      <ol className="divide-y divide-line">
        {recap.entries.map((entry) => (
          <li
            key={entry.playerId}
            className={`grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 px-4 py-3 ${
              entry.rank === 1 ? 'bg-gold/5' : ''
            }`}
          >
            <Ordinal rank={entry.rank} className="text-xl" />

            <div className="min-w-0">
              <Link
                to={`/player/${entry.playerId}`}
                className="block truncate font-display text-sm font-bold text-chalk hover:text-gold"
              >
                {entry.playerName}
              </Link>
              <div className="mt-1 flex flex-wrap gap-1">
                {badgesFor(entry).map((badge) => (
                  <Badge key={badge.label} label={badge.label} tone={badge.tone} />
                ))}
              </div>
            </div>

            <div className="text-right font-mono text-sm">
              <span className="text-chalk">{entry.points} pts</span>
              <span className="ml-3">
                <Delta value={entry.eloDelta} />
              </span>
            </div>
          </li>
        ))}
      </ol>

      {swung && (
        <p className="border-t border-line px-4 py-3 text-sm text-haze">
          <span className="text-chalk">{biggestGainer.playerName}</span> gained the most (
          <Delta value={biggestGainer.eloDelta} />) and{' '}
          <span className="text-chalk">{biggestLoser.playerName}</span> gave up the most (
          <Delta value={biggestLoser.eloDelta} />
          ).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={handleShare}
          disabled={sharing}
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-chalk transition-colors hover:border-gold hover:text-gold disabled:opacity-40"
        >
          {sharing ? 'Making the card…' : 'Share result card'}
        </button>
        {shareNote && <span className="text-xs text-haze">{shareNote}</span>}
      </div>

      {/* Drawn to on demand and never shown: it exists only to be turned into
          a PNG for the share sheet. */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </section>
  )
}
