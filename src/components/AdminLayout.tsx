import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function AdminLayout() {
  const { appUser, isSuperAdmin, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <nav className="admin-nav">
          <span className="admin-nav-brand">Futsal Admin</span>
          <div className="admin-nav-links">
            <NavLink to="/admin/dashboard">Dashboard</NavLink>
            {isSuperAdmin && <NavLink to="/admin/venues">Venues</NavLink>}
            <NavLink to="/admin/players">Players</NavLink>
            <NavLink to="/admin/players/import">Import CSV</NavLink>
            {isSuperAdmin && <NavLink to="/admin/draw">Draw</NavLink>}
          </div>
          <div className="admin-nav-user">
            <span>{appUser?.display_name ?? 'Admin'}</span>
            <button onClick={handleSignOut}>Sign out</button>
          </div>
        </nav>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
