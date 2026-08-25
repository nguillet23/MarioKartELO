import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import SubmitGP from './pages/SubmitGP'
import Leaderboard from './pages/Leaderboard'
import Analytics from './pages/Analytics'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
  }`

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <nav className="flex gap-2 border-b border-gray-200 p-4">
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
      <Routes>
        <Route path="/" element={<Leaderboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/submit" element={<SubmitGP />} />
      </Routes>
    </BrowserRouter>
  )
}
