import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import SubmitGP from './pages/SubmitGP'
import Leaderboard from './pages/Leaderboard'
import Analytics from './pages/Analytics'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex-1 rounded-lg px-4 py-3 text-center text-sm font-medium transition-colors',
    'sm:flex-none sm:py-2',
    isActive ? 'bg-pit-hi text-gold' : 'text-haze hover:text-chalk',
  ].join(' ')

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* dvh, not vh: iOS Safari's address bar changes the real viewport height. */}
      <div className="min-h-dvh pb-24 sm:pb-0">
        <header className="sticky top-0 z-20 border-b border-line bg-asphalt/85 backdrop-blur">
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
              <NavLink to="/" end className={navLinkClass}>
                Leaderboard
              </NavLink>
              <NavLink to="/analytics" className={navLinkClass}>
                Analytics
              </NavLink>
              <NavLink to="/submit" className={navLinkClass}>
                Submit GP
              </NavLink>
            </nav>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Leaderboard />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/submit" element={<SubmitGP />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
