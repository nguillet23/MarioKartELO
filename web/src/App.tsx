import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import SubmitGP from './pages/SubmitGP'
import Leaderboard from './pages/Leaderboard'
import Analytics from './pages/Analytics'
import HeadToHead from './pages/HeadToHead'
import PlayerProfile from './pages/PlayerProfile'
import Records from './pages/Records'
import { FlagIcon, PodiumIcon, StarIcon, TrendIcon, VersusIcon } from './components/NavIcons'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex-1 rounded-lg px-1.5 py-2 text-center text-sm font-medium transition-colors',
    'sm:flex-none sm:px-4 sm:py-2',
    isActive ? 'bg-pit-hi text-gold' : 'text-haze hover:text-chalk',
  ].join(' ')

/**
 * Six tabs don't fit across a phone as full-length text (they used to be
 * four), so each one leads with an icon and carries a short label under it
 * for the bottom bar, collapsing to icon-plus-full-name inline from sm up.
 */
function NavItem({
  to,
  end,
  icon,
  short,
  full,
}: {
  to: string
  end?: boolean
  icon: ReactNode
  short: string
  full: string
}) {
  return (
    <NavLink to={to} end={end} className={navLinkClass}>
      <span className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
        <span className="h-[18px] w-[18px] shrink-0 sm:h-4 sm:w-4">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide sm:hidden">{short}</span>
        <span className="hidden sm:inline">{full}</span>
      </span>
    </NavLink>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* dvh, not vh: iOS Safari's address bar changes the real viewport height. */}
      <div className="min-h-dvh pb-24 sm:pb-0">
        <header className="sticky top-0 z-20 border-b border-line bg-asphalt/85 backdrop-blur">
          <div className="livery-stripe" aria-hidden="true" />
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-3">
            <NavLink to="/" end className="leading-none">
              <span className="block text-[10px] font-medium uppercase tracking-[0.25em] text-haze">
                Mario Kart
              </span>
              <span className="block font-display text-xl font-black italic tracking-tight text-chalk">
                ELO
              </span>
            </NavLink>

            {/* One nav element: pinned to the bottom of the screen on phones
                (thumb-reachable), inline in the header from sm up. */}
            <nav
              className={[
                'fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t border-line bg-pit/95 px-2 pt-2 backdrop-blur',
                'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
                'sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none',
              ].join(' ')}
            >
              <NavItem to="/" end icon={<PodiumIcon className="h-full w-full" />} short="Table" full="Leaderboard" />
              <NavItem
                to="/analytics"
                icon={<TrendIcon className="h-full w-full" />}
                short="Form"
                full="Analytics"
              />
              <NavItem
                to="/head-to-head"
                icon={<VersusIcon className="h-full w-full" />}
                short="H2H"
                full="Head to Head"
              />
              <NavItem to="/records" icon={<StarIcon className="h-full w-full" />} short="Records" full="Records" />
              <NavItem to="/submit" icon={<FlagIcon className="h-full w-full" />} short="Submit" full="Submit GP" />
            </nav>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Leaderboard />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/head-to-head" element={<HeadToHead />} />
            <Route path="/records" element={<Records />} />
            <Route path="/player/:playerId" element={<PlayerProfile />} />
            <Route path="/submit" element={<SubmitGP />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
