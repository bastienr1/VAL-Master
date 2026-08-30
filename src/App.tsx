import { BrowserRouter, Routes, Route } from 'react-router-dom'
import CheckIn from './pages/CheckIn'
import Debrief from './pages/Debrief'
import TacticalReads from './pages/TacticalReads'
import Dashboard from './pages/Dashboard'
import MatchLibrary from './pages/MatchLibrary'
import VodReview from './pages/VodReview'
import Login from './pages/Login'
import Settings from './pages/Settings'
import AppShell from './components/AppShell'
import { useSession } from './lib/auth'
import { loadGameContent } from './lib/gameContent'

// Warm the registry as early as possible so name→UUID resolution is ready by
// the time Match Library renders legacy rows that have no map_id/agent_id.
loadGameContent().catch(err => {
  console.warn('[gameContent] initial load failed — images will fall back to placeholders', err)
})

function App() {
  const { user, loading } = useSession()

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-val-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<MatchLibrary />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/review/:matchId" element={<VodReview />} />
          <Route path="/analytics" element={<Dashboard />} />
          {/* Preserved legacy routes — accessible via direct URL */}
          <Route path="/checkin" element={<CheckIn />} />
          <Route path="/tactical" element={<TacticalReads />} />
          <Route path="/debrief" element={<Debrief />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}

export default App
