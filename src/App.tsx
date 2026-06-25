import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/AdminLayout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/admin/Dashboard'
import { VenuesPage } from './pages/admin/VenuesPage'
import { CourtsPage } from './pages/admin/CourtsPage'
import { TimeSlotsPage } from './pages/admin/TimeSlotsPage'
import { NightsPage } from './pages/admin/NightsPage'
import { DivisionsPage } from './pages/admin/DivisionsPage'
import { TeamsPage } from './pages/admin/TeamsPage'
import { PlayersPage } from './pages/admin/PlayersPage'
import { PlayerImportPage } from './pages/admin/PlayerImportPage'
import { DrawPage } from './pages/admin/DrawPage'
import { ScoreEntryPage } from './pages/admin/ScoreEntryPage'
import { StandingsPage } from './pages/admin/StandingsPage'
import { FixtureEditorPage } from './pages/admin/FixtureEditorPage'
import { FinalsPage } from './pages/admin/FinalsPage'
import { MatchSheetsPage } from './pages/admin/MatchSheetsPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={
          <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
            <h1>Futsal Competition</h1>
            <p>Public fixtures, standings and draw coming in Phase 9.</p>
          </main>
        } />
        <Route path="/login" element={<Login />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<Dashboard />} />
            <Route path="/admin/venues" element={<VenuesPage />} />
            <Route path="/admin/venues/:venueId/courts" element={<CourtsPage />} />
            <Route path="/admin/venues/:venueId/timeslots" element={<TimeSlotsPage />} />
            <Route path="/admin/venues/:venueId/nights" element={<NightsPage />} />
            <Route path="/admin/venues/:venueId/nights/:nightId/divisions" element={<DivisionsPage />} />
            <Route path="/admin/venues/:venueId/nights/:nightId/divisions/:divisionId/teams" element={<TeamsPage />} />
            <Route path="/admin/players" element={<PlayersPage />} />
            <Route path="/admin/players/import" element={<PlayerImportPage />} />
            <Route path="/admin/draw" element={<DrawPage />} />
            <Route path="/admin/draw/:seasonId/scores" element={<ScoreEntryPage />} />
            <Route path="/admin/draw/:seasonId/standings" element={<StandingsPage />} />
            <Route path="/admin/draw/:seasonId/editor" element={<FixtureEditorPage />} />
            <Route path="/admin/draw/:seasonId/finals" element={<FinalsPage />} />
            <Route path="/admin/draw/:seasonId/matchsheets" element={<MatchSheetsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
