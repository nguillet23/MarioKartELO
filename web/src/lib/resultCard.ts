// Renders a grand prix's standings to a PNG sized for a group chat.
//
// Drawn on a canvas rather than screenshotted so the output is the same on
// every phone, and so it can carry the "Results Screen" look at a resolution
// that survives being re-compressed by a messaging app.

import type { Recap } from './stats'
import { formatGpDate } from './history'
import { colorForRacer } from './palette'

const WIDTH = 1080
const HEIGHT = 1350

// Mirrors the palette in index.css. Canvas takes plain colors, not CSS
// custom properties, so these have to be repeated here.
const ASPHALT = '#0a1428'
const PIT = '#0f1d3a'
const LINE = '#28406e'
const CHALK = '#f4f7fc'
const HAZE = '#90a0c9'
const GOLD = '#ffc42b'
const BOOST = '#35d07f'
const SPIN = '#ff5a47'
const SILVER = '#b9c3d4'
const BRONZE = '#b3915c'

/** The podium's medal color for a rank, or null off the podium. */
function tierColor(rank: number): string | null {
  if (rank === 1) return GOLD
  if (rank === 2) return SILVER
  if (rank === 3) return BRONZE
  return null
}

const DISPLAY = 'Archivo, ui-sans-serif, system-ui, sans-serif'
const SANS = '"Space Grotesk", ui-sans-serif, system-ui, sans-serif'
const MONO = '"Space Mono", ui-monospace, monospace'

/**
 * Webfonts are loaded by a stylesheet link, and canvas silently falls back to
 * a system face for anything not resolved yet — so ask for each face at the
 * exact weight/style the card draws in before drawing.
 */
async function ensureFonts(): Promise<void> {
  if (!('fonts' in document)) return
  await Promise.all([
    document.fonts.load(`900 italic 64px ${DISPLAY}`),
    document.fonts.load(`800 40px ${DISPLAY}`),
    document.fonts.load(`700 28px ${SANS}`),
    document.fonts.load(`500 24px ${SANS}`),
    document.fonts.load(`700 32px ${MONO}`),
  ]).catch(() => undefined)
  await document.fonts.ready
}

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

/** The site's slanted ordinal, with its raised suffix. */
function drawOrdinal(
  ctx: CanvasRenderingContext2D,
  rank: number,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save()
  ctx.fillStyle = tierColor(rank) ?? CHALK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const numeral = String(rank)
  ctx.font = `900 italic ${size}px ${DISPLAY}`
  const numeralWidth = ctx.measureText(numeral).width
  ctx.fillText(numeral, x, y)

  // Raised and shrunk the same way `.ordinal-suffix` does in index.css.
  ctx.font = `900 italic ${size * 0.55}px ${DISPLAY}`
  ctx.fillText(suffixFor(rank), x + numeralWidth + size * 0.05, y - size * 0.42)
  ctx.restore()
}

/** Truncates to fit a max width, adding an ellipsis — long names, small cards. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let clipped = text
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1)
  }
  return `${clipped}…`
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

/** The one checkered element, same as the rule under each page title. */
function drawCheckerRule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
  const square = 12
  ctx.save()
  ctx.fillStyle = LINE
  for (let col = 0; col * square < width; col++) {
    for (let row = 0; row < 2; row++) {
      if ((col + row) % 2 !== 0) continue
      ctx.fillRect(x + col * square, y + row * square, Math.min(square, width - col * square), square)
    }
  }
  ctx.restore()
}

/** A short tag next to a name, e.g. "PB" or "PEAK". */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  color: string,
): number {
  ctx.save()
  ctx.font = `700 20px ${SANS}`
  const paddingX = 12
  const width = ctx.measureText(label).width + paddingX * 2
  const height = 32

  ctx.fillStyle = `${color}22`
  roundedRect(ctx, x, y - height / 2, width, height, 8)
  ctx.fill()
  ctx.strokeStyle = `${color}66`
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + paddingX, y + 1)
  ctx.restore()

  return width
}

/** A racer's color-coded initial, matching the in-app RacerBadge. */
function drawDriverBadge(
  ctx: CanvasRenderingContext2D,
  playerId: string,
  playerName: string,
  x: number,
  y: number,
  size: number,
): void {
  const color = colorForRacer(playerId)
  ctx.save()
  ctx.fillStyle = `${color}22`
  roundedRect(ctx, x, y - size / 2, size, size, size * 0.22)
  ctx.fill()
  ctx.strokeStyle = `${color}66`
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.fillStyle = color
  ctx.font = `900 italic ${size * 0.5}px ${DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(playerName.trim().charAt(0).toUpperCase() || '?', x + size / 2, y + size * 0.04)
  ctx.restore()
}

/**
 * Paints the recap onto `canvas`, sizing it to 1080×1350 (a 4:5 portrait,
 * which is what messaging apps show without cropping).
 */
export async function drawResultCard(canvas: HTMLCanvasElement, recap: Recap): Promise<void> {
  await ensureFonts()

  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot render the result card.')

  ctx.fillStyle = ASPHALT
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // The same start-line glow the site's background has.
  const glow = ctx.createRadialGradient(WIDTH / 2, 0, 0, WIDTH / 2, 0, WIDTH * 0.9)
  glow.addColorStop(0, 'rgba(58, 134, 240, 0.16)')
  glow.addColorStop(1, 'rgba(58, 134, 240, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const margin = 72
  ctx.textBaseline = 'alphabetic'

  // Masthead
  ctx.fillStyle = HAZE
  ctx.font = `500 24px ${SANS}`
  ctx.letterSpacing = '6px'
  ctx.textAlign = 'left'
  ctx.fillText('MARIO KART', margin, 110)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = CHALK
  ctx.font = `900 italic 72px ${DISPLAY}`
  ctx.fillText('ELO', margin, 180)

  ctx.fillStyle = HAZE
  ctx.font = `500 26px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText(formatGpDate(recap.grandPrix.playedAt), WIDTH - margin, 180)

  ctx.textAlign = 'left'
  ctx.fillStyle = CHALK
  ctx.font = `800 44px ${DISPLAY}`
  ctx.fillText('GRAND PRIX RESULTS', margin, 262)
  drawCheckerRule(ctx, margin, 288, 180)

  // Standings
  const rows = recap.entries
  const listTop = 348
  const listBottom = HEIGHT - 190
  const rowGap = 14
  const rowHeight = Math.min(
    112,
    (listBottom - listTop - rowGap * (rows.length - 1)) / Math.max(rows.length, 1),
  )
  const fontScale = Math.min(1, rowHeight / 112)

  rows.forEach((entry, index) => {
    const top = listTop + index * (rowHeight + rowGap)
    const middle = top + rowHeight / 2

    const tier = tierColor(entry.rank)
    ctx.fillStyle = tier ? `${tier}14` : PIT
    roundedRect(ctx, margin, top, WIDTH - margin * 2, rowHeight, 18)
    ctx.fill()
    ctx.strokeStyle = tier ? `${tier}73` : LINE
    ctx.lineWidth = 2
    ctx.stroke()

    drawOrdinal(ctx, entry.rank, margin + 28, middle + 18 * fontScale, 52 * fontScale)

    const badgeSize = 60 * fontScale
    const badgeX = margin + 145
    drawDriverBadge(ctx, entry.playerId, entry.playerName, badgeX, middle, badgeSize)

    ctx.font = `700 ${34 * fontScale}px ${SANS}`
    ctx.fillStyle = CHALK
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const nameX = badgeX + badgeSize + 18
    const nameMaxWidth = WIDTH - margin - 260 - nameX
    const name = fitText(ctx, entry.playerName, nameMaxWidth)
    ctx.fillText(name, nameX, middle)

    // Badges sit under the name when the row is tall enough to hold them.
    if (rowHeight > 92) {
      let badgeX = nameX + ctx.measureText(name).width + 16
      const badges: [string, string][] = []
      if (entry.debut) badges.push(['DEBUT', HAZE])
      else if (entry.peakElo) badges.push(['PEAK', GOLD])
      if (entry.bestPoints) badges.push(['BEST GP', BOOST])
      for (const [label, color] of badges) {
        badgeX += drawBadge(ctx, label, badgeX, middle, color) + 10
      }
    }

    ctx.textAlign = 'right'
    ctx.font = `700 ${34 * fontScale}px ${MONO}`
    ctx.fillStyle = CHALK
    ctx.fillText(`${entry.points}`, WIDTH - margin - 150, middle)

    ctx.font = `500 ${18 * fontScale}px ${SANS}`
    ctx.fillStyle = HAZE
    ctx.fillText('PTS', WIDTH - margin - 150, middle + 30 * fontScale)

    ctx.font = `700 ${30 * fontScale}px ${MONO}`
    ctx.fillStyle = entry.eloDelta > 0 ? BOOST : entry.eloDelta < 0 ? SPIN : HAZE
    ctx.fillText(
      `${entry.eloDelta > 0 ? '+' : ''}${entry.eloDelta}`,
      WIDTH - margin - 28,
      middle - 14 * fontScale,
    )
    ctx.font = `500 ${24 * fontScale}px ${MONO}`
    ctx.fillStyle = HAZE
    ctx.fillText(`${entry.eloAfter}`, WIDTH - margin - 28, middle + 24 * fontScale)
  })

  // Footer: the one line worth reading if you only read one.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = HAZE
  ctx.font = `500 26px ${SANS}`
  const gainer = recap.biggestGainer
  const footer =
    gainer.eloDelta > 0
      ? `${gainer.playerName} took the most off the field: +${gainer.eloDelta}`
      : `${rows.length} racers, and nobody gained a thing`
  ctx.fillText(fitText(ctx, footer, WIDTH - margin * 2), margin, HEIGHT - 110)

  ctx.fillStyle = LINE
  ctx.font = `500 22px ${SANS}`
  ctx.fillText(`${rows.length} racers · rated on margin of victory`, margin, HEIGHT - 68)
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * Hands the card to the OS share sheet where there is one (phones — straight
 * into a group chat), and falls back to a download everywhere else.
 */
export async function shareResultCard(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<ShareOutcome> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The result card could not be encoded.')

  const file = new File([blob], filename, { type: 'image/png' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Grand prix results' })
      return 'shared'
    } catch (err) {
      // Dismissing the share sheet rejects with AbortError — not a failure,
      // and not worth falling back to a surprise download for.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
