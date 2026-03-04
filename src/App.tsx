import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import CheckIn from './pages/CheckIn'
import Debrief from './pages/Debrief'
import TacticalReads from './pages/TacticalReads'
import Dashboard from './pages/Dashboard'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-bg-primary text-text-primary">
        <nav className="border-b border-bg-elevated bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-6">
            <span className="font-heading text-xl font-bold tracking-wide text-val-red">
              VAL MASTER
            </span>
            <div className="flex gap-4 text-sm font-medium">
              <NavLink to="/" end className={({ isActive }) =>
                isActive ? 'text-val-cyan' : 'text-text-secondary hover:text-text-primary transition-colors'
              }>Dashboard</NavLink>
              <NavLink to="/checkin" className={({ isActive }) =>
                isActive ? 'text-val-cyan' : 'text-text-secondary hover:text-text-primary transition-colors'
              }>Check-In</NavLink>
              <NavLink to="/tactical" className={({ isActive }) =>
                isActive ? 'text-val-cyan' : 'text-text-secondary hover:text-text-primary transition-colors'
              }>Tactical</NavLink>
              <NavLink to="/debrief" className={({ isActive }) =>
                isActive ? 'text-val-cyan' : 'text-text-secondary hover:text-text-primary transition-colors'
              }>Debrief</NavLink>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/checkin" element={<CheckIn />} />
            <Route path="/tactical" element={<TacticalReads />} />
            <Route path="/debrief" element={<Debrief />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
